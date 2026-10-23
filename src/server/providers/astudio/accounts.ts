import { createHash, randomUUID } from 'node:crypto'
import type {
  AccountDraft,
  AccountProfilePublic,
  AccountTestResult,
  ClaimItem,
  ClaimResult,
  CheckinResult,
  ProviderCapabilities,
} from '../../../shared/providers.js'
import type { AccountPublic, SecretBox, Settings } from '../../../shared/types.js'
import { PROBE_TIMEOUT_MS } from '../../../shared/constants.js'
import { credentialsAad, open, seal } from '../../crypto/secretbox.js'
import { logger as rootLogger } from '../../logger.js'
import type { StateStore } from '../../store/state.js'
import type { StoredAccount } from '../../store/schema.js'
import type { BenefitStore } from '../../store/logs.js'
import { parseAstronSession, parseConfigToml, sessionValid } from './session.js'
import {
  AstronError,
  isSessionExpired,
  type AstronApi,
  type AstronSession,
  type LoginResult,
  type PointsBalance,
} from './types.js'
import { localDayKey, normalizeUid, truncate } from '../../util.js'
import { isRecord } from '../../util.js'
import { ASTRO_PROVIDER_ID } from '../ids.js'

const CLAIMABLE_POPUPS = new Set(['DAILY_REWARD_DIALOG', 'NEW_USER_DIALOG', 'CLIENT_DOWNLOAD_REWARD_DIALOG'])

/** Display name of the provider, used where a human-readable label is required. */
export const ASTRO_PROVIDER_NAME = 'AStudio'

/**
 * Capabilities AStudio actually implements. The console renders actions from these bits and
 * the scheduler skips work for flags that are false, so nothing here may be optimistic.
 */
export const ASTRO_CAPABILITIES: ProviderCapabilities = {
  smsLogin: true,
  webLogin: false,
  pasteCredential: true,
  importFromClient: true,
  tokenRenew: true,
  catalogRefresh: true,
  balanceQuery: true,
  checkin: true,
  benefits: true,
  keepalive: true,
}

function emptyPoints(): PointsBalance {
  return {
    totalAmount: 0,
    totalBalance: 0,
    memberBalance: 0,
    buyBalance: 0,
    activityBalance: 0,
    sparkTotalAmount: 0,
    sparkTotalBalance: 0,
    activityNextExpireTime: '',
    buyNextExpireTime: '',
  }
}

/** Mask a phone number for display: `138****8000`. Never returns the full number. */
export function maskMobile(mobile: string): string {
  const value = mobile.trim()
  if (/^\d{11}$/u.test(value)) return `${value.slice(0, 3)}****${value.slice(-4)}`
  if (value.length > 6) return `${value.slice(0, 3)}***${value.slice(-2)}`
  return value
}

function localId(seed: string): string {
  return `local_${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`
}

/** Read one non-secret profile field as a string. */
export function profileString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** Read one non-secret profile field as a finite number. */
export function profileNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/** Read one non-secret profile field as a boolean. */
export function profileBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

export interface DecodedCredentials {
  map: Record<string, string>
  /** False when the blob is missing, tampered or not JSON. */
  ok: boolean
}

/**
 * Decode an account's credential blob. The blob is one AES-256-GCM `SecretBox` whose AAD binds
 * it to `id + providerId`, so a ciphertext can never be replayed against another provider.
 * A failure never throws: the caller decides whether to mark the session dead.
 */
export function decodeCredentials(account: StoredAccount, key: Buffer): DecodedCredentials {
  const raw = open(account.credentialsEnc, credentialsAad(account.id, account.providerId), key)
  if (raw === undefined) return { map: {}, ok: false }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { map: {}, ok: false }
    const map: Record<string, string> = {}
    for (const [field, value] of Object.entries(parsed)) {
      if (typeof value === 'string') map[field] = value
    }
    return { map, ok: true }
  } catch {
    return { map: {}, ok: false }
  }
}

