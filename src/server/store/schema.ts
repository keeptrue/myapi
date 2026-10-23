import type {
  ApiKeyPublic,
  BenefitEvent,
  Counter,
  LogEntry,
  ProbeRecord,
  SecretBox,
  Settings,
  Stats,
} from '../../shared/types.js'
import type { CredentialKind } from '../../shared/providers.js'

/**
 * An account record, split into a provider-agnostic shell and a vendor-owned interior.
 *
 * The shell carries everything the gateway needs to pick, rotate and cool down an account.
 * The interior carries everything that is specific to one vendor:
 *   - `credentialsEnc` — one AES-256-GCM blob whose AAD binds it to `id + providerId`, so a
 *     ciphertext can never be replayed against another provider. Field names inside are
 *     adapter-defined.
 *   - `profile` — non-secret vendor state (points, membership, claim calendar, …). Stored
 *     verbatim and only ever interpreted by the adapter that owns it.
 */
export interface StoredAccount {
  id: string
  providerId: string
  label: string
  credentialKind: CredentialKind
  enabled: boolean

  // ---- provider-agnostic runtime state ----
  sessionOk: boolean
  statusNote: string
  lastError: string
  lastUsedAt: number
  cooldownUntil: number
  successes: number
  failures: number
  createdAt: number
  updatedAt: number

  // ---- vendor-owned interior ----
  credentialsEnc: SecretBox
  profile: Record<string, unknown>
}

export function emptyProfile(): Record<string, unknown> {
  return {}
}

export interface StoredApiKey extends ApiKeyPublic {
  keyHmac: string
}

export interface State {
  schemaVersion: 2
  auth: {
    passwordHash: string
    authVersion: number
    passwordGenerated: boolean
    /** Admin username; empty until M5 registration lands. */
    adminUser: string
    createdAt: number
  }
  settings: Settings
  accounts: StoredAccount[]
  apiKeys: StoredApiKey[]
  modelVisibility: { hidden: string[] }
  modelAliases: Record<string, string>
  modelReferences: Record<string, string>
  probes: ProbeRecord[]
  stats: Stats
  checkin: Record<string, { day: string; result: string; delta: number; at: number }>
  scheduler: {
    lastCatalogAt?: number
    lastKeepaliveAt?: number
    lastCheckinDay?: string
  }
}

export function emptyCounter(): Counter {
  return {
    requests: 0,
    successes: 0,
    failures: 0,
    promptTokens: 0,
    completionTokens: 0,
    cachedTokens: 0,
    reasoningTokens: 0,
    firstTokenMsSum: 0,
    firstTokenCount: 0,
  }
}

export function emptyStats(): Stats {
  return { total: emptyCounter(), byModel: {}, byHour: {}, byAccount: {}, byKey: {} }
}

export function emptyState(settings: Settings): State {
  return {
    schemaVersion: 2,
    auth: { passwordHash: '', authVersion: 1, passwordGenerated: false, adminUser: '', createdAt: Date.now() },
    settings,
    accounts: [],
    apiKeys: [],
    modelVisibility: { hidden: [] },
    modelAliases: {},
    modelReferences: {},
    probes: [],
    stats: emptyStats(),
    checkin: {},
    scheduler: {},
  }
}

export type { ApiKeyPublic, BenefitEvent, LogEntry, ProbeRecord, Settings, Stats }
