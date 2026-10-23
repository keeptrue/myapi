import {
  CATALOG_MODEL_TOKEN_LIMIT,
  WORKSPACE_RESPONSE_LIMIT,
} from '../../../shared/constants.js'
import { isRecord, normalizeUid, stringField, numberField, booleanField } from '../../util.js'
import { readLimited } from '../../http.js'
import { sessionCookie } from './session.js'
import {
  AstronError,
  type AstronApi,
  type AstronSession,
  type BetaEligibility,
  type CatalogModel,
  type GeetestCaptcha,
  type GeetestConfig,
  type LoginResult,
  type Membership,
  type ModelConfig,
  type PointsBalance,
  type Popup,
  type RedeemResult,
  type TenantApp,
  type UserInfo,
} from './types.js'

export interface AstronClientOptions {
  upstreamBase: string
  modelsBase: string
  workspaceBase: string
  studioVersion: string
  clientType: string
  fetchImpl?: typeof fetch
  version?: string
}

interface EnvelopeResult {
  status: number
  flag: boolean
  code: string
  desc: string
  traceId: string
  data: unknown
  headers: Headers
}

const WORKSPACE_TIMEOUT_MS = 30_000
const LOGIN_TIMEOUT_MS = 90_000
const CATALOG_TIMEOUT_MS = 30_000

function codeString(value: unknown): string {
  if (value === undefined || value === null) return '0'
  if (typeof value === 'string') return value
  if (typeof value === 'number') return String(Math.trunc(value))
  return String(value)
}

function trimBase(value: string): string {
  return value.replace(/\/+$/u, '')
}

function classify(status: number, code: string, message: string, traceId: string): AstronError {
  if (status === 401 || status === 403 || code === '1002' || code === '1005') {
    return new AstronError('session-expired', message, { status, code, traceId })
  }
  if (status === 429) return new AstronError('rate', message, { status, code, traceId })
  if (status >= 500) return new AstronError('server', message, { status, code, traceId })
  if (status >= 400) return new AstronError('client', message, { status, code, traceId })
  return new AstronError('invalid', message, { status, code, traceId })
}

/** HTTP client for the AStudio / Astron workspace and inference endpoints. */
export class AstronClient implements AstronApi {
  private readonly baseUpstream: string
  private readonly baseModels: string
  private readonly baseWorkspace: string
  private readonly studioVersion: string
  private readonly clientType: string
  private readonly fetchImpl: typeof fetch
  private readonly version: string

  constructor(options: AstronClientOptions) {
    this.baseUpstream = trimBase(options.upstreamBase)
    this.baseModels = trimBase(options.modelsBase)
    this.baseWorkspace = trimBase(options.workspaceBase)
    this.studioVersion = options.studioVersion
    this.clientType = options.clientType
    this.fetchImpl = options.fetchImpl ?? fetch
    this.version = options.version ?? '0.1.0'
  }

  private clientHeaders(): Record<string, string> {
    return {
      clientType: this.clientType,
      studioVersion: this.studioVersion,
      Accept: 'application/json',
      'User-Agent': `myapi/${this.version}`,
    }
  }

