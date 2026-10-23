import type { StoredAccount, StoredApiKey } from '../store/schema.js'
import type { StateStore } from '../store/state.js'
import type { AccountService } from '../astron/accounts.js'
import type { CatalogService } from '../astron/catalog.js'

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

/** Selects an upstream account for one request. */
export class AccountSelector {
  private cursor = 0

  constructor(
    private readonly store: StateStore,
    private readonly accounts: AccountService,
    private readonly catalog: CatalogService,
  ) {}

  private usable(account: StoredAccount, options: PickOptions, now: number): boolean {
    if (!account.enabled) return false
    if (!options.allowCooling && account.cooldownUntil > now) return false
    if (options.skip?.has(account.id) === true) return false
    if (options.key.boundAccountId !== null && account.id !== options.key.boundAccountId) return false
    if (account.tokenEnc === undefined && account.modelBearerEnc === undefined) return false
    if (options.model !== undefined && options.key.allowedModels.length > 0) {
      const model = this.catalog.resolve(options.model)
      const names = new Set([options.model.toLowerCase(), model?.slug.toLowerCase(), model?.name.toLowerCase()])
      if (!options.key.allowedModels.some(allowed => names.has(allowed.toLowerCase()))) return false
    }
    return true
  }

  private hasBalance(account: StoredAccount): boolean {
    return !account.pointsKnown || account.pointsBalance > 0 || account.sparkBalance > 0
  }

  private modelAvailable(account: StoredAccount, model: string | undefined): boolean {
    if (model === undefined) return true
    const info = this.catalog.resolve(model)
    if (info === undefined || info.availableAccountIds.length === 0) return true
    return info.availableAccountIds.includes(account.id)
  }

  async pick(options: PickOptions): Promise<StoredAccount> {
    const now = Date.now()
    const total = this.store.accounts.length
    if (total === 0) {
      throw new GatewayError(503, 'no_upstream_account', '没有可用账号，请先在控制台添加 AStudio 账号')
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
        if (account.modelBearerEnc === undefined) {
          try {
            await this.accounts.refreshCredential(account.id)
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
