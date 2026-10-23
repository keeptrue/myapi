import {
  PROBE_MAX_ACCOUNTS,
  PROBE_PREVIEW_CHARS,
  PROBE_RESPONSE_LIMIT,
  PROBE_TIMEOUT_MS,
  PROBE_TTL_MS,
} from '../../shared/constants.js'
import type {
  ModelInfo,
  ProbeRecord,
  ProbeRun,
  ProbeState,
  ProbeUsage,
  ProbeValidation,
} from '../../shared/types.js'
import type { AccountService } from '../astron/accounts.js'
import { AstronError, type AstronApi, type AstronSession } from '../astron/types.js'
import type { StoredAccount } from '../store/schema.js'
import type { StateStore } from '../store/state.js'
import { logger as rootLogger } from '../logger.js'
import { readLimited } from '../http.js'
import { isRecord, numberField, stringField, truncate } from '../util.js'

/** A small red square used to verify image input without fetching an external URL. */
export const PROBE_IMAGE_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAIAAAAlC+aJAAABOUlEQVR42tXUSxKDIBAEUO2D6CL3v1Gy8CRmlaokIiLMp5udMtNVT2Hmfd+nz3qt66S28P3w2DZtgKIBx1daBhTPvZABZ3dXxYDK/JEwoD5D+Q0/l1jR8D+F5AyFMaplQPGtkAFnGyoGVPYkDKhv8xtwWUFuQEsRswGNdbQGtJdyGnCrmtCAuw1sBnT0UBnQ18ZjQHcniQEjzQwGDPanGzAekWuASUqiAVZBWQYYZqUYYBsXb4B5YrABHqGRBjh9mDAD/E5njAGuIyLA4AsIMLgDvA0RAFdDEMDPEAdwMoQCPAzRAHNDAsDWkAMwNKQBrAyZABNDMmDckA8YNFAARgwsgG4DEaDPwAXoMNAB7hoYAbcMpIB2Ay+g0UANaDGwAy4NAoC6YX4uyySyxKZQ439QAhQNYoCj4Q2fLLiUFujz3gAAAABJRU5ErkJggg=='

const CONTENT_PREVIEW_LIMIT = 4000
const ERROR_REASON_LIMIT = 300

const REJECTED_CODES = new Set([
  'invalid_parameter',
  'invalid_parameter_value',
  'unsupported_parameter',
  'unsupported_value',
])

export class ProbeInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProbeInputError'
  }
}

export class ProbeBusyError extends Error {
  constructor() {
    super('该模型正在探测，请稍后再试')
    this.name = 'ProbeBusyError'
  }
}

export interface ProbeInput {
  model: ModelInfo
  message: string
  effort: string
  maxTokens: number
  accountId?: string
  allAccounts: boolean
  image: boolean
}

export interface ProbeDeps {
  store: StateStore
  client: AstronApi
  accounts: AccountService
}

export interface ParsedProbeReply {
  content: string
  reasoning: string
  finishReason: string
  usage: ProbeUsage
}

export interface ProbeFailure {
  state: ProbeState
  validation: ProbeValidation
  reason: string
}

export function emptyProbeUsage(): ProbeUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
}

export function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return ''
  const parts: string[] = []
  for (const part of value) {
    if (typeof part === 'string') {
      parts.push(part)
      continue
    }
    if (!isRecord(part)) continue
    const text = stringField(part['text'])
    if (text !== '') parts.push(text)
  }
  return parts.join('')
}

/** Parse an OpenAI-compatible non-streaming chat completion. */
export function parseProbeReply(text: string): ParsedProbeReply | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!isRecord(parsed)) return undefined
  const choices = Array.isArray(parsed['choices']) ? parsed['choices'] : []
  if (choices.length === 0) return undefined
  const choice = isRecord(choices[0]) ? choices[0] : undefined
  const message = choice !== undefined && isRecord(choice['message']) ? choice['message'] : undefined
  const usageRecord = isRecord(parsed['usage']) ? parsed['usage'] : {}
  const promptDetails = isRecord(usageRecord['prompt_tokens_details']) ? usageRecord['prompt_tokens_details'] : {}
  const completionDetails = isRecord(usageRecord['completion_tokens_details']) ? usageRecord['completion_tokens_details'] : {}
  const promptTokens = numberField(usageRecord['prompt_tokens'])
  const completionTokens = numberField(usageRecord['completion_tokens'])
  const totalTokens = numberField(usageRecord['total_tokens']) || promptTokens + completionTokens
  return {
    content: contentText(message?.['content']),
    reasoning: stringField(message?.['reasoning_content'] ?? message?.['reasoning']),
    finishReason: choice === undefined ? '' : stringField(choice['finish_reason']),
    usage: {
      promptTokens,
      completionTokens,
      totalTokens,
      cachedTokens: numberField(promptDetails['cached_tokens']),
      reasoningTokens: numberField(completionDetails['reasoning_tokens']),
    },
  }
}

