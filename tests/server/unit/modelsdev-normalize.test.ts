import { describe, expect, it } from 'vitest'
import { normalizeApi } from '../../../src/server/modelsdev/normalize.js'

const raw = {
  alpha: {
    id: 'alpha',
    name: 'Alpha Lab',
    models: {
      'model-1': {
        id: 'model-1',
        name: 'Model One',
        type: 'chat',
        family: 'one',
        modalities: { input: ['text', 'image'], output: ['text'] },
        limit: { context: 1_000_000, input: 900_000, output: 100_000 },
        reasoning: true,
        reasoning_options: [
          { type: 'toggle' },
          { type: 'effort', values: ['low', 'high'] },
          { type: 'budget_tokens', min: 1024, max: 8192 },
        ],
        tool_call: true,
        attachment: true,
        structured_output: true,
        temperature: true,
        open_weights: true,
        knowledge: '2025-01',
        release_date: '2026-01-01',
        last_updated: '2026-02-01',
        cost: {
          input: 1,
          output: 2,
          cache_read: 0.1,
          cache_write: 0.2,
          reasoning: 2,
          tiers: [{ input: 3, output: 4, tier: { type: 'context', size: 200_000 } }],
          context_over_200k: { input: 5, output: 6 },
        },
        canonical_model_id: 'alpha/model-1',
      },
      embed: {
        id: 'embed',
        name: 'Embedding',
        type: 'embedding',
        modalities: { input: ['text'], output: ['text'] },
      },
      image: {
        id: 'image',
        name: 'Image Output',
        type: 'chat',
        modalities: { input: ['text'], output: ['image'] },
      },
      'no-type': {
        id: 'no-type',
        name: 'No Type',
        modalities: { input: ['text'], output: ['text'] },
      },
    },
  },
  empty: {
    id: 'empty',
    name: 'Empty Lab',
    models: {},
  },
}

describe('models.dev normalization', () => {
  it('keeps text-output chat rows and maps cost, limits and reasoning options', () => {
    const snapshot = normalizeApi(raw, 'https://models.dev/api.json', 123, 'etag-1')
    expect(snapshot.version).toBe(1)
    expect(snapshot.fetchedAt).toBe(123)
    expect(snapshot.checkedAt).toBe(123)
    expect(snapshot.etag).toBe('etag-1')
    expect(snapshot.providers.map(provider => provider.id)).toEqual(['alpha'])
    expect(snapshot.models.map(entry => entry.modelId).sort()).toEqual(['model-1', 'no-type'])

    const one = snapshot.models.find(entry => entry.modelId === 'model-1')
    expect(one).toMatchObject({
      key: 'alpha/model-1',
      canonicalId: 'alpha/model-1',
      contextWindow: 1_000_000,
      maxInputTokens: 900_000,
      maxOutputTokens: 100_000,
      inputModalities: ['text', 'image'],
      outputModalities: ['text'],
      reasoning: true,
      toolCall: true,
      attachment: true,
      structuredOutput: true,
      temperature: true,
      openWeights: true,
      knowledge: '2025-01',
      releaseDate: '2026-01-01',
      lastUpdated: '2026-02-01',
    })
    expect(one?.reasoningOptions.map(option => option.type)).toEqual(['toggle', 'effort', 'budget_tokens'])
    expect(one?.cost?.input).toBe(1)
    expect(one?.cost?.cacheRead).toBe(0.1)
    expect(one?.cost?.tiers).toEqual([{ threshold: 200_000, input: 3, output: 4 }])
    expect(one?.cost?.contextOver200k).toEqual({ input: 5, output: 6 })
  })

  it('accepts the providers wrapper shape and tolerates malformed roots', () => {
    const wrapped = normalizeApi({ providers: raw }, 'u', 1)
    expect(wrapped.models.length).toBe(2)
    const empty = normalizeApi(null, 'u', 1)
    expect(empty.models).toEqual([])
    expect(empty.providers).toEqual([])
  })
})
