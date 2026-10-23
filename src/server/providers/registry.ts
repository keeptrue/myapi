import type { AppConfig } from '../config.js'
import type { ProviderAdapter } from './types.js'

/** Raised when a flow is requested from an adapter that does not implement it. */
export class UnsupportedProviderError extends Error {
  constructor(
    readonly providerId: string,
    readonly capability: string,
  ) {
    super(`提供商 ${providerId} 不支持${capability}`)
    this.name = 'UnsupportedProviderError'
  }
}

/** Raised when an operation needs an adapter capability that is declared but not implemented. */
export class MissingAdapterMethodError extends Error {
  constructor(
    readonly providerId: string,
    readonly method: string,
  ) {
    super(`提供商 ${providerId} 未实现 ${method}`)
    this.name = 'MissingAdapterMethodError'
  }
}

/**
 * The adapter registry.
 *
 * Adapters are constructed by the service layer (they need the store, the upstream client and
 * the master key) and injected here. The gateway and the console only ever see the registry,
 * never a concrete adapter, so adding a provider never touches them.
 */
export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter>()

  register(adapter: ProviderAdapter): void {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`提供商 ${adapter.id} 已注册`)
    }
    this.adapters.set(adapter.id, adapter)
  }

  get(id: string): ProviderAdapter | undefined {
    return this.adapters.get(id)
  }

  /** Look up an adapter or throw a message the console can show directly. */
  require(id: string): ProviderAdapter {
    const adapter = this.adapters.get(id)
    if (adapter === undefined) {
      throw new Error(`未知的提供商：${id}`)
    }
    return adapter
  }

  all(): ProviderAdapter[] {
    return [...this.adapters.values()].sort((left, right) => left.id.localeCompare(right.id))
  }

  ids(): string[] {
    return this.all().map(adapter => adapter.id)
  }

  has(id: string): boolean {
    return this.adapters.has(id)
  }

  /** Every provider id the console should offer, regardless of whether it has accounts. */
  catalogIds(): string[] {
    return this.ids()
  }

  context(config: AppConfig, signal?: AbortSignal) {
    return { config, signal }
  }
}