function errorFields(text: string): { code: string; message: string } {
  try {
    const parsed: unknown = JSON.parse(text)
    if (isRecord(parsed)) {
      const nested = isRecord(parsed['error']) ? parsed['error'] : parsed
      const message = stringField(nested['message']) || stringField(parsed['message'])
      return { code: stringField(nested['code']), message: message === '' ? text : message }
    }
  } catch {
    // Plain-text upstream errors are common; fall through.
  }
  return { code: '', message: text }
}

/** Classify a non-2xx probe response as either a rejected effort or a failed call. */
export function classifyProbeFailure(status: number, text: string): ProbeFailure {
  const { code, message } = errorFields(text)
  const looksLikeEffort = /reasoning[_-]?effort|thinking|effort/iu.test(`${code} ${message}`)
  if (status === 400 && (REJECTED_CODES.has(code) || looksLikeEffort)) {
    return {
      state: 'rejected',
      validation: 'non-validating',
      reason: truncate(message || `HTTP ${status}`, ERROR_REASON_LIMIT),
    }
  }
  return {
    state: 'failed',
    validation: 'non-validating',
    reason: truncate(`HTTP ${status}: ${message}`, ERROR_REASON_LIMIT),
  }
}

export function buildProbeBody(input: ProbeInput): Record<string, unknown> {
  const content = input.image
    ? [
        { type: 'text', text: input.message },
        { type: 'image_url', image_url: { url: PROBE_IMAGE_DATA_URI } },
      ]
    : input.message
  return {
    model: input.model.slug,
    messages: [{ role: 'user', content }],
    max_tokens: input.maxTokens,
    stream: false,
    ...(input.effort === '' ? {} : { reasoning_effort: input.effort }),
  }
}

function effortDeclared(model: ModelInfo, effort: string): boolean {
  if (effort === '') return true
  if (model.reasoningEfforts.includes(effort)) return true
  return effort === 'none' && model.canDisableThinking
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')
}

function accountName(account: StoredAccount): string {
  return account.nickname || account.name || account.accountId || account.id
}

export class ProbeService {
  private readonly log = rootLogger.child({ module: 'probe' })
  private readonly inFlight = new Map<string, Promise<ProbeRun[]>>()

  constructor(private readonly deps: ProbeDeps) {}

  run(input: ProbeInput): Promise<ProbeRun[]> {
    const key = input.model.slug
    if (this.inFlight.has(key)) return Promise.reject(new ProbeBusyError())
    const promise = this.execute(input).finally(() => {
      this.inFlight.delete(key)
    })
    this.inFlight.set(key, promise)
    return promise
  }

  private async execute(input: ProbeInput): Promise<ProbeRun[]> {
    const accounts = this.selectAccounts(input)
    if (accounts.length === 0) throw new ProbeInputError('没有可用账号，探测请求未发出')
    const results: ProbeRun[] = []
    for (const account of accounts) results.push(await this.probeOne(input, account))
    return results
  }

  private selectAccounts(input: ProbeInput): StoredAccount[] {
    const eligible = this.deps.store.accounts.filter(account =>
      account.enabled
      && (account.modelBearerEnc !== undefined || account.tokenEnc !== undefined || account.ssoSessionEnc !== undefined))
    if (input.accountId !== undefined && input.accountId !== '') {
      const account = eligible.find(item => item.id === input.accountId)
      if (account === undefined) throw new ProbeInputError('该账号受限或未配置凭据')
      return [account]
    }
    if (eligible.length === 0) return []
    const available = new Set(input.model.availableAccountIds)
    const ranked = [...eligible].sort((left, right) => {
      const leftAvailable = available.has(left.id) ? 0 : 1
      const rightAvailable = available.has(right.id) ? 0 : 1
      if (leftAvailable !== rightAvailable) return leftAvailable - rightAvailable
      return accountName(left).localeCompare(accountName(right))
    })
    return input.allAccounts ? ranked.slice(0, PROBE_MAX_ACCOUNTS) : [ranked[0] as StoredAccount]
  }