/** Re-seal a credential map with the provider-bound AAD. */
export function encodeCredentials(
  account: Pick<StoredAccount, 'id' | 'providerId'>,
  map: Record<string, string>,
  key: Buffer,
): SecretBox {
  return seal(JSON.stringify(map), credentialsAad(account.id, account.providerId), key)
}

/** Shape accepted by the legacy `importPaste` route handler. */
export interface LegacyPasteInput {
  name?: unknown
  token?: unknown
  ssoSessionId?: unknown
  modelBearerToken?: unknown
  accountId?: unknown
  uid?: unknown
  mobile?: unknown
}

/** Shape accepted by the legacy `importFile` route handler. */
export interface LegacyImportFileInput {
  name?: unknown
  configToml?: unknown
  sessionJson?: unknown
}

/** Account persistence, credential refresh, status and benefits for AStudio. */
export class AccountService {
  private readonly log = rootLogger.child({ module: 'accounts' })

  constructor(
    private readonly store: StateStore,
    private readonly client: AstronApi,
    private readonly masterKey: Buffer,
    private readonly benefits: BenefitStore,
  ) {}

  // ---- credential blob helpers ----

  /** Decode the blob without touching the store. */
  credentialMap(account: StoredAccount): Record<string, string> {
    return decodeCredentials(account, this.masterKey).map
  }

  /** Re-seal and persist a mutated credential map. */
  writeCredentialMap(account: StoredAccount, map: Record<string, string>): StoredAccount | undefined {
    const cleaned: Record<string, string> = {}
    for (const [field, value] of Object.entries(map)) {
      if (typeof value === 'string' && value !== '') cleaned[field] = value
    }
    return this.store.updateAccount(account.id, {
      credentialsEnc: encodeCredentials(account, cleaned, this.masterKey),
      sessionOk: Object.keys(cleaned).length > 0,
    })
  }

  /** Flag an account whose credential blob cannot be decrypted. */
  markSessionFailure(account: StoredAccount): void {
    if (!account.sessionOk) return
    this.store.updateAccount(account.id, { sessionOk: false, statusNote: '凭据无法解密，请重新导入' })
  }

  /**
   * Merge a patch into the stored `profile`.
   *
   * Vendor state lives in `profile` in v2, so claim timestamps and similar fields must be
   * written through a fresh read — a stale `account.profile` would revert concurrent updates.
   */
  touchProfile(id: string, patch: Record<string, unknown>): void {
    const current = this.store.account(id)
    if (current === undefined) return
    this.store.updateAccount(id, { profile: { ...current.profile, ...patch } })
  }

  // ---- session ----

  sessionFor(account: StoredAccount): AstronSession {
    const decoded = decodeCredentials(account, this.masterKey)
    if (!decoded.ok) this.markSessionFailure(account)
    const map = decoded.map
    return {
      accountId: profileString(account.profile['accountId']),
      uid: profileString(account.profile['uid']),
      token: map['token'] ?? '',
      ssoSessionId: map['ssoSession'] ?? '',
      modelBearerToken: map['modelBearer'] ?? '',
    }
  }

  // ---- presentation ----

  toPublicProfile(account: StoredAccount): AccountProfilePublic {
    const profile = account.profile
    const creds = this.credentialMap(account)
    const mobile = creds['mobile'] ?? ''
    const pointsKnown = profileBoolean(profile['pointsKnown'])
    const planCode = profileString(profile['planCode'])
    return {
      nickname: profileString(profile['nickname']),
      mobileMasked: maskMobile(mobile),
      balances: [
        { key: 'points', label: '通用积分', value: profileNumber(profile['pointsBalance']), unit: '', known: pointsKnown },
        { key: 'spark', label: 'Spark 积分', value: profileNumber(profile['sparkBalance']), unit: '', known: pointsKnown },
      ],
      plans: planCode === ''
        ? []
        : [{ code: planCode, name: profileString(profile['planName']), active: profileBoolean(profile['planActive']) }],
      pendingClaims: profileNumber(profile['pendingPopups']),
      lastCheckedAt: profileNumber(profile['lastCheckedAt']),
      lastClaimAt: profileNumber(profile['lastClaimAt']),
      extra: {
        accountId: profileString(profile['accountId']),
        uid: profileString(profile['uid']),
        domainAccount: profileString(profile['domainAccount']),
      },
    }
  }

