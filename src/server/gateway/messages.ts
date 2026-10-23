import type { FastifyReply } from 'fastify'
import type { LogEntry } from '../../shared/types.js'
import type { StoredAccount, StoredApiKey } from '../store/schema.js'
import type { UsageService } from './usage.js'
import type { GatewayEngine, UsageShape } from './engine.js'
import { readTextLimited, usageFrom } from './engine.js'
import { GatewayError } from './select.js'
import { SseDecoder, sseFrame } from './sse.js'
import { anthropicError, toAnthropicMessage, toChatBody } from './messages-convert.js'
import { truncate } from '../util.js'

export interface MessagesInput {
  key: StoredApiKey
  body: unknown
  requestedModel: string
  upstreamModel: string
  signal: AbortSignal
  requestId: string
  idleMs: number
}

interface ToolAccumulator {
  id: string
  name: string
  arguments: string
  blockIndex: number
  started: boolean
}

/** Anthropic Messages bridge: convert request, proxy chat completions, convert back. */
export class AnthropicGateway {
  constructor(
    private readonly engine: GatewayEngine,
    private readonly usage: UsageService,
  ) {}

  async handle(reply: FastifyReply, input: MessagesInput): Promise<void> {
    const startedAt = Date.now()
    let converted
    try {
      converted = toChatBody(input.body, input.upstreamModel)
    } catch (error: unknown) {
      reply.code(400).type('application/json; charset=utf-8').send(anthropicError('invalid_request_error', error instanceof Error ? error.message : String(error)))
      return
    }
    let result
    try {
      result = await this.engine.call({
        key: input.key,
        requestedModel: input.requestedModel,
        upstreamModel: input.upstreamModel,
        path: 'chat/completions',
        body: converted.body,
        stream: converted.stream,
        signal: input.signal,
        idleMs: input.idleMs,
      })
    } catch (error: unknown) {
      const status = error instanceof GatewayError ? error.status : 502
      const type = error instanceof GatewayError && error.status < 500 ? 'invalid_request_error' : 'api_error'
      reply.code(status).type('application/json; charset=utf-8').send(anthropicError(type, error instanceof Error ? error.message : String(error)))
      return
    }
    if (!result.response.ok) {
      const text = await readTextLimited(result.response)
      reply.code(result.response.status).type('application/json; charset=utf-8').send(anthropicError('api_error', text === '' ? `上游 HTTP ${result.response.status}` : truncate(text, 500)))
      this.record(input, result.account, result.response.status, startedAt, undefined, truncate(text, 300), false)
      return
    }
    if (converted.stream) {
      this.usage.record(await this.relayStream(reply, result, input, startedAt))
      return
    }
    const text = await readTextLimited(result.response, 32 * 1024 * 1024)
    let completion: unknown
    try {
      completion = JSON.parse(text)
    } catch {
      reply.code(502).type('application/json; charset=utf-8').send(anthropicError('api_error', '上游返回了无法解析的响应'))
      return
    }
    const convertedResponse = toAnthropicMessage(completion, input.requestedModel)
    reply.code(200).type('application/json; charset=utf-8').send(convertedResponse.payload)
    this.record(input, result.account, 200, startedAt, convertedResponse.usage, '', false)
  }

