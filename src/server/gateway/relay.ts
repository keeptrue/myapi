import type { FastifyReply } from 'fastify'
import type { LogEntry } from '../../shared/types.js'
import type { StoredAccount, StoredApiKey } from '../store/schema.js'
import { SseDecoder, sseFrame } from './sse.js'
import { usageFrom, type CallResult, type UsageShape } from './engine.js'
import { accountLabel, truncate } from '../util.js'

export interface RelayMeta {
  requestId: string
  key: StoredApiKey
  model: string
  upstreamModel: string
  startedAt: number
  idleMs: number
  account?: StoredAccount
}

function logOf(meta: RelayMeta, input: {
  status: number
  usage?: UsageShape
  firstTokenAt?: number
  error?: string
  account?: StoredAccount
}): LogEntry {
  const account = input.account ?? meta.account
  return {
    time: meta.startedAt,
    requestId: meta.requestId,
    model: meta.model,
    upstreamModel: meta.upstreamModel,
    keyId: meta.key.id,
    keyPrefix: meta.key.prefix,
    accountId: account?.id ?? '',
    accountName: account === undefined ? '' : accountLabel(account),
    providerId: account?.providerId ?? '',
    stream: true,
    status: input.status,
    promptTokens: input.usage?.prompt ?? 0,
    completionTokens: input.usage?.completion ?? 0,
    cachedTokens: input.usage?.cached ?? 0,
    reasoningTokens: input.usage?.reasoning ?? 0,
    firstTokenMs: input.firstTokenAt === undefined ? 0 : input.firstTokenAt - meta.startedAt,
    durationMs: Date.now() - meta.startedAt,
    error: input.error ?? '',
  }
}

function streamHeaders(reply: FastifyReply): void {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  })
}

/** Relay an OpenAI chat completion SSE stream to the client. */
export async function relayChatStream(reply: FastifyReply, result: CallResult, meta: RelayMeta): Promise<LogEntry> {
  const reader = result.response.body?.getReader()
  if (reader === undefined) {
    reply.code(502).send({ error: { message: '上游没有返回流式响应体', type: 'upstream_error', code: 'empty_stream' } })
    return logOf(meta, { status: 502, error: 'empty upstream stream', account: result.account })
  }
  reply.hijack()
  streamHeaders(reply)
  const decoder = new SseDecoder()
  const textDecoder = new TextDecoder()
  let idleTimer: NodeJS.Timeout | undefined
  let sawDone = false
  let usage: UsageShape | undefined
  let firstTokenAt: number | undefined
  let error = ''
  const resetIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => {
      result.controller.abort()
    }, meta.idleMs)
    idleTimer.unref?.()
  }
  resetIdle()

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      for (const event of decoder.push(textDecoder.decode(value, { stream: true }))) {
        if (event.data.trim() === '[DONE]') {
          sawDone = true
          reply.raw.write(event.raw)
          continue
        }
        let payload: unknown
        try {
          payload = JSON.parse(event.data)
        } catch {
          reply.raw.write(event.raw)
          continue
        }
        if (typeof payload === 'object' && payload !== null) {
          const record = payload as Record<string, unknown>
          const parsedUsage = usageFrom(record)
          if (parsedUsage !== undefined) usage = parsedUsage
          if (firstTokenAt === undefined && hasContent(record)) firstTokenAt = Date.now()
          if (typeof record['model'] === 'string' && record['model'] !== meta.model) {
            record['model'] = meta.model
          }
          reply.raw.write(sseFrame(record))
        } else {
          reply.raw.write(event.raw)
        }
      }
    }
    for (const event of decoder.flush()) {
      if (event.data.trim() === '[DONE]') {
        sawDone = true
        reply.raw.write(event.raw)
      } else {
        reply.raw.write(event.raw)
      }
    }
    if (!sawDone) reply.raw.write(sseFrame('[DONE]'))
    reply.raw.end()
    return logOf(meta, { status: 200, usage, ...(firstTokenAt === undefined ? {} : { firstTokenAt }), account: result.account })
  } catch (caught: unknown) {
    error = caught instanceof Error ? caught.message : String(caught)
    if (!reply.raw.writableEnded) {
      if (!sawDone) {
        reply.raw.write(sseFrame({ error: { message: truncate(error, 300), type: 'upstream_stream_error' } }))
        reply.raw.write(sseFrame('[DONE]'))
      }
      reply.raw.end()
    }
    return logOf(meta, { status: 502, usage, error, account: result.account, ...(firstTokenAt === undefined ? {} : { firstTokenAt }) })
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    void reader.cancel().catch(() => undefined)
  }
}

/** Relay an OpenAI Responses SSE stream, parsing usage but preserving events. */
export async function relayResponsesStream(reply: FastifyReply, result: CallResult, meta: RelayMeta): Promise<LogEntry> {
  const reader = result.response.body?.getReader()
  if (reader === undefined) {
    reply.code(502).send({ error: { message: '上游没有返回流式响应体', type: 'upstream_error', code: 'empty_stream' } })
    return logOf(meta, { status: 502, error: 'empty upstream stream', account: result.account })
  }
  reply.hijack()
  streamHeaders(reply)
  const decoder = new SseDecoder()
  const textDecoder = new TextDecoder()
  let idleTimer: NodeJS.Timeout | undefined
  let usage: UsageShape | undefined
  let firstTokenAt: number | undefined
  let error = ''
  const resetIdle = (): void => {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    idleTimer = setTimeout(() => result.controller.abort(), meta.idleMs)
    idleTimer.unref?.()
  }
  resetIdle()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      resetIdle()
      for (const event of decoder.push(textDecoder.decode(value, { stream: true }))) {
        reply.raw.write(event.raw)
        if (event.data.trim() === '[DONE]' || event.data.trim() === '') continue
        try {
          const payload = JSON.parse(event.data) as Record<string, unknown>
          const parsedUsage = usageFrom(payload)
          if (parsedUsage !== undefined) usage = parsedUsage
          if (firstTokenAt === undefined && (payload['type'] === 'response.output_text.delta' || payload['type'] === 'response.output_item.added')) {
            firstTokenAt = Date.now()
          }
        } catch {
          // Non-JSON data is forwarded verbatim.
        }
      }
    }
    for (const event of decoder.flush()) reply.raw.write(event.raw)
    reply.raw.end()
    return logOf(meta, { status: 200, usage, ...(firstTokenAt === undefined ? {} : { firstTokenAt }), account: result.account })
  } catch (caught: unknown) {
    error = caught instanceof Error ? caught.message : String(caught)
    if (!reply.raw.writableEnded) reply.raw.end()
    return logOf(meta, { status: 502, usage, error, account: result.account })
  } finally {
    if (idleTimer !== undefined) clearTimeout(idleTimer)
    void reader.cancel().catch(() => undefined)
  }
}

function hasContent(record: Record<string, unknown>): boolean {
  const choices = Array.isArray(record['choices']) ? record['choices'] : []
  const first = choices[0]
  if (typeof first !== 'object' || first === null) return false
  const delta = (first as Record<string, unknown>)['delta']
  if (typeof delta !== 'object' || delta === null) return false
  const d = delta as Record<string, unknown>
  return (typeof d['content'] === 'string' && d['content'] !== '')
    || (typeof d['reasoning_content'] === 'string' && d['reasoning_content'] !== '')
    || Array.isArray(d['tool_calls'])
}