  toPublic(account: StoredAccount): AccountPublic {
    return {
      id: account.id,
      providerId: account.providerId,
      providerName: ASTRO_PROVIDER_NAME,
      label: account.label,
      credentialKind: account.credentialKind,
      enabled: account.enabled,
      sessionOk: account.sessionOk,
      statusNote: account.statusNote,
      lastError: account.lastError,
      lastUsedAt: account.lastUsedAt,
      cooldownUntil: account.cooldownUntil,
      successes: account.successes,
      failures: account.failures,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      capabilities: ASTRO_CAPABILITIES,
      profile: this.toPublicProfile(account),
    }
  }

  list(): AccountPublic[] {
    return this.store.accounts.map(account => this.toPublic(account))
  }

  get(id: string): StoredAccount | undefined {
    return this.store.account(id)
  }

  /**
   * v2 dedupes on `id` only, so the upstream-account lookup has to scan `profile.accountId`.
   * Used to keep a re-import from creating a second row for the same upstream account.
   */
  findByAccountId(accountId: string): StoredAccount | undefined {
    if (accountId === '') return undefined
    return this.store.accounts.find(account => profileString(account.profile['accountId']) === accountId)
  }

  // ---- persistence ----

  /** Persist an adapter-produced draft, sealing its credentials into one provider-bound blob. */
  saveDraft(draft: AccountDraft): StoredAccount {
    const profileAccountId = profileString(draft.profile['accountId'])
    const existing = profileAccountId === '' ? undefined : this.findByAccountId(profileAccountId)
    const id = existing?.id ?? randomUUID()

    const credentials: Record<string, string> = {}
    for (const [field, value] of Object.entries(draft.credentials)) {
      if (typeof value === 'string' && value !== '') credentials[field] = value
    }

    const profile: Record<string, unknown> = { ...(existing?.profile ?? {}), ...draft.profile }
    const nickname = profileString(profile['nickname'])
    if (nickname === '' && draft.nickname !== '') profile['nickname'] = draft.nickname
    const mobile = credentials['mobile'] ?? ''
    const label = draft.label.trim() !== ''
      ? draft.label.trim()
      : (nickname || mobile || profileAccountId || `${ASTRO_PROVIDER_NAME} account`)
    const now = Date.now()
    const hasCredentials = Object.keys(credentials).length > 0

    const account: StoredAccount = {
      id,
      providerId: ASTRO_PROVIDER_ID,
      label,
      credentialKind: draft.credentialKind,
      enabled: existing?.enabled ?? true,
      sessionOk: hasCredentials && (existing?.sessionOk ?? true),
      statusNote: hasCredentials ? (existing?.statusNote ?? '') : '凭据为空，请重新导入',
      lastError: existing?.lastError ?? '',
      lastUsedAt: existing?.lastUsedAt ?? 0,
      cooldownUntil: existing?.cooldownUntil ?? 0,
      successes: existing?.successes ?? 0,
      failures: existing?.failures ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      credentialsEnc: encodeCredentials({ id, providerId: ASTRO_PROVIDER_ID }, credentials, this.masterKey),
      profile,
    }
    return this.store.upsertAccount(account)
  }

  // ---- onboarding ----

  /** Turn an SMS login result into an account draft. */
  draftFromLogin(result: LoginResult): AccountDraft {
    const credentials: Record<string, string> = {}
    if (result.token !== '') credentials['token'] = result.token
    if (result.ssoSessionId !== '') credentials['ssoSession'] = result.ssoSessionId
    if (result.modelBearerToken !== '') credentials['modelBearer'] = result.modelBearerToken
    if (result.mobile !== '') credentials['mobile'] = result.mobile
    return {
      providerId: ASTRO_PROVIDER_ID,
      label: result.nickname || result.mobile || result.accountId,
      credentialKind: 'sms',
      credentials,
      profile: {
        accountId: result.accountId,
        uid: normalizeUid(result.uid),
        nickname: result.nickname,
        domainAccount: '',
        pointsKnown: false,
        pointsBalance: 0,
        sparkBalance: 0,
        planCode: '',
        planName: '',
        planActive: false,
        pendingPopups: 0,
        lastCheckedAt: 0,
        lastClaimAt: 0,
      },
      nickname: result.nickname,
      mobileMasked: maskMobile(result.mobile),
    }
  }