  private async envelope(
    method: 'GET' | 'POST',
    path: string,
    options: {
      session?: AstronSession
      json?: unknown
      rawBody?: NonNullable<RequestInit['body']>
      contentType?: string
      timeoutMs?: number
      signal?: AbortSignal
    } = {},
  ): Promise<EnvelopeResult> {
    const headers: Record<string, string> = { ...this.clientHeaders() }
    if (options.session !== undefined) {
      const cookie = sessionCookie(options.session)
      if (cookie !== '') headers['Cookie'] = cookie
    }
    if (options.contentType !== undefined) headers['Content-Type'] = options.contentType
    let body: NonNullable<RequestInit['body']> | undefined = options.rawBody
    if (options.json !== undefined) {
      body = JSON.stringify(options.json)
      headers['Content-Type'] = 'application/json'
    }

    const timeout = AbortSignal.timeout(options.timeoutMs ?? WORKSPACE_TIMEOUT_MS)
    const signal = options.signal === undefined ? timeout : AbortSignal.any([timeout, options.signal])
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseWorkspace}/${path.replace(/^\/+/u, '')}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        signal,
      })
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new AstronError('network', `${path}: request timed out`)
      }
      throw new AstronError('network', `${path}: ${error instanceof Error ? error.message : String(error)}`)
    }

    const text = await readLimited(response, WORKSPACE_RESPONSE_LIMIT)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new AstronError('invalid', `${path}: upstream returned unreadable JSON (HTTP ${response.status})`, { status: response.status })
    }
    const record = isRecord(parsed) ? parsed : {}
    const code = codeString(record['code'])
    const desc = stringField(record['desc']) || stringField(record['message'])
    const traceId = stringField(record['traceId'])
    const flag = record['flag'] === undefined ? true : booleanField(record['flag'])
    if (!flag || code !== '0') {
      const message = desc !== '' ? desc : `HTTP ${response.status}`
      throw classify(response.status, code, `${path}: ${message}`, traceId)
    }
    return {
      status: response.status,
      flag,
      code,
      desc,
      traceId,
      data: record['data'],
      headers: response.headers,
    }
  }

  async fetchGeetest(): Promise<GeetestConfig> {
    const result = await this.envelope('GET', 'chat/gee-captcha')
    const data = isRecord(result.data) ? result.data : {}
    const config: GeetestConfig = {
      gt: stringField(data['gt']),
      challenge: stringField(data['challenge']),
      success: booleanField(data['success']),
      new_captcha: booleanField(data['new_captcha']),
    }
    if (config.gt === '' || config.challenge === '') {
      throw new AstronError('invalid', 'GeeTest configuration is missing gt/challenge')
    }
    return config
  }

  async sendSmsCode(mobile: string, captcha: GeetestCaptcha): Promise<void> {
    const body = new FormData()
    body.append('geetest_challenge', captcha.challenge)
    body.append('geetest_validate', captcha.validate)
    body.append('geetest_seccode', Buffer.from(captcha.seccode, 'utf8').toString('base64'))
    body.append('mobile', mobile)
    body.append('countryCode', '86')
    await this.envelope('POST', 'login/mobile/send-verify-code', { rawBody: body })
  }

  async loginWithSms(mobile: string, verifyCode: string): Promise<LoginResult> {
    const body = new FormData()
    body.append('mobile', mobile)
    body.append('verifyCode', verifyCode)
    body.append('countryCode', '86')
    const result = await this.envelope('POST', 'login/phone-quick-login', {
      rawBody: body,
      timeoutMs: LOGIN_TIMEOUT_MS,
    })
    const data = isRecord(result.data) ? result.data : {}
    const accountId = stringField(data['account_id'] ?? data['accountId'])
    const token = stringField(data['token'])
    const ssoSessionId = stringField(data['ssoSessionId'] ?? data['sso_session_id'])
    if (accountId === '' || (token === '' && ssoSessionId === '')) {
      throw new AstronError('invalid', 'login response is missing account_id/token')
    }
    const session: AstronSession = {
      accountId,
      uid: normalizeUid(stringField(data['uid'])),
      token: token !== '' ? token : ssoSessionId,
      ssoSessionId: ssoSessionId !== '' ? ssoSessionId : token,
      modelBearerToken: '',
    }
    const login: LoginResult = {
      accountId,
      uid: session.uid,
      token: session.token,
      ssoSessionId: session.ssoSessionId,
      mobile: stringField(data['mobile'] ?? data['phoneNum'] ?? data['phone']) || mobile,
      nickname: stringField(data['nickname'] ?? data['displayName'] ?? data['username'] ?? data['userName']),
      avatar: stringField(data['avatar'] ?? data['avatarUrl']),
      isNew: booleanField(data['isNew']),
      banned: false,
      modelBearerToken: '',
    }

    try {
      const tenant = await this.initTenantApp(session)
      login.banned = tenant.banned
    } catch {
      // init-app is a best-effort status call; login itself already succeeded.
    }

    if (login.uid === '' || login.mobile === '') {
      try {
        const info = await this.fetchUserInfo(session)
        if (login.uid === '') login.uid = info.uid
        if (login.mobile === '') login.mobile = info.mobile
        if (login.nickname === '') login.nickname = info.nickname
      } catch {
        // userInfo is best-effort; the uid may still be readable from later calls.
      }
    }

    const credentials = await this.fetchModelConfigs(session)
    login.modelBearerToken = credentials.bearer
    return login
  }

  async fetchUserInfo(session: AstronSession): Promise<UserInfo> {
    const result = await this.envelope('GET', 'userInfo', { session })
    const data = isRecord(result.data) ? result.data : {}
    const nested = isRecord(data['userInfo']) ? data['userInfo'] : data
    const uid = normalizeUid(stringField(nested['uid'])) || normalizeUid(session.uid)
    return {
      uid,
      mobile: stringField(nested['mobile'] ?? nested['telephone']),
      nickname: stringField(nested['nickname']),
      avatar: stringField(nested['avatar']),
    }
  }

  async initTenantApp(session: AstronSession): Promise<TenantApp> {
    const result = await this.envelope('POST', 'tenant-app/v2/init-app', { session })
    const data = isRecord(result.data) ? result.data : {}
    return { banned: booleanField(data['banned']) }
  }

  async fetchModelConfigs(session: AstronSession): Promise<{ configs: ModelConfig[]; bearer: string }> {
    const result = await this.envelope('GET', 'bot/models/configs', { session })
    const rows = Array.isArray(result.data)
      ? result.data
      : isRecord(result.data) && Array.isArray(result.data['models']) ? result.data['models'] : []
    const configs: ModelConfig[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const apiKey = stringField(row['api_key'] ?? row['apiKey'])
      configs.push({
        id: stringField(row['id']),
        name: stringField(row['name']),
        model: stringField(row['model']),
        provider: stringField(row['provider']),
        baseUrl: stringField(row['base_url'] ?? row['baseUrl']),
        apiKey,
        pointMultiplier: stringField(row['point_multiplier'] ?? row['pointMultiplier']),
        isDefault: booleanField(row['is_default'] ?? row['isDefault']),
        isCurrent: booleanField(row['is_current'] ?? row['isCurrent']),
      })
    }
    if (configs.length === 0) {
      throw new AstronError('invalid', 'the account has no available model credential')
    }
    const preferred = configs.find(item => item.isCurrent && item.apiKey !== '')
      ?? configs.find(item => item.isDefault && item.apiKey !== '')
      ?? configs.find(item => item.apiKey !== '')
    if (preferred === undefined) {
      throw new AstronError('invalid', 'the account has no usable model credential')
    }
    return { configs, bearer: preferred.apiKey }
  }

  async fetchCatalog(bearer: string): Promise<CatalogModel[]> {
    let response: Response
    try {
      response = await this.fetchImpl(`${this.baseModels}/models`, {
        headers: { ...this.clientHeaders(), Authorization: `Bearer ${bearer}` },
        signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS),
      })
    } catch (error: unknown) {
      throw new AstronError('network', `model catalog: ${error instanceof Error ? error.message : String(error)}`)
    }
    const text = await readLimited(response, CATALOG_MODEL_TOKEN_LIMIT)
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new AstronError('invalid', `model catalog: unreadable JSON (HTTP ${response.status})`, { status: response.status })
    }
    const record = isRecord(parsed) ? parsed : {}
    const code = codeString(record['code'])
    if (response.status === 401 || response.status === 403 || code === '1002' || code === '1005') {
      throw new AstronError('session-expired', 'model catalog rejected the credential', { status: response.status, code })
    }
    if (!response.ok || code !== '0') {
      throw classify(response.status, code, `model catalog: ${stringField(record['message']) || `HTTP ${response.status}`}`, '')
    }
    const data = isRecord(record['data']) ? record['data'] : {}
    const rows = Array.isArray(data['models']) ? data['models'] : []
    if (!Array.isArray(data['models'])) {
      throw new AstronError('invalid', 'model catalog carried no models array')
    }
    const models: CatalogModel[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      const levels = Array.isArray(row['supported_reasoning_levels']) ? row['supported_reasoning_levels'] : []
      const efforts: string[] = []
      let canDisableThinking = false
      for (const level of levels) {
        if (!isRecord(level)) continue
        const effort = stringField(level['effort'])
        if (effort === 'none') {
          canDisableThinking = true
          continue
        }
        if (effort !== '' && !efforts.includes(effort)) efforts.push(effort)
      }
      const modalities = Array.isArray(row['input_modalities'])
        ? row['input_modalities'].map(item => stringField(item)).filter(item => item !== '')
        : []
      models.push({
        slug: stringField(row['slug']),
        name: stringField(row['display_name']),
        description: stringField(row['description']),
        contextWindow: numberField(row['context_window']),
        maxOutputTokens: numberField(row['max_output_tokens'] ?? row['max_tokens']),
        priority: numberField(row['priority']),
        visibility: stringField(row['visibility']),
        supportedInApi: row['supported_in_api'] === undefined ? true : booleanField(row['supported_in_api']),
        inputModalities: modalities,
        reasoningEfforts: efforts,
        defaultReasoning: stringField(row['default_reasoning_level']),
        canDisableThinking,
      })
    }
    if (rows.length > 0 && models.length === 0) {
      throw new AstronError('invalid', 'model catalog resolved to an empty list')
    }
    return models
  }

  async pointsBalance(session: AstronSession): Promise<PointsBalance> {
    const result = await this.envelope('GET', 'points/balance', { session })
    const data = isRecord(result.data) ? result.data : {}
    return {
      totalAmount: numberField(data['totalAmount']),
      totalBalance: numberField(data['totalBalance']),
      memberBalance: numberField(data['memberBalance']),
      buyBalance: numberField(data['buyBalance']),
      activityBalance: numberField(data['activityBalance']),
      sparkTotalAmount: numberField(data['sparkTotalAmount']),
      sparkTotalBalance: numberField(data['sparkTotalBalance']),
      activityNextExpireTime: stringField(data['activityNextExpireTime']),
      buyNextExpireTime: stringField(data['buyNextExpireTime']),
    }
  }

  async membership(session: AstronSession): Promise<Membership> {
    const result = await this.envelope('GET', 'membership/me', { session })
    const data = isRecord(result.data) ? result.data : {}
    return {
      uid: stringField(data['uid']),
      active: booleanField(data['active']),
      planCode: stringField(data['planCode']),
      planName: stringField(data['planName']),
      endTime: stringField(data['endTime']),
      autoRenew: booleanField(data['autoRenew']),
    }
  }

  async pendingPopups(session: AstronSession): Promise<Popup[]> {
    const result = await this.envelope('GET', 'client-popups/pending', { session })
    const rows = Array.isArray(result.data) ? result.data : []
    const popups: Popup[] = []
    for (const row of rows) {
      if (!isRecord(row)) continue
      popups.push({
        popupId: numberField(row['popupId']),
        instanceKey: stringField(row['instanceKey']),
        componentType: stringField(row['componentType']),
      })
    }
    return popups
  }

  async completePopup(session: AstronSession, popupId: number, instanceKey: string): Promise<void> {
    await this.envelope('POST', 'client-popups/complete', {
      session,
      json: { popupId, instanceKey },
    })
  }

  async claimDownloadReward(session: AstronSession): Promise<void> {
    await this.envelope('POST', 'client-download-reward/claim', { session })
  }

  async betaEligibility(session: AstronSession): Promise<BetaEligibility> {
    const result = await this.envelope('GET', 'beta/claim/eligibility', { session })
    const data = isRecord(result.data) ? result.data : {}
    return {
      canClaim: booleanField(data['canClaim']),
      alreadyClaimed: booleanField(data['alreadyClaimed']),
      reason: stringField(data['reason']),
    }
  }

  async claimBeta(session: AstronSession, domainAccount: string): Promise<void> {
    await this.envelope('POST', 'beta/claim', { session, json: { domainAccount } })
  }

  async redeemCode(session: AstronSession, code: string): Promise<RedeemResult> {
    const result = await this.envelope('POST', 'redeem-codes/redeem', { session, json: { code } })
    const data = isRecord(result.data) ? result.data : {}
    const reward = isRecord(data['reward']) ? data['reward'] : data
    return {
      points: numberField(reward['points']),
      expireTime: stringField(reward['expireTime']),
    }
  }

  async inference(path: string, session: AstronSession, body: unknown, signal: AbortSignal): Promise<Response> {
    if (session.modelBearerToken === '') {
      throw new AstronError('auth', 'the account has no model credential')
    }
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.modelBearerToken}`,
      Accept: 'application/json, text/event-stream',
      clientType: this.clientType,
      'User-Agent': `myapi/${this.version}`,
    }
    if (session.uid !== '' && session.uid !== '0') headers['uid'] = session.uid
    try {
      return await this.fetchImpl(`${this.baseUpstream}/${path.replace(/^\/+/u, '')}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal,
      })
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') throw error
      throw new AstronError('network', error instanceof Error ? error.message : String(error))
    }
  }
}
