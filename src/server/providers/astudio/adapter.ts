import type { StoredAccount } from '../../store/schema.js'
import type { StateStore } from '../../store/state.js'
import type { ProviderAdapter, AdapterContext, InferenceRequest } from '../types.js'
import type {
  AccountDraft,
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
  SmsVerifyInput,
  WebLoginCompleteInput,
  WebLoginSession,
} from '../../../shared/providers.js'
import type { AccountService } from './accounts.js'
import {
  ASTRO_CAPABILITIES,
  ASTRO_PROVIDER_NAME,
  profileBoolean,
  profileNumber,
  profileString,
} from './accounts.js'
import type { CatalogService } from './catalog.js'
import type { AstronApi } from './types.js'
import { ASTRO_PROVIDER_ID } from '../ids.js'
import { UnsupportedProviderError } from '../registry.js'
import { completeSmsLogin, dispatchSmsCode } from './login.js'

/**
 * The AStudio (讯飞星辰 / Astron Studio) adapter.
 *
 * It is a thin shell over the pre-existing AStudio implementation: `AccountService` owns
 * credentials, benefits and check-in, `CatalogService` owns the dual-source model catalog,
 * and `AstronClient` owns the wire. This class only translates between those and the
 * provider-agnostic contract the gateway consumes, so the gateway never learns a vendor name.
 */
export class AStudioAdapter implements ProviderAdapter {
  readonly id = ASTRO_PROVIDER_ID
  readonly displayName = ASTRO_PROVIDER_NAME
  readonly vendor = '科大讯飞'
  readonly capabilities = ASTRO_CAPABILITIES

  constructor(
    private readonly accounts: AccountService,
    private readonly catalog: CatalogService,
    private readonly client: AstronApi,
    private readonly store: StateStore,
  ) {}

  // ---- Onboarding ----

  credentialDescriptors(): CredentialDescriptor[] {
    return [
      { field: 'token', label: 'chat token', hint: 'config.toml 的 experimental_bearer_token', secret: true, required: false },
      { field: 'ssoSession', label: 'ssoSessionId', hint: 'astron-session.json 的 ssoSessionId', secret: true, required: false },
      { field: 'accountId', label: 'accountId', hint: 'astron-session.json 的 accountId', secret: false, required: false },
      { field: 'uid', label: 'uid', hint: '可留空，导入时会尝试从 userInfo 补齐', secret: false, required: false },
      { field: 'mobile', label: '手机号', hint: '中国大陆 11 位手机号', secret: true, required: false },
      { field: 'modelBearer', label: 'modelBearerToken', hint: '32位hex:base64，留空时网关会自动换取', secret: true, required: false },
    ]
  }

  importDescriptors() {
    return [
      { field: 'configToml', label: 'config.toml', hint: '可选，提供模型 Bearer', accept: '.toml,text/plain' },
      { field: 'sessionJson', label: 'astron-session.json', hint: '可选，提供完整会话', accept: '.json,application/json' },
    ]
  }

  sendSms(input: SmsSendInput): Promise<void> {
    // The GeeTest triplet was solved by a human in the browser; we only forward it.
    return dispatchSmsCode(this.client, input.mobile, input.challenge)
  }

  async verifySms(input: SmsVerifyInput): Promise<AccountDraft> {
    const result = await completeSmsLogin(this.client, input)
    return this.accounts.draftFromLogin(result)
  }

  async addByPaste(input: PasteInput): Promise<AccountDraft> {
    return this.accounts.buildPasteDraft(this.validateCredentialFields(input.fields), input.label)
  }

  async addByImport(input: ImportInput): Promise<AccountDraft> {
    this.validateImportFields(input.files.map(file => file.field))
    return this.accounts.buildImportDraft(input.files, input.label)
  }

  /** AStudio authenticates by phone + SMS, not by a browser authorization round-trip. */
  startWebLogin(): Promise<WebLoginSession> {
    // The gateway's stateId and redirectUri are accepted and deliberately unused.
    return Promise.reject(new UnsupportedProviderError(this.id, '网页授权登录'))
  }

  completeWebLogin(input: WebLoginCompleteInput): Promise<AccountDraft> {
    return Promise.reject(new UnsupportedProviderError(input.providerId, '网页授权登录'))
  }

  // ---- Lifecycle ----

  async inference(request: InferenceRequest): Promise<Response> {
    const session = this.accounts.sessionFor(request.account)
    return this.client.inference(request.path, session, request.body, request.signal)
  }