  /**
   * Validate pasted fields (adapter-owned names) and build a draft. Unknown fields are rejected
   * by the adapter before they reach here; this method only interprets known names.
   */
  async buildPasteDraft(fields: Record<string, string>, label?: string): Promise<AccountDraft> {
    const token = (fields['token'] ?? '').trim()
    const sso = (fields['ssoSession'] ?? '').trim()
    const bearerInput = (fields['modelBearer'] ?? '').trim()
    const accountId = (fields['accountId'] ?? '').trim()
    const uid = (fields['uid'] ?? '').trim()
    const mobile = (fields['mobile'] ?? '').trim()
    if (token === '' && sso === '' && bearerInput === '') {
      throw new Error('至少需要 chat token、ssoSessionId 或 modelBearerToken 之一')
    }
    let bearer = bearerInput
    let resolvedUid = uid
    let resolvedMobile = mobile
    let nickname = ''
    let sessionOk = false
    let statusNote = ''
    if (token !== '' || sso !== '') {
      const session: AstronSession = {
        accountId,
        uid,
        token: token !== '' ? token : sso,
        ssoSessionId: sso !== '' ? sso : token,
        modelBearerToken: bearer,
      }
      try {
        if (sessionValid(session) || sso !== '') {
          const info = await this.client.fetchUserInfo(session)
          resolvedUid = resolvedUid || info.uid
          resolvedMobile = resolvedMobile || info.mobile
          nickname = nickname || info.nickname
          const credentials = await this.client.fetchModelConfigs(session)
          bearer = bearer || credentials.bearer
          sessionOk = true
        }
      } catch (error: unknown) {
        statusNote = isSessionExpired(error) ? '会话已失效，请重新登录' : truncate(messageOf(error), 200)
      }
    }
    if (bearer === '' && !sessionOk) {
      throw new Error(statusNote !== '' ? `导入失败：${statusNote}` : '未能取得模型凭据')
    }
    const credentials: Record<string, string> = {}
    if (token !== '') credentials['token'] = token
    if (sso !== '') credentials['ssoSession'] = sso
    if (bearer !== '') credentials['modelBearer'] = bearer
    if (resolvedMobile !== '') credentials['mobile'] = resolvedMobile
    return {
      providerId: ASTRO_PROVIDER_ID,
      label: label?.trim() ?? '',
      credentialKind: sessionOk ? 'paste' : 'bearer-only',
      credentials,
      profile: {
        accountId,
        uid: normalizeUid(resolvedUid),
        nickname,
        domainAccount: '',
        pointsKnown: false,
        pointsBalance: 0,
        sparkBalance: 0,
        planCode: '',
        planName: '',
        planActive: false,
        pendingPopups: 0,
        lastCheckedAt: 0,
        lastClaimAt: 0,
      },
      nickname,
      mobileMasked: maskMobile(resolvedMobile),
    }
  }

  /** Read a locally installed client's config.toml + astron-session.json into a draft. */
  async buildImportDraft(
    files: { field: string; name: string; content: string }[],
    label?: string,
  ): Promise<AccountDraft> {
    const byField = new Map<string, string>()
    for (const file of files) byField.set(file.field, file.content)
    const configText = byField.get('configToml')
    const parsedConfig = configText === undefined ? { bearer: '', uid: '' } : parseConfigToml(configText)
    let session: ReturnType<typeof parseAstronSession> = { mobile: '', nickname: '' }
    const sessionText = byField.get('sessionJson')
    if (sessionText !== undefined && sessionText.trim() !== '') session = parseAstronSession(sessionText)
    const draft = await this.buildPasteDraft({
      token: session.token ?? '',
      ssoSession: session.ssoSessionId ?? '',
      accountId: session.accountId ?? '',
      uid: session.uid ?? parsedConfig.uid,
      mobile: session.mobile ?? '',
      modelBearer: session.modelBearerToken ?? parsedConfig.bearer,
    }, label)
    return { ...draft, credentialKind: 'client-import' }
  }

