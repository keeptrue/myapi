import type {
  AccountDraft,
  AccountProfilePublic,
  AccountTestResult,
  BalanceSnapshot,
  ClaimItem,
  ClaimResult,
  CheckinResult,
  CredentialDescriptor,
  ImportInput,
  KeepaliveResult,
  ModelRecord,
  PasteInput,
  RedeemInput,
  RedeemResult,
  SmsSendInput,
  SmsSendResult,
  SmsVerifyInput,
  WebLoginCompleteInput,
  WebLoginSession,
} from '../../../shared/providers.js'
import type { StoredAccount } from '../../store/schema.js'
import { decodeCredentials } from '../../store/credentials.js'
import type { ProviderAdapter, AdapterContext, InferenceRequest } from '../types.js'
import { LOOMY_PROVIDER_ID } from '../ids.js'
import { UnsupportedProviderError } from '../registry.js'
import {
  LOOMY_DISPLAY_NAME,
  LOOMY_EXPIRY_MARGIN_MS,
  LOOMY_SESSION_TTL_MS,
  LOOMY_VENDOR,
  loomyCapabilities,
  modelBaseUrl,
  type LoomyConfig,
} from './endpoints.js'
import { businessCode, inference, isAuthError, LoomyHttpError, signedPost, SUCCESS_CODE, tokenRequest, upstreamMessage } from './client.js'

/**
 * The Loomy (讯飞) adapter.
 *
 * Three upstream planes: the account plane (CAccount, HMAC-SHA1 signed), the integration
 * gateway (points, daily refresh, model catalog — `token` header) and the model gateway
 * (`{integration}/api/v1`, OpenAI-compatible, dual auth headers). One login session serves
 * all three.
 *
 * Honest degradations, per the vendor: the session lasts 14 days and has no renewal
 * endpoint, so `tokenRenew` is false and expiry is estimated from login time; there is
 * no desktop client import; there is no OAuth round-trip; there is no standalone check-in
 * — the daily points refresh (`/api/v1/points/first-login`) plays that role and is
 * idempotent per day.
 */

const SEND_CODE_PATH = '/login/phone/sendMsgCode'
const LOGIN_PATH = '/login/phone/checkCode'
const CHAT_PATH = '/api/v1/chat/completions'
const MODELS_PATH = '/api/v1/models'
const RECORDS_PATH = '/api/v2/points/records?pageNo=1&pageSize=1&direction=debit&granularity=chat'
const FIRST_LOGIN_PATH = '/api/v1/points/first-login'

/** Client envelope constants (`_makeBase()`): fixed values, not fingerprints to derive. */
const WEB_MODEL_ID = 'Web'
const WEB_DEVICE_ID = 'web'
const CLIENT_UA = 'Loomy|Desktop|Electron|macOS'
const CLIENT_VERSION = '1.0.0'

function randomTraceId(): string {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('hex')
}

function makeBase(config: LoomyConfig): Record<string, string> {
  return {
    appid: config.appId,
    modelid: WEB_MODEL_ID,
    version: CLIENT_VERSION,
    devid: WEB_DEVICE_ID,
    ua: CLIENT_UA,
    traceid: randomTraceId(),
  }
}

/** Mainland China mobile number: tolerate `+86` / `86` prefixes, spaces and dashes. */
export function normalizePhone(raw: string): string {
  const trimmed = [...raw].filter(ch => ch !== ' ' && ch !== '-').join('')
  const withoutCountry = trimmed.replace(/^\+86/u, '')
  const digits = withoutCountry.startsWith('86') && withoutCountry.length === 13 ? withoutCountry.slice(2) : withoutCountry
  if (/^1[3-9]\d{9}$/u.test(digits)) return digits
  throw new Error('请填写 11 位中国大陆手机号')
}

function normalizeCode(raw: string): string {
  const trimmed = raw.trim()
  if (/^\d{6}$/u.test(trimmed)) return trimmed
  throw new Error('请填写 6 位数字验证码')
}

/** Mask a phone number for display (first 3, last 4), character-safe by construction. */
export function maskPhone(phone: string): string {
  const chars = [...phone]
  if (chars.length < 7) return phone
  return `${chars.slice(0, 3).join('')}****${chars.slice(-4).join('')}`
}

