import { credentialsAad, legacyCredentialAad, open, seal } from '../crypto/secretbox.js'
import type { ProbeRecord, SecretBox, Settings, Stats } from '../../shared/types.js'
import type { CredentialKind } from '../../shared/providers.js'
import { emptyState, type State, type StoredAccount, type StoredApiKey } from '../store/schema.js'
import { ASTRO_PROVIDER_ID } from './ids.js'

/**
 * Schema v1 → v2 account migration.
 *
 * v1 (single-provider) stored AStudio's credential fields as three separate SecretBox values
 * with per-field AAD, and mixed vendor state (points, membership, claim calendar) into the
 * account record itself. v2 collapses credentials into one provider-bound blob and moves
 * vendor state into `profile`.
 *
 * Migration never guesses: a field that cannot be decrypted is dropped, and the account is
 * flagged `sessionOk = false` so the console asks for a fresh import.
 */

export interface V1Account {
  id?: unknown
  name?: unknown
  accountId?: unknown
  uid?: unknown
  tokenEnc?: unknown
  ssoSessionEnc?: unknown
  modelBearerEnc?: unknown
  mobile?: unknown
  nickname?: unknown
  domainAccount?: unknown
  source?: unknown
  enabled?: unknown
  sessionOk?: unknown
  statusNote?: unknown
  lastError?: unknown
  lastUsedAt?: unknown
  cooldownUntil?: unknown
  successes?: unknown
  failures?: unknown
  pointsKnown?: unknown
  pointsBalance?: unknown
  sparkBalance?: unknown
  planCode?: unknown
  planName?: unknown
  planActive?: unknown
  pendingPopups?: unknown
  lastCheckedAt?: unknown
  lastClaimAt?: unknown
  createdAt?: unknown
  updatedAt?: unknown
}

/** Field names inside the v2 credential blob for the AStudio adapter. */
const CREDENTIAL_FIELDS = ['token', 'ssoSession', 'modelBearer', 'mobile'] as const

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function asBoolean(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

/** Detect a v1 document. v2 documents carry `schemaVersion: 2`. */
export function looksLikeV1(raw: unknown): raw is { schemaVersion: 1; accounts: V1Account[] } {
  if (typeof raw !== 'object' || raw === null) return false
  const record = raw as Record<string, unknown>
  return record['schemaVersion'] === 1 && Array.isArray(record['accounts'])
}

function kindOf(source: unknown): CredentialKind {
  switch (source) {
    case 'sms-login':
      return 'sms'
    case 'file-import':
      return 'client-import'
    case 'model-only':
      return 'bearer-only'
    case 'paste':
    default:
      return 'paste'
  }
}

/** A schema v1 document, as written by the single-provider build. */
export interface V1State {
  schemaVersion: 1
  auth?: {
    passwordHash?: unknown
    authVersion?: unknown
    passwordGenerated?: unknown
    createdAt?: unknown
  }
  settings?: Partial<Settings>
  accounts?: V1Account[]
  apiKeys?: StoredApiKey[]
  modelVisibility?: { hidden?: string[] }
  modelAliases?: Record<string, string>
  modelReferences?: Record<string, string>
  probes?: ProbeRecord[]
  stats?: Stats
  checkin?: Record<string, { day: string; result: string; delta: number; at: number }>
  scheduler?: State['scheduler']
}

/**
 * Convert a whole v1 document into a v2 document.
 *
 * Only `accounts`, `auth`, `settings` and `schemaVersion` actually changed between the two
 * revisions; keys, probes, stats, check-in history and the scheduler ledger carry over verbatim.
 */
export function migrateV1State(raw: V1State, settings: Settings, key: Buffer): State {
  const base = emptyState(settings)
  const auth = raw.auth ?? {}
  const mergedSettings: Settings = { ...settings, ...(raw.settings ?? {}) }
  return {
    ...base,
    ...raw,
    schemaVersion: 2,
    settings: mergedSettings,
    auth: {
      passwordHash: asString(auth.passwordHash),
      authVersion: asNumber(auth.authVersion, base.auth.authVersion),
      passwordGenerated: asBoolean(auth.passwordGenerated),
      adminUser: '',
      createdAt: asNumber(auth.createdAt, base.auth.createdAt),
    },
    accounts: (raw.accounts ?? []).map(account => migrateV1Account(account, key)),
    modelVisibility: { hidden: stringArray(raw.modelVisibility?.hidden) },
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

export function migrateV1Account(raw: V1Account, key: Buffer): StoredAccount {
  const id = asString(raw.id)
  const providerId = ASTRO_PROVIDER_ID

  // Decrypt each legacy field with its old AAD, then re-seal everything into one blob that is
  // bound to both the account id and the provider id.
  const credentials: Record<string, string> = {}
  let recovered = 0
  // A phone number alone is not a usable credential; only token / session / bearer count.
  let recoveredCredential = false
  const legacy: Record<string, SecretBox | undefined> = {
    token: raw.tokenEnc as SecretBox | undefined,
    ssoSession: raw.ssoSessionEnc as SecretBox | undefined,
    modelBearer: raw.modelBearerEnc as SecretBox | undefined,
    mobile: undefined,
  }
  for (const field of CREDENTIAL_FIELDS) {
    const box = legacy[field]
    // `mobile` was stored in plaintext in v1; carry it into the encrypted blob instead.
    const plaintext: string = field === 'mobile'
      ? asString(raw.mobile)
      : (open(box, legacyCredentialAad(id, field), key) ?? '')
    if (plaintext === '') continue
    credentials[field] = plaintext
    recovered += 1
    if (field !== 'mobile') recoveredCredential = true
  }

  const now = Date.now()
  const profile: Record<string, unknown> = {
    accountId: asString(raw.accountId),
    uid: asString(raw.uid),
    nickname: asString(raw.nickname),
    domainAccount: asString(raw.domainAccount),
    pointsKnown: asBoolean(raw.pointsKnown),
    pointsBalance: asNumber(raw.pointsBalance),
    sparkBalance: asNumber(raw.sparkBalance),
    planCode: asString(raw.planCode),
    planName: asString(raw.planName),
    planActive: asBoolean(raw.planActive),
    pendingPopups: asNumber(raw.pendingPopups),
    lastCheckedAt: asNumber(raw.lastCheckedAt, 0),
    lastClaimAt: asNumber(raw.lastClaimAt, 0),
  }

  return {
    id,
    providerId,
    label: asString(raw.name),
    credentialKind: kindOf(raw.source),
    enabled: asBoolean(raw.enabled, true),
    sessionOk: recoveredCredential && asBoolean(raw.sessionOk, true),
    statusNote: recoveredCredential ? asString(raw.statusNote) : '凭据无法解密，请重新导入',
    lastError: asString(raw.lastError),
    lastUsedAt: asNumber(raw.lastUsedAt, 0),
    cooldownUntil: asNumber(raw.cooldownUntil, 0),
    successes: asNumber(raw.successes),
    failures: asNumber(raw.failures),
    createdAt: asNumber(raw.createdAt, now),
    updatedAt: asNumber(raw.updatedAt, now),
    credentialsEnc: seal(JSON.stringify(credentials), credentialsAad(id, providerId), key),
    profile,
  }
}
