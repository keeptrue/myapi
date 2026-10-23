/** Types shared by the API server and the React console. */

export interface SecretBox {
  v: 1
  iv: string
  tag: string
  ct: string
}

export type AccountSource = 'sms-login' | 'paste' | 'file-import' | 'model-only'

export interface AccountPublic {
  id: string
  name: string
  accountId: string
  uid: string
  mobileMasked: string
  nickname: string
  domainAccount: string
  source: AccountSource
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
  credentials: {
    cookie: boolean
    modelBearer: boolean
  }
}

export interface ApiKeyPublic {
  id: string
  name: string
  prefix: string
  last4: string
  enabled: boolean
  allowedModels: string[]
  boundAccountId: string | null
  rpm: number
  createdAt: number
  lastUsedAt: number
}

export interface Settings {
  upstreamBase: string
  modelsBase: string
  workspaceBase: string
  studioVersion: string
  clientType: string
  requestTimeoutSeconds: number
  idleTimeoutSeconds: number
  maxConcurrency: number
  maxBodyMb: number
  logRetentionDays: number
  logMaxEntries: number
  catalogRefreshMinutes: number
  corsOrigins: string[]
  balanceAwareRotation: boolean
  autoCheckin: boolean
  checkinHour: number
  keepaliveMinutes: number
  checkinCompletePopups: boolean
  checkinClaimDownload: boolean
  checkinClaimBeta: boolean
  modelsDevEnabled: boolean
  modelsDevUrl: string
  modelsDevRefreshHours: number
}

export type ModelSource = 'model-manager' | 'bot-configs' | 'merged'

export interface ModelPointMultiplier {
  accountId: string
  value: string
}

export interface ModelInfo {
  slug: string
  name: string
  description: string
  directoryId: string
  provider: string
  contextWindow: number
  maxOutputTokens: number
  inputModalities: string[]
  reasoningEfforts: string[]
  defaultReasoning: string
  canDisableThinking: boolean
  pointMultiplier: string
  pointMultipliers: ModelPointMultiplier[]
  priority: number
  source: ModelSource
  available: boolean
  availableAccountIds: string[]
}

export interface OfficialCostRates {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  reasoning?: number
  inputAudio?: number
  outputAudio?: number
}

export interface OfficialCostTier extends OfficialCostRates {
  threshold: number
}

export interface OfficialCost extends OfficialCostRates {
  tiers: OfficialCostTier[]
  contextOver200k?: OfficialCostRates
}

export interface OfficialReasoningOption {
  type: 'toggle' | 'effort' | 'budget_tokens'
  values: string[]
  min: number
  max: number
}

export interface OfficialOffer {
  key: string
  providerId: string
  providerName: string
  modelId: string
  name: string
  contextWindow: number
  maxOutputTokens: number
  cost?: OfficialCost
}

export interface OfficialModelInfo extends OfficialOffer {
  canonicalId: string
  family: string
  maxInputTokens: number
  inputModalities: string[]
  outputModalities: string[]
  reasoning: boolean
  reasoningOptions: OfficialReasoningOption[]
  toolCall: boolean
  attachment: boolean
  structuredOutput: boolean
  temperature: boolean
  openWeights: boolean
  knowledge: string
  releaseDate: string
  lastUpdated: string
  status: string
  confidence: 'manual' | 'exact' | 'fuzzy'
  matchedBy: string
  contextMismatch: boolean
  alternatives: OfficialOffer[]
}

export interface ModelCapabilities {
  context: { platform: number; official: number; mismatch: boolean }
  output: { platform: number; official: number; mismatch: boolean }
  inputModalities: { platform: string[]; official: string[]; extraOfficial: string[]; effective: string[] }
  outputModalities: { official: string[] }
  reasoning: {
    platformEfforts: string[]
    defaultEffort: string
    canDisableThinking: boolean
    official: boolean
    officialEfforts: string[]
    officialToggle: boolean
    officialBudgetTokens: boolean
  }
  features: {
    toolCall: boolean
    attachment: boolean
    structuredOutput: boolean
    temperature: boolean
    openWeights: boolean
  }
}

export interface ModelsDevStatus {
  enabled: boolean
  source: 'live' | 'saved' | 'empty'
  fetchedAt: number
  checkedAt: number
  error: string
  refreshing: boolean
  providers: number
  models: number
}