/** Pull the first non-empty string from a credential map candidate list. */
function pick(map: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const value = map[key]?.trim() ?? ''
    if (value !== '') return value
  }
  return ''
}

/** Read the msgid out of a send-code response (field name and depth both vary upstream). */
export function extractMsgId(payload: unknown): string {
  const candidates = ['/data/msgid', '/data/msgId', '/data/data/msgid', '/data/data/msgId']
  for (const pointer of candidates) {
    let node: unknown = payload
    for (const part of pointer.split('/').slice(1)) {
      if (typeof node !== 'object' || node === null) { node = undefined; break }
      node = (node as Record<string, unknown>)[part]
    }
    if (typeof node === 'string' && node.trim() !== '') return node.trim()
  }
  return ''
}

/** Describe a business failure in words the human can act on. */
function describeLoginError(code: string, upstream: string): string {
  if (code === '020002' || code === '100002') return '登录态已失效，请重新登录'
  return upstream !== '' ? `登录失败：${upstream}` : `登录失败（上游 code=${code}）`
}

function requireSuccess(payload: unknown, what: string): void {
  const code = businessCode(payload)
  if (code === SUCCESS_CODE) return
  if (isAuthError(code)) throw new LoomyHttpError(401, 'Loomy 登录态已失效，请重新登录')
  const upstream = upstreamMessage(payload)
  throw new LoomyHttpError(502, upstream !== '' ? `${what}：${upstream}` : `${what}失败（上游 code=${code}）`)
}

/**
 * Split a trailing `(x3.0)` / `（x12）` multiplier off a display name.
 *
 * The upstream catalog has no structured rate field — it appends the multiplier to the
 * display name, and the desktop client splits it back out the same way. Only `x<number>`
 * suffixes count; other labels (e.g. `限时免费`) stay in the name untouched.
 */
export function splitRateSuffix(rawName: string): { name: string; rate?: string } {
  const trimmed = rawName.trimEnd()
  let body = ''
  let inner = ''
  if (trimmed.endsWith(')') && trimmed.includes('(')) {
    const open = trimmed.lastIndexOf('(')
    body = trimmed.slice(0, open)
    inner = trimmed.slice(open + 1, -1).trim()
  } else if (trimmed.endsWith('）') && trimmed.includes('（')) {
    const open = trimmed.lastIndexOf('（')
    body = trimmed.slice(0, open)
    inner = trimmed.slice(open + 1, trimmed.length - '）'.length).trim()
  } else {
    return { name: rawName }
  }
  const number = inner.startsWith('x') || inner.startsWith('X') ? inner.slice(1).trim() : ''
  if (number === '' || !/^\d+(\.\d+)?$/u.test(number)) return { name: rawName }
  const cleaned = body.trimEnd()
  return { name: cleaned === '' ? rawName : cleaned, rate: `x${number}` }
}

function asObjectArray(payload: unknown): Record<string, unknown>[] {
  if (typeof payload !== 'object' || payload === null) return []
  const record = payload as Record<string, unknown>
  const rows = Array.isArray(record['data']) ? record['data'] : Array.isArray(payload) ? payload : []
  return rows.filter((row): row is Record<string, unknown> => typeof row === 'object' && row !== null)
}

/** Map one OpenAI catalog entry onto a ModelRecord. Unknown capabilities degrade to off. */
export function mapModelEntry(providerId: string, row: Record<string, unknown>): ModelRecord | undefined {
  const id = typeof row['id'] === 'string' ? row['id'].trim() : ''
  if (id === '') return undefined
  const rawName = typeof row['name'] === 'string' && row['name'].trim() !== '' ? row['name'].trim() : id
  const { name, rate } = splitRateSuffix(rawName)
  const caps = (typeof row['capabilities'] === 'object' && row['capabilities'] !== null
    ? row['capabilities'] as Record<string, unknown>
    : {})
  const bool = (key: string): boolean => caps[key] === true
  const modal = (target: string): boolean => {
    const items = caps['input_modalities']
    return Array.isArray(items) && items.some(item => typeof item === 'string' && item.toLowerCase() === target)
  }
  const number = (keys: string[]): number => {
    for (const key of keys) {
      const value = row[key]
      if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
      if (typeof value === 'string' && /^\d+$/u.test(value.trim())) return Number(value.trim())
    }
    return 0
  }
  const reasoning = bool('reasoning') || /spark-x/iu.test(id)
  // The upstream marks image support either on `vision` or in `input_modalities`; read
  // both so a missing field on one side never silently drops the capability.
  const supportsImages = bool('vision') || modal('image')
  return {
    name: id,
    providerId,
    upstreamSlug: id,
    displayName: name,
    contextWindow: number(['context_length', 'context_window', 'input_token_limit', 'max_input_tokens', 'maxInputTokens']),
    maxOutputTokens: number(['max_output_tokens', 'max_completion_tokens', 'max_tokens', 'maxOutputTokens']),
    reasoningEfforts: reasoning ? ['low', 'medium', 'high'] : [],
    inputModalities: supportsImages ? ['text', 'image'] : ['text'],
    canDisableThinking: false,
    available: true,
    priority: 0,
    extra: { ...(rate === undefined ? {} : { multiplier: rate }) },
  }
}

