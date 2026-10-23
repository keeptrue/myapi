import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '../../../src/shared/types.js'
import {
  PROBE_IMAGE_DATA_URI,
  buildProbeBody,
  classifyProbeFailure,
  contentText,
  emptyProbeUsage,
  parseProbeReply,
  type ProbeInput,
} from '../../../src/server/models/probe.js'

function model(overrides: Partial<ModelInfo> = {}): ModelInfo {
  return {
    slug: 'xopglm52',
    name: 'GLM-5.2',
    description: '',
    directoryId: 'lm_glm52',
    provider: '',
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
    inputModalities: ['text'],
    reasoningEfforts: ['low', 'high', 'max'],
    defaultReasoning: 'high',
    canDisableThinking: true,
    pointMultiplier: '1',
    pointMultipliers: [],
    priority: 0,
    source: 'model-manager',
    available: true,
    availableAccountIds: [],
    ...overrides,
  }
}

function input(overrides: Partial<ProbeInput> = {}): ProbeInput {
  return {
    model: model(),
    message: 'hi',
    effort: 'high',
    maxTokens: 512,
    allAccounts: false,
    image: false,
    ...overrides,
  }
}

describe('probe request/response helpers', () => {
  it('builds a text request with the selected effort', () => {
    const body = buildProbeBody(input())
    expect(body).toMatchObject({
      model: 'xopglm52',
      max_tokens: 512,
      stream: false,
      reasoning_effort: 'high',
      messages: [{ role: 'user', content: 'hi' }],
    })
  })

  it('omits reasoning_effort when the caller sends an empty effort', () => {
    const body = buildProbeBody(input({ effort: '' }))
    expect(body['reasoning_effort']).toBeUndefined()
  })

  it('builds an image content array with a built-in data URI', () => {
    expect(PROBE_IMAGE_DATA_URI.startsWith('data:image/png;base64,')).toBe(true)
    const body = buildProbeBody(input({ image: true }))
    const messages = body['messages'] as Array<{ content: unknown }>
    const content = messages[0]?.content as Array<Record<string, unknown>>
    expect(Array.isArray(content)).toBe(true)
    expect(content[0]).toMatchObject({ type: 'text', text: 'hi' })
    expect(content[1]).toMatchObject({ type: 'image_url' })
    expect((content[1]?.['image_url'] as Record<string, unknown>)['url']).toBe(PROBE_IMAGE_DATA_URI)
  })

  it('parses content, reasoning, finish reason and usage', () => {
    const parsed = parseProbeReply(JSON.stringify({
      choices: [{
        finish_reason: 'stop',
        message: { role: 'assistant', content: '你好', reasoning_content: 'think' },
      }],
      usage: {
        prompt_tokens: 8,
        completion_tokens: 12,
        total_tokens: 20,
        prompt_tokens_details: { cached_tokens: 3 },
        completion_tokens_details: { reasoning_tokens: 4 },
      },
    }))
    expect(parsed).toEqual({
      content: '你好',
      reasoning: 'think',
      finishReason: 'stop',
      usage: { promptTokens: 8, completionTokens: 12, totalTokens: 20, cachedTokens: 3, reasoningTokens: 4 },
    })
  })

  it('parses content arrays and rejects unreadable or choiceless responses', () => {
    expect(contentText([{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }])).toBe('ab')
    expect(contentText([{ type: 'image_url', image_url: { url: 'x' } }])).toBe('')
    expect(parseProbeReply('not-json')).toBeUndefined()
    expect(parseProbeReply(JSON.stringify({ choices: [] }))).toBeUndefined()
  })

  it('classifies effort rejections separately from upstream failures', () => {
    expect(classifyProbeFailure(400, JSON.stringify({
      error: { code: 'invalid_parameter_value', message: 'reasoning_effort is not supported' },
    }))).toMatchObject({ state: 'rejected', validation: 'non-validating' })
    expect(classifyProbeFailure(400, 'thinking budget is invalid')).toMatchObject({ state: 'rejected' })
    expect(classifyProbeFailure(400, JSON.stringify({ error: { message: 'bad payload' } }))).toMatchObject({ state: 'failed' })
    expect(classifyProbeFailure(500, 'upstream down')).toMatchObject({ state: 'failed' })
    expect(emptyProbeUsage()).toEqual({ promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 })
  })
})
