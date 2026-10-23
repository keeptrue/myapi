import type { FastifyReply } from 'fastify'
import type { StoredAccount, StoredApiKey } from '../store/schema.js'
import type { CatalogService } from '../providers/astudio/catalog.js'
import type { GatewayEngine } from './engine.js'
import { readTextLimited, usageFrom } from './engine.js'
import { describeRequest, dropUnsupportedEffort, repairChatBody, sanitizeBody, SHAPE_FALLBACKS, type GatewayShape, isRecord } from './repair.js'
import { relayChatStream, type RelayMeta } from './relay.js'
import { GatewayError } from './select.js'
import { logger as rootLogger } from '../logger.js'
import { accountLabel, truncate } from '../util.js'
import type { UsageService } from './usage.js'

const MAX_BUFFER_BYTES = 32 * 1024 * 1024

export interface ChatInput {
  key: StoredApiKey
  body: unknown
  requestedModel: string
  upstreamModel: string
  signal: AbortSignal
  requestId: string
  idleMs: number
}

/** Orchestrates chat-completions requests: repair, shape fallback, relay, logging. */
export class ChatGateway {
  private readonly log = rootLogger.child({ module: 'chat' })
  private learnedShape: GatewayShape = 'as-is'
  private diagnosed = false
  private learnedFix: ((body: unknown) => unknown) | undefined

  constructor(
    private readonly engine: GatewayEngine,
    private readonly catalog: CatalogService,
    private readonly usage: UsageService,
  ) {}

  async handle(reply: FastifyReply, input: ChatInput): Promise<void> {
    const startedAt = Date.now()
    const repaired = repairChatBody(input.body)
    let body = repaired.body
    const guarded = dropUnsupportedEffort(body, this.catalog.models)
    if (guarded.dropped !== undefined) this.log.warn('dropped reasoning_effort', { reason: guarded.dropped })
    body = guarded.body
    if (isRecord(body) && body['stream'] === true && body['stream_options'] === undefined) {
      body = { ...body, stream_options: { include_usage: true } }
    }
    if (this.learnedFix !== undefined) body = this.learnedFix(body)
    const stream = isRecord(body) && body['stream'] === true
    const meta: RelayMeta = {
      requestId: input.requestId,
      key: input.key,
      model: input.requestedModel,
      upstreamModel: input.upstreamModel,
      startedAt,
      idleMs: input.idleMs,
    }

    const shapes: GatewayShape[] = [this.learnedShape, ...SHAPE_FALLBACKS.filter(shape => shape !== this.learnedShape)]
    let lastBody = body
    let lastResponse: Response | undefined
    let lastAccount: StoredAccount | undefined

    for (const shape of shapes) {
      const shaped = sanitizeBody(body, shape)
      let result
      try {
        result = await this.engine.call({
          key: input.key,
          requestedModel: input.requestedModel,
          upstreamModel: input.upstreamModel,
          path: 'chat/completions',
          body: shaped,
          stream,
          signal: input.signal,
          idleMs: input.idleMs,
        })
      } catch (error: unknown) {
        const status = error instanceof GatewayError ? error.status : 502
        const code = error instanceof GatewayError ? error.code : 'upstream_unavailable'
        await this.writeError(reply, status, code, error instanceof Error ? error.message : String(error), input, startedAt)
        return
      }
      if (result.response.ok) {
        if (shape !== this.learnedShape) {
          this.learnedShape = shape
          this.log.warn('gateway accepted a narrower request shape', { shape })
        }
        meta.account = result.account
        if (stream) {
          this.usage.record(await relayChatStream(reply, result, meta))
          return
        }
        await this.relayBuffered(reply, result.response, input, startedAt, result.account)
        return
      }
      lastBody = shaped
      lastResponse = result.response
      lastAccount = result.account
      if (result.response.status !== 400 || input.signal.aborted) {
        await this.relayUpstreamError(reply, result.response, input, startedAt, result.account)
        return
      }
      await result.response.body?.cancel().catch(() => undefined)
    }

    if (!this.diagnosed && input.signal.aborted === false) {
      const diagnosed = await this.diagnose(input, lastBody, stream)
      if (diagnosed !== undefined) {
        this.diagnosed = true
        this.learnedFix = diagnosed.fix
        try {
          const result = await this.engine.call({
            key: input.key,
            requestedModel: input.requestedModel,
            upstreamModel: input.upstreamModel,
            path: 'chat/completions',
            body: diagnosed.body,
            stream,
            signal: input.signal,
            idleMs: input.idleMs,
          })
          if (result.response.ok) {
            meta.account = result.account
            if (stream) {
              this.usage.record(await relayChatStream(reply, result, meta))
              return
            }
            await this.relayBuffered(reply, result.response, input, startedAt, result.account)
            return
          }
        } catch {
          // Fall through to the original error.
        }
      }
    }

    if (lastResponse !== undefined) {
      await this.relayUpstreamError(reply, lastResponse, input, startedAt, lastAccount)
      return
    }
    await this.writeError(reply, 400, 'upstream_client_error', `上游拒绝了请求（request: ${describeRequest(lastBody)}）`, input, startedAt)
  }

