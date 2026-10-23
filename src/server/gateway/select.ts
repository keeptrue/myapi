import type { StoredAccount, StoredApiKey } from '../store/schema.js'
import type { StateStore } from '../store/state.js'
import { upstreamConfigFromSettings } from '../config.js'
import type { ProviderRegistry } from '../providers/registry.js'
import type { UnifiedCatalog } from '../providers/catalog.js'

export class GatewayError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

export interface PickOptions {
  key: StoredApiKey
  model?: string
  skip?: Set<string>
  allowCooling?: boolean
}

/**
 * Selects an upstream account for one request.
 *
 * Rotation is provider-agnostic: it only looks at the shell fields of `StoredAccount`
 * (enabled, cooldown, credential presence) and asks the registry for anything vendor-shaped,
 * such as whether a credential needs renewing or whether an account still has quota.
 */
export class AccountSelector {
  private cursor = 0

  constructor(
    private readonly store: StateStore,
    private readonly registry: ProviderRegistry,
    private readonly catalog: UnifiedCatalog,
  ) {}

  private adapter(account: StoredAccount) {
    return this.registry.require(account.providerId)
  }

  private usable(account: StoredAccount, options: PickOptions, now: number): boolean {
    if (!account.enabled) return false
    if (!options.allowCooling && account.cooldownUntil > now) return false
    if (options.skip?.has(account.id) === true) return false
    if (options.key.boundAccountId !== null && account.id !== options.key.boundAccountId) return false
    // The key's provider scope is the first filter: a key scoped to one provider must never
    // route through another provider's accounts.
    if (
      options.key.allowedProviders.length > 0
      && !options.key.allowedProviders.includes(account.providerId)
    ) return false
    if (account.credentialsEnc === undefined) return false
    return true
  }

  /**
   * Whether the account still has usable quota. The decision belongs to the adapter that owns
   * the vendor's numbers; an unknown provider never blocks rotation.
   */
  private hasBalance(account: StoredAccount): boolean {
    try {
      return this.adapter(account).hasUsableBalance(account)
    } catch {
      return true
    }
  }

  private modelAvailable(account: StoredAccount, model: string | undefined): boolean {
    if (model === undefined) return true
    const merged = this.catalog.resolve(model)
    if (merged === undefined || merged.providers.length === 0) return true
    return merged.providers.some(
      record => record.providerId === account.providerId && record.available,
    )
  }

  async pick(options: PickOptions): Promise<StoredAccount> {
    const now = Date.now()
    const total = this.store.accounts.length
    if (total === 0) {
      throw new GatewayError(503, 'no_upstream_account', '没有可用账号，请先在控制台添加账号')
    }
    const start = this.cursor++
    const ordered: StoredAccount[] = []
    for (let offset = 0; offset < total; offset += 1) {
      const account = this.store.accounts[(start + offset) % total]
      if (account !== undefined) ordered.push(account)
    }
    const settings = this.store.settings
    const passes: boolean[] = settings.balanceAwareRotation ? [true, false] : [false]
    const preferred: StoredAccount[] = []
    const fallback: StoredAccount[] = []
    for (const account of ordered) {
      if (!this.usable(account, options, now)) continue
      if (this.modelAvailable(account, options.model)) preferred.push(account)
      else fallback.push(account)
    }
    for (const requireBalance of passes) {
      for (const account of [...preferred, ...fallback]) {
        if (requireBalance && !this.hasBalance(account)) continue
        const adapter = this.adapter(account)
        if (adapter.needsCredentialRefresh?.(account) === true) {
          try {
            await adapter.refreshCredential(account, { config: upstreamConfigFromSettings(this.store.settings) })
          } catch {
            continue
          }
        }
        return account
      }
    }
    throw new GatewayError(503, 'all_accounts_cooling', '所有账号都不可用（已禁用、冷却中或缺少凭据）')
  }
}