  async refreshCredential(account: StoredAccount): Promise<void> {
    // Refreshing writes back through the store; the caller must re-read the account.
    await this.accounts.refreshCredential(account.id)
  }

  /** AStudio can always trade its cookie for a model bearer token, so renew on demand. */
  needsCredentialRefresh(account: StoredAccount): boolean {
    const map = this.accounts.credentialMap(account)
    return map['modelBearer'] === '' && map['token'] !== ''
  }

  async refreshCatalog(account: StoredAccount): Promise<ModelRecord[]> {
    await this.catalog.refresh()
    return this.catalog.toModelRecords([account.id])
  }

  async queryBalance(account: StoredAccount): Promise<BalanceSnapshot> {
    const known = profileBoolean(account.profile['pointsKnown'])
    return {
      known,
      balances: [
        { key: 'points', label: '通用积分', value: profileNumber(account.profile['pointsBalance']), unit: '', known },
        { key: 'spark', label: 'Spark 积分', value: profileNumber(account.profile['sparkBalance']), unit: '', known },
      ],
      fetchedAt: profileNumber(account.profile['lastCheckedAt']),
    }
  }

  async checkin(account: StoredAccount): Promise<CheckinResult> {
    return this.accounts.checkin(account.id)
  }

  async claimItems(account: StoredAccount): Promise<ClaimItem[]> {
    return this.accounts.claimableItems(account)
  }

  async claim(account: StoredAccount, item: ClaimItem): Promise<ClaimResult> {
    return this.accounts.claimItem(account, item)
  }

  async redeem(input: RedeemInput): Promise<RedeemResult> {
    const account = this.store.account(input.accountId)
    if (account === undefined) {
      return { ok: false, message: '账号不存在', deltas: [], at: Date.now() }
    }
    const result = await this.accounts.redeem(account.id, input.code)
    return {
      ok: true,
      message: `兑换成功，有效期至 ${result.expireTime}`,
      deltas: [{ key: 'points', label: '通用积分', value: result.points }],
      at: Date.now(),
    }
  }

  async keepalive(account: StoredAccount): Promise<KeepaliveResult> {
    await this.accounts.keepalive(account.id)
    return { ok: true, message: '保活完成', at: Date.now() }
  }

  async testConnection(account: StoredAccount): Promise<AccountTestResult> {
    // Probe the highest-priority model this account can actually serve; never invent a name.
    const models = this.catalog.toModelRecords([account.id]).sort((left, right) => left.priority - right.priority)
    const model = models[0]?.upstreamSlug
    if (model === undefined) {
      return { ok: false, latencyMs: 0, message: '该账号没有可用模型' }
    }
    return this.accounts.test(account.id, model)
  }

  // ---- Presentation ----

  toPublicProfile(account: StoredAccount) {
    return this.accounts.toPublicProfile(account)
  }

  modelAvailable(account: StoredAccount, model: string): boolean {
    return this.catalog.modelAvailableForAccount(account.id, model)
  }

  /** An account with unknown balance is never deprioritised; only a known-zero one is. */
  hasUsableBalance(account: StoredAccount): boolean {
    const known = profileBoolean(account.profile['pointsKnown'])
    if (!known) return true
    return profileNumber(account.profile['pointsBalance']) > 0
      || profileNumber(account.profile['sparkBalance']) > 0
  }

  /** Convenience for the console: the account's vendor-side id, if it has one. */
  vendorAccountId(account: StoredAccount): string {
    return profileString(account.profile['accountId'])
  }

  context(input: AdapterContext): AdapterContext {
    return input
  }

  /** Reject paste fields the adapter does not own, so a typo cannot silently drop a credential. */
  private validateCredentialFields(fields: Record<string, string>): Record<string, string> {
    const known = new Set(this.credentialDescriptors().map(descriptor => descriptor.field))
    const out: Record<string, string> = {}
    for (const [field, value] of Object.entries(fields)) {
      if (!known.has(field)) throw new Error(`未知的凭据字段：${field}`)
      if (typeof value === 'string' && value.trim() !== '') out[field] = value.trim()
    }
    return out
  }

  /** Reject import file slots the adapter does not declare. */
  private validateImportFields(fields: string[]): void {
    const known = new Set(this.importDescriptors().map(descriptor => descriptor.field))
    for (const field of fields) {
      if (!known.has(field)) throw new Error(`未知的导入字段：${field}`)
    }
  }
}