  /** Legacy onboarding path: build a draft from pasted fields, then persist it. */
  async importPaste(input: LegacyPasteInput): Promise<StoredAccount> {
    const draft = await this.buildPasteDraft({
      token: asString(input.token),
      ssoSession: asString(input.ssoSessionId),
      modelBearer: asString(input.modelBearerToken),
      accountId: asString(input.accountId),
      uid: asString(input.uid),
      mobile: asString(input.mobile),
    }, asString(input.name))
    const account = this.saveDraft(draft)
    await this.record(account, '导入账号', 'ok', draft.credentialKind === 'bearer-only' ? '仅模型凭据' : 'cookie + bearer')
    if (account.sessionOk) void this.refreshStatus(account.id).catch(() => undefined)
    return account
  }

  /** Legacy onboarding path: build a draft from imported files, then persist it. */
  async importFile(input: LegacyImportFileInput): Promise<StoredAccount> {
    const files: { field: string; name: string; content: string }[] = []
    if (typeof input.configToml === 'string') files.push({ field: 'configToml', name: 'config.toml', content: input.configToml })
    if (typeof input.sessionJson === 'string') files.push({ field: 'sessionJson', name: 'astron-session.json', content: input.sessionJson })
    const draft = await this.buildImportDraft(files, asString(input.name))
    const account = this.saveDraft(draft)
    await this.record(account, '导入账号', 'ok', 'client import')
    if (account.sessionOk) void this.refreshStatus(account.id).catch(() => undefined)
    return account
  }

  /** Legacy SMS path: build a draft from a login result, then persist it. */
  async fromLogin(result: LoginResult): Promise<StoredAccount> {
    const account = this.saveDraft(this.draftFromLogin(result))
    await this.record(account, '手机号登录', 'ok', `accountId=${result.accountId}${result.isNew ? '（新账号）' : ''}`)
    void this.refreshStatus(account.id).catch(() => undefined)
    return account
  }

  // ---- lifecycle ----

  async refreshCredential(id: string): Promise<StoredAccount> {
    const account = this.store.account(id)
    if (account === undefined) throw new Error('账号不存在')
    const session = this.sessionFor(account)
    if (session.token === '' && session.ssoSessionId === '') {
      throw new Error('账号没有会话 Cookie，无法刷新模型凭据；仅模型账号的 Bearer 被上游拒绝时，请重新导入完整会话')
    }
    try {
      const credentials = await this.client.fetchModelConfigs(session)
      const map = { ...this.credentialMap(account), modelBearer: credentials.bearer }
      this.writeCredentialMap(account, map)
      return this.store.updateAccount(id, {
        sessionOk: true,
        lastError: '',
        cooldownUntil: 0,
        statusNote: '',
      }) ?? account
    } catch (error: unknown) {
      const expired = isSessionExpired(error)
      this.store.updateAccount(id, {
        lastError: truncate(messageOf(error), 400),
        statusNote: expired ? '会话已失效，请重新登录' : account.statusNote,
        sessionOk: expired ? false : account.sessionOk,
        cooldownUntil: Date.now() + (expired ? 300 : 60) * 1000,
      })
      throw error
    }
  }

