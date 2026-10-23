import type { Counter, LogEntry } from '../../shared/types.js'
import type { StoredAccount, StoredApiKey } from '../store/schema.js'
import type { StateStore } from '../store/state.js'
import type { AstronApi, AstronSession } from '../astron/types.js'
import type { AccountService } from '../astron/accounts.js'
import { isSessionExpired } from '../astron/types.js'
import { truncate } from '../util.js'
import { AccountSelector, GatewayError } from './select.js'
import type { CatalogService } from '../astron/catalog.js'
import { logger as rootLogger } from '../logger.js'

export interface EngineDeps {
  store: StateStore
  client: AstronApi
  accounts: AccountService
  catalog: CatalogService
  selector: AccountSelector
}

export interface CallRequest {
  key: StoredApiKey
  requestedModel: string
  upstreamModel: string
  path: string
  body: unknown
  stream: boolean
  signal: AbortSignal
  idleMs: number
}

export interface CallResult {
  response: Response
  account: StoredAccount
  session: AstronSession
  controller: AbortController
}

const READ_ERROR_LIMIT = 64 * 1024

export async function readTextLimited(response: Response, limit = READ_ERROR_LIMIT): Promise<string> {
  try {
    const text = await response.text()
    return text.length > limit ? `${text.slice(0, limit)}…` : text
  } catch {
    return ''
  }
}

/** Forwards one request to an account, retrying across accounts before any bytes reach the client. */
export class GatewayEngine {
  private readonly log = rootLogger.child({ module: 'gateway' })

  constructor(private readonly deps: EngineDeps) {}

  async call(request: CallRequest): Promise<CallResult> {
    const skip = new Set<string>()
    let lastError: string = ''
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let account: StoredAccount
      try {
        account = await this.deps.selector.pick({
          key: request.key,
          model: request.upstreamModel,
          skip,
        })
      } catch (error: unknown) {
        if (lastError !== '') {
          throw new GatewayError(503, 'upstream_unavailable', `${error instanceof Error ? error.message : String(error)}（最后一次上游错误：${truncate(lastError, 200)}）`)
        }
        throw error
      }

      let session = this.deps.accounts.sessionFor(account)
      if (session.modelBearerToken === '') {
        try {
          account = await this.deps.accounts.refreshCredential(account.id)
          session = this.deps.accounts.sessionFor(account)
        } catch (error: unknown) {
          lastError = error instanceof Error ? error.message : String(error)
          skip.add(account.id)
          continue
        }
      }

      const controller = new AbortController()
      const onAbort = (): void => controller.abort()
      if (request.signal.aborted) controller.abort()
      else request.signal.addEventListener('abort', onAbort, { once: true })

      let response: Response
      try {
        response = await this.deps.client.inference(request.path, session, request.body, controller.signal)
      } catch (error: unknown) {
        request.signal.removeEventListener('abort', onAbort)
        if (request.signal.aborted) throw error
        lastError = error instanceof Error ? error.message : String(error)
        this.deps.accounts.markFailed(account.id, lastError, 20)
        skip.add(account.id)
        continue
      }

      if (response.status === 401) {
        const text = await readTextLimited(response)
        try {
          account = await this.deps.accounts.refreshCredential(account.id)
          session = this.deps.accounts.sessionFor(account)
          const retry = await this.deps.client.inference(request.path, session, request.body, controller.signal)
          if (retry.ok) {
            this.deps.accounts.markUsed(account.id)
            return { response: retry, account, session, controller }
          }
          lastError = `HTTP 401 after credential refresh: ${truncate(text, 200)}`
        } catch (error: unknown) {
          lastError = isSessionExpired(error)
            ? '会话已失效，重新登录后再试'
            : `${truncate(text, 200)}${text === '' ? '' : ' · '}${error instanceof Error ? error.message : String(error)}`
        }
        this.deps.accounts.markFailed(account.id, lastError, 60)
        skip.add(account.id)
        request.signal.removeEventListener('abort', onAbort)
        continue
      }

      if (response.status === 429 || response.status >= 500) {
        const text = await readTextLimited(response)
        lastError = `HTTP ${response.status}: ${truncate(text, 300)}`
        this.deps.accounts.markFailed(account.id, lastError, 20)
        skip.add(account.id)
        request.signal.removeEventListener('abort', onAbort)
        continue
      }

      if (response.ok) this.deps.accounts.markUsed(account.id)
      return { response, account, session, controller }
    }
    throw new GatewayError(503, 'upstream_unavailable', `上游请求失败：${lastError || '没有可用账号'}`)
  }
}

