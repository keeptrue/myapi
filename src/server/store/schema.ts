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

export interface StoredAccount {
  id: string
  name: string
  accountId: string
  uid: string
  tokenEnc?: SecretBox
  ssoSessionEnc?: SecretBox
  modelBearerEnc?: SecretBox
  mobile: string
  nickname: string
  domainAccount: string
  source: 'sms-login' | 'paste' | 'file-import' | 'model-only'
  enabled: boolean
  sessionOk: boolean
  statusNote: string
  lastError: string
  lastUsedAt: number
  cooldownUntil: number
  successes: number
  failures: number
  pointsKnown: boolean
  pointsBalance: number
  sparkBalance: number
  planCode: string
  planName: string
  planActive: boolean
  pendingPopups: number
  lastCheckedAt: number
  lastClaimAt: number
  createdAt: number
  updatedAt: number
}

export interface StoredApiKey extends ApiKeyPublic {
  keyHmac: string
}

export interface State {
  schemaVersion: 1
  auth: {
    passwordHash: string
    authVersion: number
    passwordGenerated: boolean
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
    schemaVersion: 1,
    auth: { passwordHash: '', authVersion: 1, passwordGenerated: false, createdAt: Date.now() },
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