  private async relayStream(
    reply: FastifyReply,
    result: Awaited<ReturnType<GatewayEngine['call']>>,
    input: MessagesInput,
    startedAt: number,
  ): Promise<LogEntry> {
    const reader = result.response.body?.getReader()
    if (reader === undefined) {
      reply.code(502).type('application/json; charset=utf-8').send(anthropicError('api_error', '上游没有返回流式响应体'))
      return this.entry(input, result.account, 502, startedAt, undefined, 'empty upstream stream')
    }
    reply.hijack()
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const send = (event: string, data: unknown): void => {
      if (!reply.raw.writableEnded) reply.raw.write(sseFrame(data, event))
    }
    const messageId = `msg_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`
    send('message_start', {
      type: 'message_start',
      message: {
        id: messageId,
        type: 'message',
        role: 'assistant',
        model: input.requestedModel,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    })

    const decoder = new SseDecoder()
    const textDecoder = new TextDecoder()
    let idleTimer: NodeJS.Timeout | undefined
    let usage: UsageShape | undefined
    let firstTokenAt: number | undefined
    let stopReason = 'end_turn'
    let nextBlock = 0
    let textBlockOpen = false
    const toolBlocks = new Map<number, ToolAccumulator>()
    let error = ''

    const resetIdle = (): void => {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => result.controller.abort(), input.idleMs)
      idleTimer.unref?.()
    }
    resetIdle()

    const closeText = (): void => {
      if (textBlockOpen) {
        send('content_block_stop', { type: 'content_block_stop', index: nextBlock - 1 })
        textBlockOpen = false
      }
    }

    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        resetIdle()
        for (const event of decoder.push(textDecoder.decode(value, { stream: true }))) {
          if (event.data.trim() === '[DONE]' || event.data.trim() === '') continue
          let chunk: Record<string, unknown>
          try {
            chunk = JSON.parse(event.data) as Record<string, unknown>
          } catch {
            continue
          }
          const parsedUsage = usageFrom(chunk)
          if (parsedUsage !== undefined) usage = parsedUsage
          const choices = Array.isArray(chunk['choices']) ? chunk['choices'] : []
          const choice = typeof choices[0] === 'object' && choices[0] !== null ? choices[0] as Record<string, unknown> : undefined
          if (choice === undefined) continue
          const delta = typeof choice['delta'] === 'object' && choice['delta'] !== null ? choice['delta'] as Record<string, unknown> : {}
          const text = typeof delta['content'] === 'string' ? delta['content'] : ''
          if (text !== '') {
            if (firstTokenAt === undefined) firstTokenAt = Date.now()
            if (!textBlockOpen) {
              send('content_block_start', {
                type: 'content_block_start',
                index: nextBlock,
                content_block: { type: 'text', text: '' },
              })
              textBlockOpen = true
              nextBlock += 1
            }
            send('content_block_delta', {
              type: 'content_block_delta',
              index: nextBlock - 1,
              delta: { type: 'text_delta', text },
            })
          }
          const calls = Array.isArray(delta['tool_calls']) ? delta['tool_calls'] : []
          for (const rawCall of calls) {
            if (typeof rawCall !== 'object' || rawCall === null) continue
            const call = rawCall as Record<string, unknown>
            const index = typeof call['index'] === 'number' ? call['index'] : 0
            let acc = toolBlocks.get(index)
            if (acc === undefined) {
              acc = { id: '', name: '', arguments: '', blockIndex: -1, started: false }
              toolBlocks.set(index, acc)
            }
            if (typeof call['id'] === 'string' && call['id'] !== '') acc.id = call['id']
            const fn = typeof call['function'] === 'object' && call['function'] !== null ? call['function'] as Record<string, unknown> : {}
            if (typeof fn['name'] === 'string' && fn['name'] !== '') acc.name = fn['name']
            if (!acc.started && acc.name !== '') {
              closeText()
              acc.blockIndex = nextBlock
              acc.started = true
              nextBlock += 1
              if (firstTokenAt === undefined) firstTokenAt = Date.now()
              send('content_block_start', {
                type: 'content_block_start',
                index: acc.blockIndex,
                content_block: { type: 'tool_use', id: acc.id, name: acc.name, input: {} },
              })
            }
            const args = typeof fn['arguments'] === 'string' ? fn['arguments'] : ''
            if (args !== '') {
              acc.arguments += args
              if (acc.started) {
                send('content_block_delta', {
                  type: 'content_block_delta',
                  index: acc.blockIndex,
                  delta: { type: 'input_json_delta', partial_json: args },
                })
              }
            }
          }
          const finish = typeof choice['finish_reason'] === 'string' ? choice['finish_reason'] : ''
          if (finish !== '') {
            if (finish === 'stop') stopReason = 'end_turn'
            else if (finish === 'length') stopReason = 'max_tokens'
            else if (finish === 'tool_calls' || finish === 'function_call') stopReason = 'tool_use'
            else if (finish === 'content_filter') stopReason = 'stop_sequence'
          }
        }
      }
      for (const event of decoder.flush()) {
        if (event.data.trim() === '' || event.data.trim() === '[DONE]') continue
        // The final buffered event has already been accounted for by the loop above.
        void event
      }
      closeText()
      for (const acc of toolBlocks.values()) {
        if (acc.started) send('content_block_stop', { type: 'content_block_stop', index: acc.blockIndex })
      }
      send('message_delta', {
        type: 'message_delta',
        delta: { stop_reason: stopReason, stop_sequence: null },
        usage: { output_tokens: usage?.completion ?? 0 },
      })
      send('message_stop', { type: 'message_stop' })
      reply.raw.end()
      return this.entry(input, result.account, 200, startedAt, usage, '', firstTokenAt)
    } catch (caught: unknown) {
      error = caught instanceof Error ? caught.message : String(caught)
      if (!reply.raw.writableEnded) {
        send('error', anthropicError('api_error', truncate(error, 300)))
        reply.raw.end()
      }
      return this.entry(input, result.account, 502, startedAt, usage, error, firstTokenAt)
    } finally {
      if (idleTimer !== undefined) clearTimeout(idleTimer)
      void reader.cancel().catch(() => undefined)
    }
  }

  private entry(input: MessagesInput, account: StoredAccount, status: number, startedAt: number, usage: UsageShape | undefined, error: string, firstTokenAt?: number): LogEntry {
    return {
      time: startedAt,
      requestId: input.requestId,
      model: input.requestedModel,
      upstreamModel: input.upstreamModel,
      keyId: input.key.id,
      keyPrefix: input.key.prefix,
      accountId: account.id,
      accountName: account.nickname || account.name || account.accountId,
      stream: true,
      status,
      promptTokens: usage?.prompt ?? 0,
      completionTokens: usage?.completion ?? 0,
      cachedTokens: usage?.cached ?? 0,
      reasoningTokens: usage?.reasoning ?? 0,
      firstTokenMs: firstTokenAt === undefined ? 0 : firstTokenAt - startedAt,
      durationMs: Date.now() - startedAt,
      error,
    }
  }

  private record(input: MessagesInput, account: StoredAccount, status: number, startedAt: number, usage: { prompt: number; completion: number; cached: number; reasoning: number } | undefined, error: string, stream: boolean): void {
    this.usage.record({
      time: startedAt,
      requestId: input.requestId,
      model: input.requestedModel,
      upstreamModel: input.upstreamModel,
      keyId: input.key.id,
      keyPrefix: input.key.prefix,
      accountId: account.id,
      accountName: account.nickname || account.name || account.accountId,
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
