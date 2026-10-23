import type { AccountProfilePublic } from '../../shared/providers.js'
import { emptyCapabilities } from '../../shared/providers.js'
import type { AccountPublic } from '../../shared/types.js'
import type { Services } from '../services.js'
import type { StoredAccount } from '../store/schema.js'

function emptyProfilePublic(): AccountProfilePublic {
  return {
    nickname: '',
    mobileMasked: '',
    balances: [],
    plans: [],
    pendingClaims: 0,
    lastCheckedAt: 0,
    lastClaimAt: 0,
    extra: {},
  }
}

/**
 * Map a stored account onto the console-facing DTO.
 *
 * The shell fields come straight off the record; everything vendor-shaped comes from the
 * adapter that owns the account. Callers never learn a provider's field names.
 */
export function toAccountPublic(services: Services, account: StoredAccount): AccountPublic {
  const adapter = services.registry.get(account.providerId)
  return {
    id: account.id,
    providerId: account.providerId,
    providerName: adapter?.displayName ?? account.providerId,
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
    capabilities: adapter?.capabilities ?? emptyCapabilities(),
    profile: adapter?.toPublicProfile(account) ?? emptyProfilePublic(),
  }
}