export interface ModelsDevSearchResult {
  key: string
  providerId: string
  providerName: string
  modelId: string
  name: string
  canonicalId: string
  contextWindow: number
  maxInputTokens: number
  maxOutputTokens: number
  inputModalities: string[]
  outputModalities: string[]
  reasoning: boolean
  cost?: OfficialCost
}

export interface CatalogSnapshot {
  fetchedAt: number
  source: 'live' | 'saved' | 'empty'
  error: string
  models: ModelInfo[]
}

export interface ProbeUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
  reasoningTokens: number
}

export type ProbeModality = 'text' | 'image'
export type ProbeState = 'ok' | 'rejected' | 'failed'
export type ProbeValidation = 'validating' | 'non-validating'

export interface ProbeRecord {
  accountId: string
  slug: string
  effort: string
  modality?: ProbeModality
  effortDeclared?: boolean
  state: ProbeState
  validation: ProbeValidation
  reason: string
  httpStatus?: number
  latencyMs?: number
  finishReason?: string
  contentPreview?: string
  reasoningPreview?: string
  usage?: ProbeUsage
  testedAt: number
  expiresAt: number
}

export interface ProbeResultView {
  accountId: string
  effort: string
  modality: ProbeModality
  effortDeclared: boolean
  state: ProbeState
  validation: ProbeValidation
  reason: string
  httpStatus: number
  latencyMs: number
  finishReason: string
  contentPreview: string
  reasoningPreview: string
  usage: ProbeUsage
  testedAt: number
  expiresAt: number
}

export interface ProbeRun extends ProbeResultView {
  accountName: string
  slug: string
  content: string
  reasoning: string
}

export interface ProbeSummary {
  slug: string
  results: ProbeResultView[]
  latest?: ProbeResultView
  acceptedEfforts: string[]
  rejectedEfforts: string[]
}

export interface Counter {
  requests: number
  successes: number
  failures: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  reasoningTokens: number
  firstTokenMsSum: number
  firstTokenCount: number
}

export interface Stats {
  total: Counter
  byModel: Record<string, Counter>
  byHour: Record<string, Counter>
  byAccount: Record<string, Counter>
  byKey: Record<string, Counter>
}

export interface LogEntry {
  time: number
  requestId: string
  model: string
  upstreamModel: string
  keyId: string
  keyPrefix: string
  accountId: string
  accountName: string
  stream: boolean
  status: number
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  reasoningTokens: number
  firstTokenMs: number
  durationMs: number
  error: string
}

export interface BenefitEvent {
  time: number
  accountId: string
  accountName: string
  action: string
  result: 'ok' | 'failed' | 'skipped'
  detail: string
}

export interface CheckinResult {
  accountId: string
  name: string
  points: number
  spark: number
  pointsDelta: number
  plan: string
  popups: number
  actions: string[]
  error: string
}

export interface AuthSessionInfo {
  authenticated: boolean
  version: string
  passwordGenerated: boolean
}

export interface SystemInfo {
  version: string
  startedAt: number
  uptimeSeconds: number
  accounts: number
  accountsReady: number
  models: number
  catalogFetchedAt: number
  catalogError: string
  upstream: string
  node: string
  platform: string
}

export interface BenefitSummary {
  accounts: number
  enabledAccounts: number
  generalPoints: number
  sparkPoints: number
  pendingPopups: number
  activePlans: number
  lastCheckinDay: string
}

export interface UsageSummary {
  range: string
  total: Counter
  byModel: Array<{ key: string; value: Counter }>
  byAccount: Array<{ key: string; value: Counter }>
  byKey: Array<{ key: string; value: Counter }>
  timeseries: Array<{ bucket: string; requests: number; promptTokens: number; completionTokens: number; failures: number }>
}

export interface LoginGeetest {
  gt: string
  challenge: string
  success: boolean
  new_captcha: boolean
}

export interface ImportAccountInput {
  token?: string
  ssoSessionId?: string
  accountId?: string
  uid?: string
  mobile?: string
  modelBearerToken?: string
  name?: string
}

export interface ImportFileInput {
  configToml?: string
  sessionJson?: string
  name?: string
}

export interface ApiErrorBody {
  error: {
    message: string
    type: string
    code: string
  }
}

export interface AccountTestResult {
  ok: boolean
  model: string
  status: number
  latencyMs: number
  message: string
}