  private async diagnose(input: ChatInput, body: unknown, stream: boolean): Promise<{ body: unknown; fix: (value: unknown) => unknown } | undefined> {
    if (!isRecord(body)) return undefined
    const maxTokens = typeof body['max_tokens'] === 'number' ? body['max_tokens'] : undefined
    const candidates: Array<{ body: Record<string, unknown>; apply: (value: unknown) => unknown; label: string }> = []
    if (maxTokens !== undefined && maxTokens > 8192) {
      candidates.push({
        body: { ...body, max_tokens: 8192 },
        apply: value => {
          if (!isRecord(value)) return value
          const current = typeof value['max_tokens'] === 'number' ? value['max_tokens'] : 8192
          return current > 8192 ? { ...value, max_tokens: 8192 } : value
        },
        label: 'max_tokens clamp',
      })
    }
    if (Array.isArray(body['tools']) && body['tools'].length > 0) {
      candidates.push({
        body: { ...body },
        apply: value => {
          if (!isRecord(value)) return value
          const next = { ...value }
          delete next['tools']
          return next
        },
        label: 'remove tools',
      })
      const withoutTools = candidates[candidates.length - 1]
      if (withoutTools !== undefined) delete withoutTools.body['tools']
    }
    if (body['reasoning_effort'] !== undefined) {
      const next = { ...body }
      delete next['reasoning_effort']
      candidates.push({
        body: next,
        apply: value => {
          if (!isRecord(value)) return value
          const copy = { ...value }
          delete copy['reasoning_effort']
          return copy
        },
        label: 'remove reasoning_effort',
      })
    }
    for (const candidate of candidates) {
      try {
        const result = await this.engine.call({
          key: input.key,
          requestedModel: input.requestedModel,
          upstreamModel: input.upstreamModel,
          path: 'chat/completions',
          body: candidate.body,
          stream,
          signal: input.signal,
          idleMs: input.idleMs,
        })
        if (result.response.ok) {
          await result.response.body?.cancel().catch(() => undefined)
          this.log.warn('diagnosed a refused request', { fix: candidate.label })
          return { body: candidate.body, fix: candidate.apply }
        }
        await result.response.body?.cancel().catch(() => undefined)
      } catch {
        // Try the next dimension.
      }
    }
    return undefined
  }

  private async relayBuffered(reply: FastifyReply, response: Response, input: ChatInput, startedAt: number, account: StoredAccount): Promise<void> {
    const text = await readTextLimited(response, MAX_BUFFER_BYTES)
    let payload: unknown = text
    let usage
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (typeof parsed['model'] === 'string') parsed['model'] = input.requestedModel
      usage = usageFrom(parsed)
      payload = parsed
    } catch {
      payload = text
    }
    reply.code(200).type('application/json; charset=utf-8').send(typeof payload === 'string' ? payload : JSON.stringify(payload))
    this.usage.record({
      time: startedAt,
      requestId: input.requestId,
      model: input.requestedModel,
      upstreamModel: input.upstreamModel,
      keyId: input.key.id,
      keyPrefix: input.key.prefix,
      accountId: account.id,
      accountName: accountLabel(account),
      providerId: account.providerId,
      stream: false,
      status: 200,
      promptTokens: usage?.prompt ?? 0,
      completionTokens: usage?.completion ?? 0,
      cachedTokens: usage?.cached ?? 0,
      reasoningTokens: usage?.reasoning ?? 0,
      firstTokenMs: 0,
      durationMs: Date.now() - startedAt,
      error: '',
    })
  }

  private async relayUpstreamError(reply: FastifyReply, response: Response, input: ChatInput, startedAt: number, account: StoredAccount | undefined): Promise<void> {
    const text = await readTextLimited(response)
    const contentType = response.headers.get('content-type') ?? 'application/json; charset=utf-8'
    reply.code(response.status).type(contentType).send(text === '' ? JSON.stringify({ error: { message: `上游 HTTP ${response.status}`, type: 'upstream_error' } }) : text)
    this.usage.record({
      time: startedAt,
      requestId: input.requestId,
      model: input.requestedModel,
      upstreamModel: input.upstreamModel,
      keyId: input.key.id,
      keyPrefix: input.key.prefix,
      accountId: account?.id ?? '',
      accountName: account === undefined ? '' : accountLabel(account),
      providerId: account?.providerId ?? '',
      stream: false,
      status: response.status,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      firstTokenMs: 0,
      durationMs: Date.now() - startedAt,
      error: truncate(text, 300),
    })
  }

  private async writeError(reply: FastifyReply, status: number, code: string, message: string, input: ChatInput, startedAt: number): Promise<void> {
    reply.code(status).type('application/json; charset=utf-8').send({
      error: { message, type: code === 'model_not_allowed' ? 'invalid_request_error' : 'upstream_error', code },
    })
    this.usage.record({
      time: startedAt,
      requestId: input.requestId,
      model: input.requestedModel,
      upstreamModel: input.upstreamModel,
      keyId: input.key.id,
      keyPrefix: input.key.prefix,
      accountId: '',
      accountName: '',
      providerId: '',
      stream: false,
      status,
      promptTokens: 0,
      completionTokens: 0,
      cachedTokens: 0,
      reasoningTokens: 0,
      firstTokenMs: 0,
      durationMs: Date.now() - startedAt,
      error: truncate(message, 300),
    })
  }
}
