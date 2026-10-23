import { describe, expect, it } from 'vitest'
import type { ModelInfo } from '../../../src/shared/types.js'
import {
  buildMatchIndex,
  compareCapabilities,
  matchOfficial,
  searchEntries,
} from '../../../src/server/modelsdev/match.js'
import { modelsDevFixture } from '../../helpers/modelsdev-fixture.js'

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
    reasoningEfforts: ['high', 'max'],
    defaultReasoning: 'high',
    canDisableThinking: true,
    pointMultiplier: '1',
    pointMultipliers: [{ accountId: 'account-1', value: '1' }],
    priority: 0,
    source: 'merged',
    available: true,
    availableAccountIds: ['account-1'],
    ...overrides,
  }
}

const index = buildMatchIndex(modelsDevFixture.models)

describe('models.dev matching', () => {
  it('matches GLM-5.2 to the first-party Zhipu offer and keeps alternatives', () => {
    const official = matchOfficial(model(), index)
    expect(official?.key).toBe('zhipuai/glm-5.2')
    expect(official?.confidence).toBe('exact')
    expect(official?.cost?.input).toBeCloseTo(1.19516)
    expect(official?.alternatives.map(item => item.key)).toContain('zai/glm-5.2')
    expect(official?.contextMismatch).toBe(false)
  })

  it('matches DeepSeek to the lab offer instead of a regional reseller', () => {
    const official = matchOfficial(model({
      slug: 'xopdeepseekv41',
      name: 'DeepSeek-V4.1-Flash',
      directoryId: '',
      contextWindow: 1_048_576,
      maxOutputTokens: 393_216,
      inputModalities: ['text', 'image'],
    }), index)
    expect(official?.key).toBe('deepseek/deepseek-flash')
    expect(official?.providerId).toBe('deepseek')
    expect(official?.cost?.input).toBeCloseTo(0.15)
  })

  it('matches Kimi to Moonshot and lists the CN offer as an alternative', () => {
    const official = matchOfficial(model({
      slug: 'xopkimik26',
      name: 'Kimi-K2.6',
      directoryId: '',
      contextWindow: 262_144,
      maxOutputTokens: 262_144,
    }), index)
    expect(official?.key).toBe('moonshotai/kimi-k2.6')
    expect(official?.alternatives.map(item => item.key)).toContain('moonshotai-cn/kimi-k2.6')
  })

  it('returns null for Spark, which models.dev does not list', () => {
    const official = matchOfficial(model({
      slug: 'spark-x2.5',
      name: 'Spark-X2.5',
      directoryId: '',
      contextWindow: 262_144,
      maxOutputTokens: 100_000,
    }), index)
    expect(official).toBeUndefined()
  })

  it('honours a manual binding even for a reseller entry', () => {
    const official = matchOfficial(model(), index, 'openrouter/z-ai/glm-5.2')
    expect(official?.key).toBe('openrouter/z-ai/glm-5.2')
    expect(official?.confidence).toBe('manual')
    expect(official?.providerName).toBe('OpenRouter')
  })

  it('compares platform and official capabilities without hiding conflicts', () => {
    const official = matchOfficial(model({
      contextWindow: 128_000,
      inputModalities: ['text'],
      reasoningEfforts: ['high'],
    }), index)
    expect(official).not.toBeUndefined()
    const caps = compareCapabilities(model({
      contextWindow: 128_000,
      inputModalities: ['text'],
      reasoningEfforts: ['high'],
    }), official)
    expect(caps.context.platform).toBe(128_000)
    expect(caps.context.official).toBe(1_000_000)
    expect(caps.context.mismatch).toBe(true)
    expect(caps.reasoning.officialEfforts).toEqual(['high', 'max'])
    expect(caps.features.toolCall).toBe(true)
  })

  it('marks official-only modalities as extra', () => {
    const qwen = model({
      slug: 'xopqwen35',
      name: 'Qwen3.5-397B-A17B',
      directoryId: '',
      contextWindow: 262_144,
      maxOutputTokens: 65_536,
      inputModalities: ['text'],
      reasoningEfforts: [],
    })
    const official = matchOfficial(qwen, index)
    const caps = compareCapabilities(qwen, official)
    expect(caps.inputModalities.extraOfficial).toEqual(['image', 'video'])
    expect(caps.reasoning.officialBudgetTokens).toBe(true)
  })

  it('does not treat a reseller self-canonical entry as an official offer', () => {
    const official = matchOfficial(model({
      slug: 'own-model',
      name: 'Own Model',
      directoryId: '',
      contextWindow: 128_000,
      maxOutputTokens: 8_192,
      inputModalities: ['text'],
      reasoningEfforts: [],
    }), index)
    expect(official).toBeUndefined()
  })

  it('searches offers by model, provider and canonical id', () => {
    const glm = searchEntries(index, 'glm-5.2', 10)
    expect(glm.some(item => item.key === 'zhipuai/glm-5.2')).toBe(true)
    const kimi = searchEntries(index, 'moonshot', 10)
    expect(kimi.some(item => item.key.startsWith('moonshotai/'))).toBe(true)
    expect(searchEntries(index, '', 10)).toHaveLength(0)
  })
})
