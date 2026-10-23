import type { FastifyReply } from 'fastify'
import type { StoredAccount, StoredApiKey } from '../store/schema.js'
import type { GatewayEngine } from './engine.js'
import { readTextLimited, usageFrom } from './engine.js'
import { relayResponsesStream, type RelayMeta } from './relay.js'
import { GatewayError } from './select.js'
import type { UsageService } from './usage.js'
import { accountLabel, truncate } from '../util.js'

export interface ResponsesInput {
  key: StoredApiKey
  body: unknown
  requestedModel: string
  upstreamModel: string
  signal: AbortSignal
  requestId: string
  idleMs: number
}

/** Native pass-through for the OpenAI Responses API. */
export class ResponsesGateway {
  constructor(
    private readonly engine: GatewayEngine,
    private readonly usage: UsageService,
  ) {}

  async handle(reply: FastifyReply, input: ResponsesInput): Promise<void> {
    const startedAt = Date.now()
    const body = typeof input.body === 'object' && input.body !== null
      ? { ...(input.body as Record<string, unknown>), model: input.upstreamModel }
      : input.body
    const stream = typeof body === 'object' && body !== null && (body as Record<string, unknown>)['stream'] === true
    let result
    try {
      result = await this.engine.call({
        key: input.key,
        requestedModel: input.requestedModel,
        upstreamModel: input.upstreamModel,
        path: 'responses',
        body,
        stream,
        signal: input.signal,
        idleMs: input.idleMs,
      })
    } catch (error: unknown) {
      const status = error instanceof GatewayError ? error.status : 502
      const code = error instanceof GatewayError ? error.code : 'upstream_unavailable'
      reply.code(status).type('application/json; charset=utf-8').send({
        error: { message: error instanceof Error ? error.message : String(error), type: 'upstream_error', code },
      })
      return
    }
    const meta: RelayMeta = {
      requestId: input.requestId,
      key: input.key,
      model: input.requestedModel,
      upstreamModel: input.upstreamModel,
      startedAt,
      idleMs: input.idleMs,
      account: result.account,
    }
    if (!result.response.ok) {
      const text = await readTextLimited(result.response)
      reply.code(result.response.status)
        .type(result.response.headers.get('content-type') ?? 'application/json; charset=utf-8')
        .send(text === '' ? JSON.stringify({ error: { message: `上游 HTTP ${result.response.status}`, type: 'upstream_error' } }) : text)
      this.record(input, result.account, result.response.status, startedAt, undefined, truncate(text, 300), false)
      return
    }
    if (stream) {
      this.usage.record(await relayResponsesStream(reply, result, meta))
      return
    }
    const text = await readTextLimited(result.response, 32 * 1024 * 1024)
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
    this.record(input, result.account, 200, startedAt, usage, '', false)
  }

  private record(input: ResponsesInput, account: StoredAccount, status: number, startedAt: number, usage: ReturnType<typeof usageFrom>, error: string, stream: boolean): void {
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
      stream,
      status,
      promptTokens: usage?.prompt ?? 0,
      completionTokens: usage?.completion ?? 0,
      cachedTokens: usage?.cached ?? 0,
      reasoningTokens: usage?.reasoning ?? 0,
      firstTokenMs: 0,
      durationMs: Date.now() - startedAt,
      error,
    })
  }
}
