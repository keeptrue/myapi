import { isRecord, stringField } from '../util.js'

export interface AnthropicConverted {
  body: Record<string, unknown>
  stream: boolean
}

function systemText(raw: unknown): string {
  if (typeof raw === 'string') return raw
  if (Array.isArray(raw)) {
    return raw
      .filter(isRecord)
      .filter(block => block['type'] === 'text' && typeof block['text'] === 'string')
      .map(block => String(block['text']))
      .join('\n\n')
  }
  return ''
}

function imageUrl(block: Record<string, unknown>): string {
  const source = isRecord(block['source']) ? block['source'] : undefined
  if (source === undefined) return ''
  if (source['type'] === 'base64') {
    const media = stringField(source['media_type'])
    const data = stringField(source['data'])
    return media === '' || data === '' ? '' : `data:${media};base64,${data}`
  }
  if (source['type'] === 'url') return stringField(source['url'])
  return ''
}

function toolResultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(isRecord)
      .map(item => typeof item['text'] === 'string' ? item['text'] : '')
      .filter(text => text !== '')
      .join('\n')
  }
  if (content === undefined || content === null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}

function convertMessage(message: Record<string, unknown>): unknown[] {
  const role = stringField(message['role']) || 'user'
  const content = message['content']
  if (typeof content === 'string') return [{ role, content }]
  if (!Array.isArray(content)) throw new Error('message content must be a string or an array of blocks')

  const textParts: unknown[] = []
  const toolCalls: unknown[] = []
  const toolResults: unknown[] = []
  for (const raw of content) {
    if (!isRecord(raw)) continue
    switch (raw['type']) {
      case 'text':
        if (typeof raw['text'] === 'string' && raw['text'] !== '') {
          textParts.push({ type: 'text', text: raw['text'] })
        }
        break
      case 'image': {
        const url = imageUrl(raw)
        if (url !== '') textParts.push({ type: 'image_url', image_url: { url } })
        break
      }
      case 'tool_use': {
        let input = '{}'
        try {
          input = JSON.stringify(raw['input'] ?? {})
        } catch {
          input = '{}'
        }
        toolCalls.push({
          id: stringField(raw['id']),
          type: 'function',
          function: { name: stringField(raw['name']), arguments: input },
        })
        break
      }
      case 'tool_result':
        toolResults.push({
          role: 'tool',
          tool_call_id: stringField(raw['tool_use_id']),
          content: toolResultText(raw['content']),
        })
        break
      default:
        break
    }
  }

  if (role === 'assistant') {
    const output: Record<string, unknown> = { role: 'assistant', content: textParts.length > 0 ? textParts : '' }
    if (toolCalls.length > 0) output['tool_calls'] = toolCalls
    return [output]
  }
  const output: unknown[] = [...toolResults]
  if (textParts.length > 0) output.push({ role, content: textParts })
  if (output.length === 0) output.push({ role, content: '' })
  return output
}

function toolChoice(raw: unknown): unknown {
  if (!isRecord(raw)) return undefined
  const type = stringField(raw['type'])
  if (type === 'auto') return 'auto'
  if (type === 'any') return 'required'
  if (type === 'none') return 'none'
  if (type === 'tool') {
    const name = stringField(raw['name'])
    return name === '' ? undefined : { type: 'function', function: { name } }
  }
  return undefined
}