  private async probeOne(input: ProbeInput, account: StoredAccount): Promise<ProbeRun> {
    const started = Date.now()
    let session: AstronSession = this.deps.accounts.sessionFor(account)
    if (session.modelBearerToken === '') {
      try {
        const refreshed = await this.deps.accounts.refreshCredential(account.id)
        session = this.deps.accounts.sessionFor(refreshed)
      } catch (error: unknown) {
        return this.persistFailure(input, account, started, 0, 'failed', 'non-validating',
          `凭据刷新失败：${truncate(error instanceof Error ? error.message : String(error), ERROR_REASON_LIMIT)}`)
      }
    }

    let response: Response
    try {
      response = await this.deps.client.inference(
        'chat/completions',
        session,
        buildProbeBody(input),
        AbortSignal.timeout(PROBE_TIMEOUT_MS),
      )
    } catch (error: unknown) {
      const message = truncate(error instanceof Error ? error.message : String(error), ERROR_REASON_LIMIT)
      const reason = isAbort(error)
        ? `探测超时（${Math.round(PROBE_TIMEOUT_MS / 1000)}s）`
        : error instanceof AstronError && error.kind === 'auth'
          ? `鉴权失败：${message}`
          : `网络错误：${message}`
      return this.persistFailure(input, account, started, 0, 'failed', 'non-validating', reason)
    }

    if (response.status === 401) {
      await response.body?.cancel().catch(() => undefined)
      try {
        const refreshed = await this.deps.accounts.refreshCredential(account.id)
        session = this.deps.accounts.sessionFor(refreshed)
        response = await this.deps.client.inference(
          'chat/completions',
          session,
          buildProbeBody(input),
          AbortSignal.timeout(PROBE_TIMEOUT_MS),
        )
      } catch (error: unknown) {
        return this.persistFailure(input, account, started, 401, 'failed', 'non-validating',
          `HTTP 401 后刷新凭据失败：${truncate(error instanceof Error ? error.message : String(error), ERROR_REASON_LIMIT)}`)
      }
    }

    if (!response.ok) {
      const text = await readLimited(response, PROBE_RESPONSE_LIMIT)
      const failure = input.image && (response.status === 400 || response.status === 415)
        ? {
            state: 'rejected' as const,
            validation: 'non-validating' as const,
            reason: truncate(`上游未接受图片输入：${errorFields(text).message}`, ERROR_REASON_LIMIT),
          }
        : classifyProbeFailure(response.status, text)
      this.log.debug('probe failed', {
        slug: input.model.slug,
        account: account.id,
        status: response.status,
        state: failure.state,
      })
      return this.persistFailure(input, account, started, response.status, failure.state, failure.validation, failure.reason)
    }

    const text = await readLimited(response, PROBE_RESPONSE_LIMIT)
    const parsed = parseProbeReply(text)
    if (parsed === undefined) {
      return this.persistFailure(input, account, started, response.status, 'failed', 'non-validating',
        `上游响应 JSON 解析失败：${truncate(text, ERROR_REASON_LIMIT)}`)
    }

    const testedAt = Date.now()
    const latencyMs = testedAt - started
    const run: ProbeRun = {
      accountId: account.id,
      accountName: accountName(account),
      slug: input.model.slug,
      effort: input.effort,
      effortDeclared: effortDeclared(input.model, input.effort),
      modality: input.image ? 'image' : 'text',
      state: 'ok',
      validation: 'validating',
      reason: '',
      httpStatus: response.status,
      latencyMs,
      content: truncate(parsed.content, CONTENT_PREVIEW_LIMIT),
      reasoning: truncate(parsed.reasoning, CONTENT_PREVIEW_LIMIT),
      contentPreview: truncate(parsed.content, PROBE_PREVIEW_CHARS),
      reasoningPreview: truncate(parsed.reasoning, PROBE_PREVIEW_CHARS),
      finishReason: parsed.finishReason,
      usage: parsed.usage,
      testedAt,
      expiresAt: testedAt + PROBE_TTL_MS,
    }
    const record: ProbeRecord = {
      accountId: run.accountId,
      slug: run.slug,
      effort: run.effort,
      modality: run.modality,
      effortDeclared: run.effortDeclared,
      state: run.state,
      validation: run.validation,
      reason: run.reason,
      httpStatus: run.httpStatus,
      latencyMs: run.latencyMs,
      finishReason: run.finishReason,
      contentPreview: truncate(run.content, PROBE_PREVIEW_CHARS),
      reasoningPreview: truncate(run.reasoning, PROBE_PREVIEW_CHARS),
      usage: run.usage,
      testedAt: run.testedAt,
      expiresAt: run.expiresAt,
    }
    this.deps.store.putProbe(record)
    this.log.debug('probe ok', {
      slug: input.model.slug,
      account: account.id,
      latencyMs,
      completionTokens: run.usage.completionTokens,
      finishReason: run.finishReason,
    })
    return run
  }

  private persistFailure(
    input: ProbeInput,
    account: StoredAccount,
    started: number,
    httpStatus: number,
    state: ProbeState,
    validation: ProbeValidation,
    reason: string,
  ): ProbeRun {
    const testedAt = Date.now()
    const latencyMs = testedAt - started
    const usage = emptyProbeUsage()
    const run: ProbeRun = {
      accountId: account.id,
      accountName: accountName(account),
      slug: input.model.slug,
      effort: input.effort,
      effortDeclared: effortDeclared(input.model, input.effort),
      modality: input.image ? 'image' : 'text',
      state,
      validation,
      reason,
      httpStatus,
      latencyMs,
      content: '',
      reasoning: '',
      contentPreview: '',
      reasoningPreview: '',
      finishReason: '',
      usage,
      testedAt,
      expiresAt: testedAt + PROBE_TTL_MS,
    }
    this.deps.store.putProbe({
      accountId: run.accountId,
      slug: run.slug,
      effort: run.effort,
      modality: run.modality,
      effortDeclared: run.effortDeclared,
      state: run.state,
      validation: run.validation,
      reason: run.reason,
      httpStatus: run.httpStatus,
      latencyMs: run.latencyMs,
      finishReason: run.finishReason,
      contentPreview: '',
      reasoningPreview: '',
      usage,
      testedAt: run.testedAt,
      expiresAt: run.expiresAt,
    })
    return run
  }
}
