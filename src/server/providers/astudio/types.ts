export interface GeetestConfig {
  gt: string
  challenge: string
  success: boolean
  new_captcha: boolean
}

export interface GeetestCaptcha {
  challenge: string
  validate: string
  seccode: string
}

export interface AstronSession {
  accountId: string
  uid: string
  token: string
  ssoSessionId: string
  modelBearerToken: string
}

export interface ModelConfig {
  id: string
  name: string
  model: string
  provider: string
  baseUrl: string
  apiKey: string
  pointMultiplier: string
  isDefault: boolean
  isCurrent: boolean
}

export interface CatalogModel {
  slug: string
  name: string
  description: string
  contextWindow: number
  maxOutputTokens: number
  priority: number
  visibility: string
  supportedInApi: boolean
  inputModalities: string[]
  reasoningEfforts: string[]
  defaultReasoning: string
  canDisableThinking: boolean
}

export interface UserInfo {
  uid: string
  mobile: string
  nickname: string
  avatar: string
}

export interface TenantApp {
  banned: boolean
}

export interface PointsBalance {
  totalAmount: number
  totalBalance: number
  memberBalance: number
  buyBalance: number
  activityBalance: number
  sparkTotalAmount: number
  sparkTotalBalance: number
  activityNextExpireTime: string
  buyNextExpireTime: string
}

export interface Membership {
  uid: string
  active: boolean
  planCode: string
  planName: string
  endTime: string
  autoRenew: boolean
}

export interface Popup {
  popupId: number
  instanceKey: string
  componentType: string
}

export interface BetaEligibility {
  canClaim: boolean
  alreadyClaimed: boolean
  reason: string
}

export interface RedeemResult {
  points: number
  expireTime: string
}

export interface LoginResult {
  accountId: string
  uid: string
  token: string
  ssoSessionId: string
  mobile: string
  nickname: string
  avatar: string
  isNew: boolean
  banned: boolean
  modelBearerToken: string
}

export type AstronErrorKind = 'session-expired' | 'auth' | 'rate' | 'client' | 'server' | 'network' | 'invalid'

export class AstronError extends Error {
  readonly kind: AstronErrorKind
  readonly status: number
  readonly code: string
  readonly traceId: string

  constructor(kind: AstronErrorKind, message: string, options: { status?: number; code?: string; traceId?: string } = {}) {
    super(message)
    this.name = 'AstronError'
    this.kind = kind
    this.status = options.status ?? 0
    this.code = options.code ?? ''
    this.traceId = options.traceId ?? ''
  }
}

export function isSessionExpired(error: unknown): boolean {
  return error instanceof AstronError && error.kind === 'session-expired'
}

/** The upstream surface the gateway depends on; tests provide a fake. */
export interface AstronApi {
  fetchGeetest(): Promise<GeetestConfig>
  sendSmsCode(mobile: string, captcha: GeetestCaptcha): Promise<void>
  loginWithSms(mobile: string, verifyCode: string): Promise<LoginResult>
  fetchUserInfo(session: AstronSession): Promise<UserInfo>
  initTenantApp(session: AstronSession): Promise<TenantApp>
  fetchModelConfigs(session: AstronSession): Promise<{ configs: ModelConfig[]; bearer: string }>
  fetchCatalog(bearer: string): Promise<CatalogModel[]>
  pointsBalance(session: AstronSession): Promise<PointsBalance>
  membership(session: AstronSession): Promise<Membership>
  pendingPopups(session: AstronSession): Promise<Popup[]>
  completePopup(session: AstronSession, popupId: number, instanceKey: string): Promise<void>
  claimDownloadReward(session: AstronSession): Promise<void>
  betaEligibility(session: AstronSession): Promise<BetaEligibility>
  claimBeta(session: AstronSession, domainAccount: string): Promise<void>
  redeemCode(session: AstronSession, code: string): Promise<RedeemResult>
  inference(path: string, session: AstronSession, body: unknown, signal: AbortSignal): Promise<Response>
}