  async refreshStatus(id: string): Promise<StoredAccount> {
    const account = this.store.account(id)
    if (account === undefined) throw new Error('账号不存在')
    const session = this.sessionFor(account)
    if (session.token === '' && session.ssoSessionId === '') {
      throw new Error('账号没有会话 Cookie，无法读取权益')
    }
    const [points, membership, popups] = await Promise.allSettled([
      this.client.pointsBalance(session),
      this.client.membership(session),
      this.client.pendingPopups(session),
    ])
    const errors: string[] = []
    let sessionExpired = false
    const balance = points.status === 'fulfilled' ? points.value : emptyPoints()
    if (points.status === 'rejected') {
      errors.push(`points: ${messageOf(points.reason)}`)
      sessionExpired ||= isSessionExpired(points.reason)
    }
    if (membership.status === 'rejected') errors.push(`membership: ${messageOf(membership.reason)}`)
    const pendingCount = popups.status === 'fulfilled' ? popups.value.length : profileNumber(account.profile['pendingPopups'])
    if (popups.status === 'rejected') errors.push(`popups: ${messageOf(popups.reason)}`)

    const profilePatch: Record<string, unknown> = { lastCheckedAt: Date.now(), pendingPopups: pendingCount }
    if (points.status === 'fulfilled') {
      profilePatch['pointsKnown'] = true
      profilePatch['pointsBalance'] = balance.totalBalance
      profilePatch['sparkBalance'] = balance.sparkTotalBalance
    }
    if (membership.status === 'fulfilled') {
      profilePatch['planCode'] = membership.value.planCode
      profilePatch['planName'] = membership.value.planName
      profilePatch['planActive'] = membership.value.active
    }
    const updated = this.store.updateAccount(id, {
      profile: { ...account.profile, ...profilePatch },
      statusNote: truncate(errors.join('; '), 400),
      sessionOk: sessionExpired ? false : account.sessionOk,
    })
    if (sessionExpired) {
      this.store.updateAccount(id, { statusNote: '会话已失效，请重新登录', sessionOk: false })
    }
    return updated ?? account
  }

  async checkin(id: string): Promise<CheckinResult> {
    const account = this.store.account(id)
    if (account === undefined) throw new Error('账号不存在')
    const session = this.sessionFor(account)
    const settings = this.store.settings
    const domainAccount = profileString(account.profile['domainAccount'])
    const beforePoints = profileNumber(account.profile['pointsBalance'])
    const beforeSpark = profileNumber(account.profile['sparkBalance'])
    const result: CheckinResult = { ok: false, error: '', deltas: [], actions: [], at: Date.now() }
    try {
      const tenant = await this.client.initTenantApp(session)
      if (tenant.banned) {
        this.store.updateAccount(id, { statusNote: '账号已被封禁', enabled: false })
        result.error = '账号已被封禁'
        await this.record(account, '签到', 'failed', result.error)
        return result
      }
      result.actions.push('每日登录')
      await this.record(account, '签到', 'ok', 'init-app')
    } catch (error: unknown) {
      result.error = truncate(messageOf(error), 300)
      await this.record(account, '签到', 'failed', result.error)
      if (isSessionExpired(error)) this.store.updateAccount(id, { sessionOk: false, statusNote: '会话已失效，请重新登录' })
      return result
    }

    if (settings.checkinCompletePopups) {
      try {
        const popups = await this.client.pendingPopups(session)
        for (const popup of popups) {
          if (!CLAIMABLE_POPUPS.has(popup.componentType)) continue
          try {
            await this.client.completePopup(session, popup.popupId, popup.instanceKey)
            result.actions.push(popupLabel(popup.componentType))
            await this.record(account, popupLabel(popup.componentType), 'ok', `popupId=${popup.popupId}`)
          } catch (error: unknown) {
            await this.record(account, popupLabel(popup.componentType), 'failed', truncate(messageOf(error), 200))
          }
        }
      } catch (error: unknown) {
        await this.record(account, '领取弹窗', 'failed', truncate(messageOf(error), 200))
      }
    }

    if (settings.checkinClaimDownload) {
      try {
        await this.client.claimDownloadReward(session)
        result.actions.push('客户端下载奖励')
        await this.record(account, '客户端下载奖励', 'ok', '')
      } catch (error: unknown) {
        const ignored = isAlreadyClaimed(error)
        await this.record(account, '客户端下载奖励', ignored ? 'skipped' : 'failed', ignored ? '今日已领取' : truncate(messageOf(error), 200))
      }
    }

    if (settings.checkinClaimBeta && domainAccount.trim() !== '') {
      try {
        const eligibility = await this.client.betaEligibility(session)
        if (eligibility.canClaim) {
          await this.client.claimBeta(session, domainAccount.trim())
          result.actions.push('Beta 资格')
          await this.record(account, 'Beta 领取', 'ok', domainAccount)
          await this.refreshCredential(id).catch(() => undefined)
        } else {
          await this.record(account, 'Beta 领取', 'skipped', eligibility.reason || '不具备领取资格')
        }
      } catch (error: unknown) {
        await this.record(account, 'Beta 领取', 'failed', truncate(messageOf(error), 200))
      }
    }

    try {
      const refreshed = await this.refreshStatus(id)
      const afterPoints = profileNumber(refreshed.profile['pointsBalance'])
      const afterSpark = profileNumber(refreshed.profile['sparkBalance'])
      result.deltas = [
        { key: 'points', label: '通用积分', value: afterPoints - beforePoints },
        { key: 'spark', label: 'Spark 积分', value: afterSpark - beforeSpark },
      ]
      this.store.recordCheckin(id, localDayKey(), result.actions.join('、') || '已签到', result.deltas.reduce((sum, delta) => sum + delta.value, 0))
      this.touchProfile(id, { lastClaimAt: Date.now() })
      result.ok = true
      if (result.actions.length > 0 && result.deltas.every(delta => delta.value === 0)) {
        await this.record(account, '结算', 'skipped', '调用成功但积分无变化（可能今日已领）')
      }
    } catch (error: unknown) {
      result.error = truncate(messageOf(error), 300)
    }
    return result
  }

