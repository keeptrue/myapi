import type {
  AccountPublic,
  ApiKeyPublic,
  AuthSessionInfo,
  BenefitEvent,
  BenefitSummary,
  LogEntry,
  LoginGeetest,
  ModelCapabilities,
  ModelInfo,
  ModelsDevSearchResult,
  ModelsDevStatus,
  OfficialModelInfo,
  ProbeRun,
  ProbeSummary,
  Settings,
  SystemInfo,
  UsageSummary,
} from '../../shared/types.js'
import type {
  AccountTestResult,
  CheckinResult,
} from '../../shared/providers.js'

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = 'request_failed',
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'

async function request<T>(path: string, method: Method = 'GET', body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'x-myapi-csrf': '1' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const response = await fetch(path, {
    method,
    credentials: 'include',
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  let payload: unknown
  try {
    payload = text === '' ? undefined : JSON.parse(text)
  } catch {
    payload = text
  }
  if (!response.ok) {
    const record = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : {}
    const error = typeof record['error'] === 'object' && record['error'] !== null ? record['error'] as Record<string, unknown> : {}
    const message = typeof error['message'] === 'string'
      ? error['message']
      : `请求失败（HTTP ${response.status}）`
    const code = typeof error['code'] === 'string' ? error['code'] : 'request_failed'
    if (response.status === 401 && !path.includes('/auth/login')) {
      window.dispatchEvent(new CustomEvent('myapi:unauthorized'))
    }
    throw new ApiError(response.status, message, code)
  }
  return payload as T
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>(path, 'POST', body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>(path, 'PATCH', body),
  put: <T>(path: string, body: unknown) => request<T>(path, 'PUT', body),
  del: <T>(path: string) => request<T>(path, 'DELETE'),
}

export interface AccountDto extends AccountPublic {}

/** Wire shape for the paste-credential endpoint (legacy AStudio field names). */
export interface PasteAccountInput {
  providerId?: string
  label?: string
  token?: string
  ssoSessionId?: string
  accountId?: string
  uid?: string
  mobile?: string
  modelBearerToken?: string
}

/** Wire shape for the file-import endpoint. */
export interface ImportFileAccountInput {
  providerId?: string
  label?: string
  configToml?: string
  sessionJson?: string
}
export interface KeyDto extends ApiKeyPublic {}
export interface ModelDto extends ModelInfo {
  hidden: boolean
  probe: ProbeSummary
  availableAccounts: string[]
  aliases: string[]
  pointMultipliers: Array<{ accountId: string; accountName: string; value: string }>
  official: OfficialModelInfo | null
  capabilities: ModelCapabilities
}

export interface ModelsResponse {
  source: string
  fetchedAt: number
  error: string
  modelsDev: ModelsDevStatus
  models: ModelDto[]
}

export interface ProbeRequest {
  message?: string
  effort?: string | null
  maxTokens?: number
  accountId?: string
  allAccounts?: boolean
  image?: boolean
}

export const endpoints = {
  session: () => api.get<AuthSessionInfo>('/api/auth/session'),
  login: (password: string) => api.post<{ ok: boolean }>('/api/auth/login', { password }),
  logout: () => api.post<{ ok: boolean }>('/api/auth/logout'),
  changePassword: (current: string, next: string) => api.post<{ ok: boolean }>('/api/auth/password', { current, next }),
  system: () => api.get<SystemInfo>('/api/system'),

  accounts: () => api.get<{ accounts: AccountDto[] }>('/api/accounts'),
  importAccount: (input: PasteAccountInput) => api.post<{ account: AccountDto }>('/api/accounts/import', input),
  importFile: (input: ImportFileAccountInput) => api.post<{ account: AccountDto }>('/api/accounts/import-file', input),
  updateAccount: (id: string, patch: { label?: string; enabled?: boolean; domainAccount?: string }) =>
    api.patch<{ account: AccountDto }>(`/api/accounts/${encodeURIComponent(id)}`, patch),
  deleteAccount: (id: string) => api.del<{ ok: boolean }>(`/api/accounts/${encodeURIComponent(id)}`),
  refreshAccount: (id: string) => api.post<{ account: AccountDto }>(`/api/accounts/${encodeURIComponent(id)}/refresh`),
  testAccount: (id: string, model?: string) =>
    api.post<{ result: AccountTestResult }>(`/api/accounts/${encodeURIComponent(id)}/test`, model === undefined ? {} : { model }),
  checkinAccount: (id: string) =>
    api.post<{ result: CheckinResult }>(`/api/accounts/${encodeURIComponent(id)}/checkin`),
  checkinAll: () => api.post<{ results: CheckinResult[] }>('/api/accounts/checkin-all'),
  keepalive: (id: string) => api.post<{ ok: boolean }>(`/api/accounts/${encodeURIComponent(id)}/keepalive`),
  redeem: (id: string, code: string) =>
    api.post<{ result: { points: number; expireTime: string } }>(`/api/accounts/${encodeURIComponent(id)}/redeem`, { code }),
  accountEvents: (id: string) => api.get<{ events: BenefitEvent[] }>(`/api/accounts/${encodeURIComponent(id)}/events`),

  geetest: () => api.get<{ geetest: LoginGeetest }>('/api/login/geetest'),
  sendSms: (payload: { mobile: string; challenge: string; validate: string; seccode: string }) =>
    api.post<{ ok: boolean }>('/api/login/sms', {
      mobile: payload.mobile,
      geetest_challenge: payload.challenge,
      geetest_validate: payload.validate,
      geetest_seccode: payload.seccode,
    }),
  verifySms: (mobile: string, code: string) =>
    api.post<{ account: AccountDto; is_new: boolean }>('/api/login/verify', { mobile, verify_code: code }),

  keys: () => api.get<{ keys: KeyDto[] }>('/api/keys'),
  createKey: (payload: { name: string; allowedModels: string[]; boundAccountId: string | null; rpm: number }) =>
    api.post<{ key: string; record: KeyDto }>('/api/keys', payload),
  updateKey: (id: string, patch: Partial<Pick<KeyDto, 'name' | 'enabled' | 'allowedModels' | 'boundAccountId' | 'rpm'>>) =>
    api.patch<{ record: KeyDto }>(`/api/keys/${encodeURIComponent(id)}`, patch),
  deleteKey: (id: string) => api.del<{ ok: boolean }>(`/api/keys/${encodeURIComponent(id)}`),
  rotateKey: (id: string) => api.post<{ key: string; record: KeyDto }>(`/api/keys/${encodeURIComponent(id)}/rotate`),

  models: () => api.get<ModelsResponse>('/api/models'),
  refreshModels: () => api.post<ModelsResponse>('/api/models/refresh'),
  setVisible: (slug: string, visible: boolean) =>
    api.patch<{ ok: boolean; hidden: string[] }>(`/api/models/${encodeURIComponent(slug)}`, { visible }),
  probe: (slug: string, payload: ProbeRequest = {}) =>
    api.post<{ results: ProbeRun[]; probe: ProbeSummary }>(`/api/models/${encodeURIComponent(slug)}/probe`, payload),
  setModelReference: (slug: string, key: string | null) =>
    api.put<{ ok: boolean; official: OfficialModelInfo | null }>(`/api/models/${encodeURIComponent(slug)}/reference`, { key }),
  modelsDev: () => api.get<{ status: ModelsDevStatus }>('/api/models-dev'),
  refreshModelsDev: () => api.post<{ status: ModelsDevStatus }>('/api/models-dev/refresh'),
  searchModelsDev: (q: string, limit = 20) =>
    api.get<{ models: ModelsDevSearchResult[] }>(`/api/models-dev/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  aliases: () => api.get<{ aliases: Record<string, string> }>('/api/model-aliases'),
  saveAliases: (aliases: Record<string, string>) => api.put<{ aliases: Record<string, string> }>('/api/model-aliases', { aliases }),

  summary: (range: string) => api.get<UsageSummary>(`/api/usage/summary?range=${encodeURIComponent(range)}`),
  recent: (limit = 20) => api.get<{ entries: LogEntry[] }>(`/api/usage/recent?limit=${limit}`),
  logs: (params: Record<string, string | number | undefined>) => {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') query.set(key, String(value))
    }
    return api.get<{ entries: LogEntry[]; nextCursor: number | null }>(`/api/logs?${query.toString()}`)
  },
  clearLogs: () => api.del<{ ok: boolean }>('/api/logs'),

  benefitSummary: () => api.get<BenefitSummary>('/api/benefits/summary'),
  benefitEvents: (limit = 100) => api.get<{ events: BenefitEvent[] }>(`/api/benefits/events?limit=${limit}`),
  checkinBenefit: (accountId?: string) => api.post<{ results: CheckinResult[] }>('/api/benefits/checkin', accountId === undefined ? {} : { accountId }),

  settings: () => api.get<{ settings: Settings; aliases: Record<string, string>; restartFields: string[] }>('/api/settings'),
  saveSettings: (patch: Partial<Settings>) => api.put<{ settings: Settings; restartFields: string[]; needsRestart?: boolean }>('/api/settings', patch),
}

export function exportUrl(format: 'csv' | 'jsonl'): string {
  return `/api/logs/export?format=${format}`
}