export class LoomyAdapter implements ProviderAdapter {
  readonly id = LOOMY_PROVIDER_ID
  readonly displayName = LOOMY_DISPLAY_NAME
  readonly vendor = LOOMY_VENDOR
  readonly capabilities = loomyCapabilities()

  constructor(
    private readonly config: LoomyConfig,
    private readonly masterKey: Buffer,
  ) {}

  // ---- Credential helpers ----

  private sessionFor(account: StoredAccount): string {
    const decoded = decodeCredentials(account, this.masterKey)
    const session = pick(decoded.map, ['session', 'token'])
    if (session === '') {
      throw new LoomyHttpError(401, 'Loomy 账号缺少 session，请重新登录或粘贴凭证')
    }
    return session
  }

  // ---- Onboarding ----

  credentialDescriptors(): CredentialDescriptor[] {
    return [
      { field: 'session', label: '登录 session', hint: 'Loomy 桌面端登录后的会话 token', secret: true, required: true },
      { field: 'userid', label: 'userid', hint: '讯飞侧用户 id，可留空', secret: false, required: false },
      { field: 'mobile', label: '手机号', hint: '可选，仅用于备注展示', secret: true, required: false },
    ]
  }

  importDescriptors() {
    return []
  }

  async sendSms(input: SmsSendInput, _context: AdapterContext): Promise<SmsSendResult> {
    const phone = normalizePhone(input.mobile)
    const body = {
      base: makeBase(this.config),
      param: { ccode: '86', phone, expire: 300 },
    }
    const payload = await signedPost(this.config, SEND_CODE_PATH, body, '发送验证码')
    requireSuccess(payload, '发送验证码')
    const msgid = extractMsgId(payload)
    if (msgid === '') {
      throw new LoomyHttpError(502, '验证码已发出但上游没有返回 msgid，请稍后重试')
    }
    return { ticket: msgid }
  }

