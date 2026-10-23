import type { AccountPublic } from '../shared/types.js'
import type { AccountTestResult, CheckinResult, KeepaliveResult } from '../shared/providers.js'
import { ASTRO_PROVIDER_ID } from './providers/ids.js'
import { toAccountPublic } from './providers/public.js'
import { upstreamConfigFromSettings } from './config.js'
import { UnsupportedProviderError } from './providers/registry.js'
import type { Services } from './services.js'
import type { StoredAccount } from './store/schema.js'

/**
 * Provider-agnostic account operations.
 *
 * Panel routes and the scheduler call these instead of reaching into the AStudio
 * account service, so every provider's accounts get the same lifecycle handling:
 * the registry picks the adapter, the capability bits decide whether the work
 * applies, and no caller ever branches on a vendor id (the one legacy exception is
 * marked for M6, when the scheduler itself becomes provider-aware).
 */

function requireAccount(services: Services, id: string): StoredAccount {
  const account = services.store.account(id)
  if (account === undefined) throw new Error('账号不存在')
  return account
}

function requireAdapter(services: Services, account: StoredAccount) {
  return services.registry.require(account.providerId)
}

function context(services: Services) {
  return { config: upstreamConfigFromSettings(services.store.settings) }
}

/** Run one account's daily check-in through its own adapter. */
export async function checkinAccount(services: Services, id: string): Promise<CheckinResult> {
  const account = requireAccount(services, id)
  const adapter = requireAdapter(services, account)
  if (!adapter.capabilities.checkin) {
    throw new UnsupportedProviderError(adapter.id, '签到')
  }
  return adapter.checkin(account, context(services))
}

/** Check in every enabled account that declares the capability, skipping the rest. */
export async function checkinAllAccounts(services: Services): Promise<CheckinResult[]> {
  const results: CheckinResult[] = []
  for (const account of services.store.accounts.filter(item => item.enabled && item.credentialsEnc !== undefined)) {
    const adapter = services.registry.get(account.providerId)
    if (adapter === undefined || !adapter.capabilities.checkin) continue
    results.push(await adapter.checkin(account, context(services)))
  }
  return results
}

/** Run one keepalive ping through its own adapter. */
export async function keepaliveAccount(services: Services, id: string): Promise<KeepaliveResult> {
  const account = requireAccount(services, id)
  const adapter = requireAdapter(services, account)
  if (!adapter.capabilities.keepalive) {
    throw new UnsupportedProviderError(adapter.id, '保活')
  }
  return adapter.keepalive(account, context(services))
}

/** Keep every enabled account that declares keep-alive alive, skipping the rest. */
export async function keepaliveAllAccounts(services: Services): Promise<void> {
  for (const account of services.store.accounts.filter(item => item.enabled)) {
    const adapter = services.registry.get(account.providerId)
    if (adapter === undefined || !adapter.capabilities.keepalive) continue
    await adapter.keepalive(account, context(services))
  }
}

/**
 * Test one account's credential through its own adapter.
 *
 * AStudio keeps its explicit-model probe (the console sends a chosen slug); every other
 * adapter picks its own minimal round-trip.
 */
export async function testAccount(services: Services, id: string, modelHint?: string): Promise<AccountTestResult> {
  const account = requireAccount(services, id)
  const adapter = requireAdapter(services, account)
  if (adapter.id === ASTRO_PROVIDER_ID && modelHint !== undefined) {
    return services.accounts.test(id, modelHint)
  }
  return adapter.testConnection(account, context(services))
}

/**
 * Renew one account's credential through its own adapter.
 *
 * Legacy note (M6 will absorb this): AStudio couples renewal with a status probe inside
 * its account service, so that path keeps running through the service until then.
 */
export async function refreshAccountCredential(services: Services, id: string): Promise<AccountPublic> {
  const account = requireAccount(services, id)
  const adapter = requireAdapter(services, account)
  if (adapter.id === ASTRO_PROVIDER_ID) {
    await services.accounts.refreshCredential(id)
    const refreshed = await services.accounts.refreshStatus(id)
    return services.accounts.toPublic(refreshed)
  }
  if (!adapter.capabilities.tokenRenew) {
    throw new UnsupportedProviderError(adapter.id, '凭证续期')
  }
  await adapter.refreshCredential(account, context(services))
  const updated = services.store.account(id) ?? account
  return toAccountPublic(services, updated)
}