export function makeLogEntry(input: {
  requestId: string
  key: Pick<StoredApiKey, 'id' | 'prefix'>
  account: StoredAccount | undefined
  model: string
  upstreamModel: string
  stream: boolean
  status: number
  startedAt: number
  firstTokenAt?: number
  usage?: { prompt: number; completion: number; cached: number; reasoning: number }
  error?: string
}): LogEntry {
  return {
    time: input.startedAt,
    requestId: input.requestId,
    model: input.model,
    upstreamModel: input.upstreamModel,
    keyId: input.key.id,
    keyPrefix: input.key.prefix,
    accountId: input.account?.id ?? '',
    accountName: input.account === undefined ? '' : (input.account.nickname || input.account.name || input.account.accountId),
    stream: input.stream,
    status: input.status,
    promptTokens: input.usage?.prompt ?? 0,
    completionTokens: input.usage?.completion ?? 0,
    cachedTokens: input.usage?.cached ?? 0,
    reasoningTokens: input.usage?.reasoning ?? 0,
    firstTokenMs: input.firstTokenAt === undefined ? 0 : input.firstTokenAt - input.startedAt,
    durationMs: Date.now() - input.startedAt,
    error: input.error ?? '',
  }
}

export interface UsageShape {
  prompt: number
  completion: number
  cached: number
  reasoning: number
}

/** Read usage from either OpenAI chat or Responses payloads. */
export function usageFrom(payload: unknown): UsageShape | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const record = payload as Record<string, unknown>
  const usage = (typeof record['usage'] === 'object' && record['usage'] !== null)
    ? record['usage'] as Record<string, unknown>
    : (typeof record['response'] === 'object' && record['response'] !== null
      && typeof (record['response'] as Record<string, unknown>)['usage'] === 'object'
      ? (record['response'] as Record<string, unknown>)['usage'] as Record<string, unknown>
      : undefined)
  if (usage === undefined) return undefined
  const prompt = numberValue(usage['prompt_tokens'] ?? usage['input_tokens'])
  const completion = numberValue(usage['completion_tokens'] ?? usage['output_tokens'])
  const promptDetails = typeof usage['prompt_tokens_details'] === 'object' && usage['prompt_tokens_details'] !== null
    ? usage['prompt_tokens_details'] as Record<string, unknown> : {}
  const completionDetails = typeof usage['completion_tokens_details'] === 'object' && usage['completion_tokens_details'] !== null
    ? usage['completion_tokens_details'] as Record<string, unknown> : {}
  const inputDetails = typeof usage['input_tokens_details'] === 'object' && usage['input_tokens_details'] !== null
    ? usage['input_tokens_details'] as Record<string, unknown> : {}
  const outputDetails = typeof usage['output_tokens_details'] === 'object' && usage['output_tokens_details'] !== null
    ? usage['output_tokens_details'] as Record<string, unknown> : {}
  return {
    prompt,
    completion,
    cached: numberValue(promptDetails['cached_tokens'] ?? inputDetails['cached_tokens']),
    reasoning: numberValue(completionDetails['reasoning_tokens'] ?? outputDetails['reasoning_tokens']),
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function emptyCounterSafe(counter: Counter | undefined): Counter {
  return counter ?? { requests: 0, successes: 0, failures: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, reasoningTokens: 0, firstTokenMsSum: 0, firstTokenCount: 0 }
}