  async checkinAll(): Promise<CheckinResult[]> {
    return Promise.all(this.store.accounts.filter(account => account.enabled).map(account => this.checkin(account.id)))
  }

  async keepalive(id: string): Promise<void> {
    const account = this.store.account(id)
    if (account === undefined || !account.enabled) return
    try {
      await this.refreshCredential(id)
      await this.refreshStatus(id)
      await this.record(account, '保活', 'ok', '')
    } catch (error: unknown) {
      await this.record(account, '保活', 'failed', truncate(messageOf(error), 300))
      throw error
    }
  }

  async test(id: string, model: string): Promise<AccountTestResult> {
    const account = this.store.account(id)
    if (account === undefined) throw new Error('账号不存在')
    const session = this.sessionFor(account)
    const started = Date.now()
    try {
      const response = await this.client.inference('chat/completions', session, {
        model,
        messages: [{ role: 'user', content: `ping-${Date.now().toString(36)}` }],
        max_tokens: 1,
        stream: false,
      }, AbortSignal.timeout(PROBE_TIMEOUT_MS))
      const text = await response.text().catch(() => '')
      const latencyMs = Date.now() - started
      if (!response.ok) {
        return { ok: false, model, latencyMs, message: truncate(text, 300) || `HTTP ${response.status}` }
      }
      this.store.updateAccount(id, { successes: account.successes + 1, lastUsedAt: Date.now(), lastError: '' })
      return { ok: true, model, latencyMs, message: 'ok' }
    } catch (error: unknown) {
      const latencyMs = Date.now() - started
      this.store.updateAccount(id, { failures: account.failures + 1, lastError: truncate(messageOf(error), 300) })
      return { ok: false, model, latencyMs, message: truncate(messageOf(error), 300) }
    }
  }

  async redeem(id: string, code: string): Promise<{ points: number; expireTime: string }> {
    const account = this.store.account(id)
    if (account === undefined) throw new Error('账号不存在')
    const session = this.sessionFor(account)
    try {
      const result = await this.client.redeemCode(session, code.trim())
      await this.record(account, '兑换码', 'ok', `+${result.points} 积分`)
      await this.refreshStatus(id).catch(() => undefined)
      return result
    } catch (error: unknown) {
      await this.record(account, '兑换码', 'failed', truncate(messageOf(error), 200))
      throw error
    }
  }

  // ---- benefits ----

