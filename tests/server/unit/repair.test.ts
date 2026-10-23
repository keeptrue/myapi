import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '../../../src/shared/types.js'
import { dropUnsupportedEffort, repairChatBody, sanitizeBody } from '../../../src/server/gateway/repair.js'

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    slug: 'xopglm52',
    name: 'GLM-5.2',
    description: '',
    directoryId: 'lm_glm52',
    provider: '',
    contextWindow: 1000000,
    maxOutputTokens: 8192,
    inputModalities: ['text'],
    reasoningEfforts: ['low', 'high'],
    defaultReasoning: 'high',
    canDisableThinking: false,
    pointMultiplier: '',
    pointMultipliers: [],
    priority: 0,
    source: 'model-manager',
    available: true,
    availableAccountIds: [],
    ...overrides,
  }
}

describe('repairChatBody', () => {
  it('drops tool results without a call id and null content', () => {
    const result = repairChatBody({
      messages: [
        { role: 'tool', content: 'x' },
        { role: 'assistant', content: null },
      ],
    })
    expect(result.repairs.length).toBeGreaterThan(0)
    const messages = (result.body as { messages: Array<Record<string, unknown>> }).messages
    expect(messages).toHaveLength(1)
    expect(messages[0]?.['content']).toBe('')
  })

  it('re-serializes tool call arguments', () => {
    const result = repairChatBody({
      messages: [{
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', type: 'function', function: { name: 'x', arguments: { a: 1 } } }],
      }],
    })
    const messages = (result.body as { messages: Array<Record<string, unknown>> }).messages
    const call = (messages[0]?.['tool_calls'] as Array<Record<string, unknown>>)[0]
    expect((call?.['function'] as Record<string, unknown>)['arguments']).toBe('{"a":1}')
  })
})

describe('dropUnsupportedEffort', () => {
  it('keeps a declared effort', () => {
    expect(dropUnsupportedEffort({ model: 'xopglm52', reasoning_effort: 'high' }, [model()]).dropped).toBeUndefined()
  })

  it('drops an undeclared effort', () => {
    const result = dropUnsupportedEffort({ model: 'xopglm52', reasoning_effort: 'max' }, [model()])
    expect(result.dropped).toBeDefined()
    expect((result.body as Record<string, unknown>)['reasoning_effort']).toBeUndefined()
  })

  it('renames off to none when thinking can be disabled', () => {
    const result = dropUnsupportedEffort({ model: 'xopglm52', reasoning_effort: 'off' }, [model({ canDisableThinking: true })])
    expect((result.body as Record<string, unknown>)['reasoning_effort']).toBe('none')
  })
})

describe('sanitizeBody', () => {
  it('removes platform-only fields and rewrites developer role', () => {
    const result = sanitizeBody({
      model: 'x',
      store: false,
      stream_options: {},
      messages: [{ role: 'developer', content: 'hi' }],
    }, 'optional-fields') as Record<string, unknown>
    expect(result['store']).toBeUndefined()
    expect((result['messages'] as Array<Record<string, unknown>>)[0]?.['role']).toBe('system')
  })

  it('flattens text-only content arrays in the final fallback', () => {
    const result = sanitizeBody({
      messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }],
    }, 'text-only-content') as Record<string, unknown>
    expect((result['messages'] as Array<Record<string, unknown>>)[0]?.['content']).toBe('a\n\nb')
  })
})