/** Convert an Anthropic Messages request into an OpenAI chat-completions body. */
export function toChatBody(request: unknown, upstreamModel: string): AnthropicConverted {
  if (!isRecord(request)) throw new Error('request body must be an object')
  const messages = request['messages']
  if (!Array.isArray(messages)) throw new Error('messages must be an array')
  const converted: unknown[] = []
  const system = systemText(request['system'])
  if (system !== '') converted.push({ role: 'system', content: system })
  for (const message of messages) {
    if (!isRecord(message)) throw new Error('each message must be an object')
    converted.push(...convertMessage(message))
  }
  const stream = request['stream'] === true
  const body: Record<string, unknown> = { model: upstreamModel, messages: converted, stream }
  const maxTokens = request['max_tokens']
  if (typeof maxTokens === 'number' && maxTokens > 0) body['max_tokens'] = Math.floor(maxTokens)
  for (const field of ['temperature', 'top_p'] as const) {
    const value = request[field]
    if (typeof value === 'number' && Number.isFinite(value)) body[field] = value
  }
  if (Array.isArray(request['stop_sequences']) && request['stop_sequences'].length > 0) {
    body['stop'] = request['stop_sequences'].filter((item): item is string => typeof item === 'string')
  }
  if (Array.isArray(request['tools']) && request['tools'].length > 0) {
    const tools: unknown[] = []
    for (const tool of request['tools']) {
      if (!isRecord(tool)) continue
      const name = stringField(tool['name'])
      if (name === '') continue
      tools.push({
        type: 'function',
        function: {
          name,
          description: stringField(tool['description']),
          parameters: isRecord(tool['input_schema']) ? tool['input_schema'] : { type: 'object', properties: {} },
        },
      })
    }
    if (tools.length > 0) body['tools'] = tools
  }
  const choice = toolChoice(request['tool_choice'])
  if (choice !== undefined) body['tool_choice'] = choice
  if (stream) body['stream_options'] = { include_usage: true }
  return { body, stream }
}

function stopReason(finishReason: string, fallback: string): string {
  if (finishReason === 'stop') return 'end_turn'
  if (finishReason === 'length') return 'max_tokens'
  if (finishReason === 'tool_calls' || finishReason === 'function_call') return 'tool_use'
  if (finishReason === 'content_filter') return 'stop_sequence'
  return fallback
}

function parseArguments(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return {}
  try {
    return JSON.parse(value) as unknown
  } catch {
    return {}
  }
}

export interface AnthropicMessageResult {
  payload: Record<string, unknown>
  usage: { prompt: number; completion: number; cached: number; reasoning: number }
}

/** Convert a buffered chat completion into an Anthropic message. */
export function toAnthropicMessage(completion: unknown, requestedModel: string): AnthropicMessageResult {
  const record = isRecord(completion) ? completion : {}
  const usageRaw = isRecord(record['usage']) ? record['usage'] : {}
  const prompt = numberValue(usageRaw['prompt_tokens'] ?? usageRaw['input_tokens'])
  const completionTokens = numberValue(usageRaw['completion_tokens'] ?? usageRaw['output_tokens'])
  const details = isRecord(usageRaw['prompt_tokens_details']) ? usageRaw['prompt_tokens_details'] : {}
  const content: unknown[] = []
  let reason = 'end_turn'
  const choices = Array.isArray(record['choices']) ? record['choices'] : []
  const choice = isRecord(choices[0]) ? choices[0] : {}
  const message = isRecord(choice['message']) ? choice['message'] : {}
  if (typeof message['content'] === 'string' && message['content'] !== '') {
    content.push({ type: 'text', text: message['content'] })
  } else if (Array.isArray(message['content'])) {
    for (const part of message['content']) {
      if (isRecord(part) && typeof part['text'] === 'string' && part['text'] !== '') {
        content.push({ type: 'text', text: part['text'] })
      }
    }
  }
  const calls = Array.isArray(message['tool_calls']) ? message['tool_calls'] : []
  if (calls.length > 0) {
    reason = 'tool_use'
    for (const call of calls) {
      if (!isRecord(call)) continue
      const fn = isRecord(call['function']) ? call['function'] : {}
      content.push({
        type: 'tool_use',
        id: stringField(call['id']),
        name: stringField(fn['name']),
        input: parseArguments(fn['arguments']),
      })
    }
  }
  const finish = stringField(choice['finish_reason'])
  if (finish !== '') reason = stopReason(finish, reason)
  return {
    payload: {
      id: `msg_${crypto.randomUUID().replaceAll('-', '').slice(0, 24)}`,
      type: 'message',
      role: 'assistant',
      model: requestedModel,
      content,
      stop_reason: reason,
      stop_sequence: null,
      usage: { input_tokens: prompt, output_tokens: completionTokens },
    },
    usage: {
      prompt,
      completion: completionTokens,
      cached: numberValue(details['cached_tokens']),
      reasoning: 0,
    },
  }
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function anthropicError(type: string, message: string): { type: 'error'; error: { type: string; message: string } } {
  return { type: 'error', error: { type, message } }
}