  async claimableItems(account: StoredAccount): Promise<ClaimItem[]> {
    const session = this.sessionFor(account)
    const settings = this.store.settings
    const items: ClaimItem[] = []
    try {
      const popups = await this.client.pendingPopups(session)
      for (const popup of popups) {
        if (!CLAIMABLE_POPUPS.has(popup.componentType)) continue
        items.push({ id: `popup:${popup.popupId}`, label: popupLabel(popup.componentType), kind: 'popup' })
      }
    } catch (error: unknown) {
      await this.record(account, '领取弹窗', 'failed', truncate(messageOf(error), 200))
    }
    if (settings.checkinClaimDownload) items.push({ id: 'download', label: '客户端下载奖励', kind: 'download' })
    if (settings.checkinClaimBeta && profileString(account.profile['domainAccount']).trim() !== '') {
      items.push({ id: 'beta', label: 'Beta 资格', kind: 'beta' })
    }
    return items
  }

  async claimItem(account: StoredAccount, item: ClaimItem): Promise<ClaimResult> {
    const session = this.sessionFor(account)
    try {
      if (item.kind === 'popup') {
        const popups = await this.client.pendingPopups(session)
        const popup = popups.find(entry => `popup:${entry.popupId}` === item.id)
        if (popup === undefined) return { ...item, ok: false, message: '该奖励当前不可领取' }
        await this.client.completePopup(session, popup.popupId, popup.instanceKey)
        this.touchProfile(account.id, { lastClaimAt: Date.now() })
        return { ...item, ok: true, message: '领取成功' }
      }
      if (item.kind === 'download') {
        await this.client.claimDownloadReward(session)
        this.touchProfile(account.id, { lastClaimAt: Date.now() })
        return { ...item, ok: true, message: '领取成功' }
      }
      if (item.kind === 'beta') {
        const eligibility = await this.client.betaEligibility(session)
        if (!eligibility.canClaim) return { ...item, ok: false, message: eligibility.reason || '不具备领取资格' }
        await this.client.claimBeta(session, profileString(account.profile['domainAccount']).trim())
        this.touchProfile(account.id, { lastClaimAt: Date.now() })
        return { ...item, ok: true, message: '领取成功' }
      }
      return { ...item, ok: false, message: '未知的领取项' }
    } catch (error: unknown) {
      if (isAlreadyClaimed(error)) return { ...item, ok: true, message: '今日已领取' }
      return { ...item, ok: false, message: truncate(messageOf(error), 200) }
    }
  }

  // ---- bookkeeping ----

  async record(account: StoredAccount, action: string, result: 'ok' | 'failed' | 'skipped', detail: string): Promise<void> {
    const profile = account.profile
    await this.benefits.append({
      time: Date.now(),
      accountId: account.id,
      accountName: profileString(profile['nickname']) || account.label || profileString(profile['accountId']),
      action,
      result,
      detail: truncate(detail, 400),
    }).catch(() => undefined)
  }

  markUsed(id: string): void {
    const account = this.store.account(id)
    if (account === undefined) return
    this.store.updateAccount(id, { successes: account.successes + 1, lastUsedAt: Date.now(), lastError: '' })
  }

  markFailed(id: string, message: string, cooldownSeconds: number): void {
    const account = this.store.account(id)
    if (account === undefined) return
    const cooldown = Math.min(Math.max(cooldownSeconds, 20) * (1 + Math.min(account.failures, 4)), 300)
    this.store.updateAccount(id, {
      failures: account.failures + 1,
      lastError: truncate(message, 400),
      cooldownUntil: Date.now() + cooldown * 1000,
    })
  }
}

function popupLabel(componentType: string): string {
  if (componentType === 'DAILY_REWARD_DIALOG') return '每日奖励'
  if (componentType === 'NEW_USER_DIALOG') return '新人奖励'
  if (componentType === 'CLIENT_DOWNLOAD_REWARD_DIALOG') return '下载奖励'
  return `弹窗:${componentType}`
}

function isAlreadyClaimed(error: unknown): boolean {
  if (!(error instanceof AstronError)) return false
  if (error.code === '11003002' || error.code === '11003001') return true
  const message = error.message.toLowerCase()
  return message.includes('already') || message.includes('已领') || message.includes('重复')
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