  async verifySms(input: SmsVerifyInput, _context: AdapterContext): Promise<AccountDraft> {
    const phone = normalizePhone(input.mobile)
    const code = normalizeCode(input.code)
    const ticket = input.ticket?.trim() ?? ''
    if (ticket === '') {
      throw new Error('缺少发码会话票据：请先点「发送验证码」，再使用本次会话完成登录')
    }
    const body = {
      base: makeBase(this.config),
      param: { ccode: '86', phone, mcode: code, msgid: ticket, expire: LOOMY_SESSION_TTL_MS / 1000 },
    }
    const payload = await signedPost(this.config, LOGIN_PATH, body, '登录')
    requireSuccess(payload, '登录')
    const data = (typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>)['data'] : {}) as Record<string, unknown> | undefined
    const session = typeof data?.['session'] === 'string' ? data['session'].trim() : ''
    if (session === '') throw new LoomyHttpError(502, '登录成功但上游没有返回 session')
    const userid = typeof data?.['userid'] === 'string' ? data['userid'].trim() : ''
    return this.draft(session, userid, phone, 'sms')
  }

  async addByPaste(input: PasteInput, _context: AdapterContext): Promise<AccountDraft> {
    const known = new Set(this.credentialDescriptors().map(descriptor => descriptor.field))
    for (const field of Object.keys(input.fields)) {
      if (!known.has(field)) throw new Error(`未知的凭据字段：${field}`)
    }
    const session = (input.fields['session'] ?? '').trim()
    if (session === '') throw new Error('session 为必填项')
    const userid = (input.fields['userid'] ?? '').trim()
    const mobile = (input.fields['mobile'] ?? '').trim()
    if (mobile !== '') normalizePhone(mobile)
    return this.draft(session, userid, mobile, 'paste')
  }

  async addByImport(_input: ImportInput, context: AdapterContext): Promise<AccountDraft> {
    throw new UnsupportedProviderError(this.id, '导入本机登录态')
  }

  /** Loomy authenticates by phone + SMS, not by a browser authorization round-trip. */
  async startWebLogin(_input: { stateId: string; redirectUri: string }, _context: AdapterContext): Promise<WebLoginSession> {
    throw new UnsupportedProviderError(this.id, '网页授权登录')
  }

  async completeWebLogin(input: WebLoginCompleteInput, _context: AdapterContext): Promise<AccountDraft> {
    throw new UnsupportedProviderError(input.providerId, '网页授权登录')
  }

  private draft(session: string, userid: string, phone: string, kind: 'sms' | 'paste'): AccountDraft {
    const masked = phone === '' ? '' : maskPhone(phone)
    const now = Date.now()
    return {
      providerId: LOOMY_PROVIDER_ID,
      label: masked !== '' ? `Loomy ${masked}` : userid !== '' ? `Loomy ${userid}` : 'Loomy 账号',
      credentialKind: kind,
      credentials: {
        session,
        ...(userid === '' ? {} : { userid }),
        ...(phone === '' ? {} : { mobile: phone }),
      },
      profile: {
        accountId: userid,
        mobileMasked: masked,
        nickname: masked !== '' ? `Loomy ${masked}` : LOOMY_DISPLAY_NAME,
        expiresAt: now + LOOMY_SESSION_TTL_MS,
        balanceKnown: false,
        permanentBalance: 0,
        dailyBalance: 0,
        lastCheckedAt: 0,
      },
      nickname: masked !== '' ? `Loomy ${masked}` : LOOMY_DISPLAY_NAME,
      mobileMasked: masked,
    }
  }

  // ---- Lifecycle ----

  async inference(request: InferenceRequest, context: AdapterContext): Promise<Response> {
    const session = this.sessionFor(request.account)
    return inference(this.config, CHAT_PATH, session, request.body, request.signal)
  }

  /** The vendor offers no renewal endpoint: expiry means a fresh SMS login. */
  async refreshCredential(_account: StoredAccount, _context: AdapterContext): Promise<void> {
    throw new UnsupportedProviderError(this.id, '凭证续期')
  }

  async refreshCatalog(account: StoredAccount, _context: AdapterContext): Promise<ModelRecord[]> {
    const session = this.sessionFor(account)
    const payload = await tokenRequest(this.config, 'GET', MODELS_PATH, session, undefined, '模型目录')
    return asObjectArray(payload)
      .map(row => mapModelEntry(this.id, row))
      .filter((record): record is ModelRecord => record !== undefined)
      .map((record, index) => ({ ...record, priority: index }))
  }

  async queryBalance(account: StoredAccount, _context: AdapterContext): Promise<BalanceSnapshot> {
    const session = this.sessionFor(account)
    const payload = await tokenRequest(this.config, 'GET', RECORDS_PATH, session, undefined, '积分查询')
    const code = businessCode(payload)
    if (isAuthError(code)) throw new LoomyHttpError(401, 'Loomy 登录态已失效，无法查询积分（请重新登录）')
    if (code !== SUCCESS_CODE) {
      const message = upstreamMessage(payload)
      throw new LoomyHttpError(502, message !== '' ? `积分查询失败：${message}` : `积分查询失败（上游 code=${code}）`)
    }
    const outer = (typeof payload === 'object' && payload !== null ? payload : {}) as Record<string, unknown>
    const data = (typeof outer['data'] === 'object' && outer['data'] !== null ? outer['data'] : {}) as Record<string, unknown>
    const nested = (typeof data['data'] === 'object' && data['data'] !== null ? data['data'] : data) as Record<string, unknown>
    const readNumber = (key: string): number => {
      const value = nested[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string' && value.trim() !== '') {
        const parsed = Number(value.trim())
        if (Number.isFinite(parsed)) return parsed
      }
      return 0
    }
    const permanent = readNumber('balance')
    const daily = readNumber('dailyBalance')
    return {
      known: true,
      balances: [
        { key: 'permanent_points', label: '永久积分', value: permanent, unit: '积分', known: true },
        { key: 'daily_points', label: '每日赠送积分', value: daily, unit: '积分', known: true },
      ],
      fetchedAt: Date.now(),
    }
  }

  async checkin(account: StoredAccount, _context: AdapterContext): Promise<CheckinResult> {
    const result: CheckinResult = { ok: false, error: '', deltas: [], actions: [], at: Date.now() }
    try {
      const session = this.sessionFor(account)
      const payload = await tokenRequest(this.config, 'POST', FIRST_LOGIN_PATH, session, {}, '每日积分刷新')
      const code = businessCode(payload)
      if (isAuthError(code)) {
        result.error = 'Loomy 登录态已失效，无法刷新每日积分（请重新登录）'
        return result
      }
      if (code !== SUCCESS_CODE) {
        result.error = describeLoginError(code, upstreamMessage(payload)).replace('登录失败', '每日积分刷新失败')
        return result
      }
      // The call is idempotent per day upstream, so "already refreshed today" is a success.
      result.ok = true
      result.actions.push('每日赠送积分已刷新')
      return result
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error)
      return result
    }
  }

  async claimItems(_account: StoredAccount, _context: AdapterContext): Promise<ClaimItem[]> {
    return []
  }

  async claim(_account: StoredAccount, item: ClaimItem, _context: AdapterContext): Promise<ClaimResult> {
    throw new UnsupportedProviderError(this.id, '领取权益')
  }

  async redeem(_input: RedeemInput, _context: AdapterContext): Promise<RedeemResult> {
    throw new UnsupportedProviderError(this.id, '兑换码')
  }

  async keepalive(_account: StoredAccount, _context: AdapterContext): Promise<KeepaliveResult> {
    throw new UnsupportedProviderError(this.id, '保活')
  }

  /** Prove the session works by pulling the model catalog — no points are consumed. */
  async testConnection(account: StoredAccount, _context: AdapterContext): Promise<AccountTestResult> {
    const startedAt = Date.now()
    try {
      const models = await this.refreshCatalog(account, _context)
      if (models.length === 0) {
        return { ok: false, latencyMs: Date.now() - startedAt, message: '目录为空：session 有效但上游没有返回模型' }
      }
      return { ok: true, model: models[0]?.upstreamSlug, latencyMs: Date.now() - startedAt, message: `session 有效，目录 ${models.length} 个模型` }
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - startedAt, message: error instanceof Error ? error.message : String(error) }
    }
  }

  // ---- Presentation ----

  toPublicProfile(account: StoredAccount): AccountProfilePublic {
    const profile = account.profile
    const str = (key: string): string => (typeof profile[key] === 'string' ? profile[key] as string : '')
    const num = (key: string): number => (typeof profile[key] === 'number' ? profile[key] as number : 0)
    const bool = (key: string): boolean => profile[key] === true
    const known = bool('balanceKnown')
    const expiresAt = num('expiresAt')
    const expiring = expiresAt > 0 && expiresAt - LOOMY_EXPIRY_MARGIN_MS <= Date.now()
    const balances = known
      ? [
          { key: 'permanent_points', label: '永久积分', value: num('permanentBalance'), unit: '积分', known: true },
          { key: 'daily_points', label: '每日赠送积分', value: num('dailyBalance'), unit: '积分', known: true },
        ]
      : []
    const extras: Record<string, unknown> = {}
    if (expiresAt > 0) extras.expiresAt = expiresAt
    if (expiring) extras.expiryNote = '会话即将过期（14 天有效期，无自动续期），如遇 401 请重新短信登录'
    return {
      nickname: str('nickname') || LOOMY_DISPLAY_NAME,
      mobileMasked: str('mobileMasked'),
      balances,
      plans: [],
      pendingClaims: 0,
      lastCheckedAt: num('lastCheckedAt'),
      lastClaimAt: 0,
      extra: extras,
    }
  }

  /** Unknown balance never deprioritises an account; only a known double-zero does. */
  hasUsableBalance(account: StoredAccount): boolean {
    if (account.profile['balanceKnown'] !== true) return true
    return (account.profile['permanentBalance'] as number ?? 0) > 0 || (account.profile['dailyBalance'] as number ?? 0) > 0
  }
}
