import type { ModelInfo } from '../../shared/types.js'

const OPTIONAL_FIELDS = [
  'store',
  'stream_options',
  'prompt_cache_key',
  'prompt_cache_retention',
  'service_tier',
  'parallel_tool_calls',
  'metadata',
] as const

export type GatewayShape = 'as-is' | 'optional-fields' | 'text-only-content'

export const SHAPE_FALLBACKS: readonly GatewayShape[] = ['optional-fields', 'text-only-content']

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow a chat body to a shape a strict gateway accepts. */
export function sanitizeBody(body: unknown, shape: GatewayShape): unknown {
  if (shape === 'as-is' || !isRecord(body)) return body
  const next: Record<string, unknown> = { ...body }
  for (const field of OPTIONAL_FIELDS) delete next[field]
  if (Array.isArray(next['messages'])) {
    next['messages'] = next['messages'].map((message: unknown) => {
      if (!isRecord(message)) return message
      const role = message['role'] === 'developer' ? 'system' : message['role']
      const retitled: Record<string, unknown> = role === message['role'] ? message : { ...message, role }
      if (shape !== 'text-only-content' || !Array.isArray(message['content'])) return retitled
      const parts = message['content']
      const textOnly = parts.every(part => isRecord(part) && part['type'] === 'text' && typeof part['text'] === 'string')
      if (!textOnly) return retitled
      return { ...retitled, content: parts.map(part => (part as { text: string }).text).join('\n\n') }
    })
  }
  return next
}

/**
 * Fix wire-format mistakes that make a body invalid for every server:
 * tool-call arguments must be a JSON string, tool results must name their call,
 * and message content must not be null.
 */
export function repairChatBody(body: unknown): { body: unknown; repairs: string[] } {
  if (!isRecord(body) || !Array.isArray(body['messages'])) return { body, repairs: [] }
  const repairs: string[] = []
  const messages: unknown[] = []
  for (const message of body['messages']) {
    if (!isRecord(message)) {
      messages.push(message)
      continue
    }
    const repaired: Record<string, unknown> = { ...message }
    if (repaired['role'] === 'tool' && (typeof repaired['tool_call_id'] !== 'string' || repaired['tool_call_id'] === '')) {
      repairs.push('dropped a tool result with no tool_call_id')
      continue
    }
    if (repaired['content'] === null || repaired['content'] === undefined) {
      if (repaired['role'] === 'tool' || repaired['role'] === 'assistant') {
        repaired['content'] = ''
        repairs.push(`replaced null content with "" on a ${String(repaired['role'])} message`)
      }
    }
    if (Array.isArray(repaired['tool_calls'])) {
      const calls: unknown[] = []
      for (const call of repaired['tool_calls']) {
        if (!isRecord(call) || typeof call['id'] !== 'string' || call['id'] === '') {
          repairs.push('dropped a tool call with no id')
          continue
        }
        const fn = isRecord(call['function']) ? call['function'] : undefined
        if (fn === undefined) {
          repairs.push('dropped a tool call with no function')
          continue
        }
        if (typeof fn['arguments'] !== 'string') {
          calls.push({ ...call, function: { ...fn, arguments: JSON.stringify(fn['arguments'] ?? {}) } })
          repairs.push('re-serialized tool-call arguments to a JSON string')
          continue
        }
        calls.push(call)
      }
      if (calls.length === 0) delete repaired['tool_calls']
      else repaired['tool_calls'] = calls
    }
    messages.push(repaired)
  }
  return repairs.length === 0 ? { body, repairs } : { body: { ...body, messages }, repairs }
}

/** Drop a reasoning_effort the target model does not declare. */
export function dropUnsupportedEffort(body: unknown, models: readonly ModelInfo[]): { body: unknown; dropped?: string } {
  if (!isRecord(body)) return { body }
  const effort = body['reasoning_effort']
  if (effort === undefined || effort === null) return { body }
  if (typeof effort !== 'string') {
    const next = { ...body }
    delete next['reasoning_effort']
    return { body: next, dropped: `reasoning_effort=${JSON.stringify(effort)} is not a string` }
  }
  const model = models.find(item => item.slug === body['model'] || item.name === body['model'])
  if (model === undefined) return { body }
  const allowed = new Set(model.reasoningEfforts)
  if (model.canDisableThinking) allowed.add('none')
  if (allowed.size === 0 && !model.canDisableThinking) {
    const next = { ...body }
    delete next['reasoning_effort']
    return { body: next, dropped: `${String(body['model'])} does not accept reasoning_effort` }
  }
  if (effort === 'off') {
    if (model.canDisableThinking) return { body: { ...body, reasoning_effort: 'none' }, dropped: 'reasoning_effort "off" is spelled "none" upstream' }
    const next = { ...body }
    delete next['reasoning_effort']
    return { body: next, dropped: `${String(body['model'])} cannot switch thinking off` }
  }
  if (allowed.size === 0 || allowed.has(effort)) return { body }
  const next = { ...body }
  delete next['reasoning_effort']
  return { body: next, dropped: `${String(body['model'])} does not offer reasoning_effort "${effort}"` }
}

/** Compact, content-free description of a request for a 400 error message. */
export function describeRequest(body: unknown): string {
  if (!isRecord(body)) return 'not an object'
  const messages = Array.isArray(body['messages']) ? body['messages'] : []
  const roles = messages.map(message => (isRecord(message) ? String(message['role']) : '?')).join('>')
  const tools = Array.isArray(body['tools']) ? body['tools'].length : 0
  const maxTokens = body['max_tokens'] ?? body['max_completion_tokens']
  const effort = body['reasoning_effort'] === undefined ? undefined : String(body['reasoning_effort'])
  return [
    `model=${String(body['model'])}`,
    `max_tokens=${maxTokens === undefined ? 'unset' : String(maxTokens)}`,
    `messages=${messages.length} (${roles.slice(0, 80)})`,
    `tools=${tools}`,
    ...(effort === undefined ? [] : [`reasoning_effort=${effort}`]),
    `fields=${Object.keys(body).sort().join('/')}`,
  ].join(', ')
}
