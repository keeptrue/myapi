import type { OfficialCost } from '../../src/shared/types.js'
import type { ModelsDevEntry, ModelsDevSnapshot } from '../../src/server/modelsdev/types.js'

type EntryInput = Pick<ModelsDevEntry, 'providerId' | 'providerName' | 'modelId' | 'name'> & {
  family?: string
  canonicalId?: string
  contextWindow?: number
  maxInputTokens?: number
  maxOutputTokens?: number
  inputModalities?: string[]
  outputModalities?: string[]
  reasoning?: boolean
  reasoningOptions?: ModelsDevEntry['reasoningOptions']
  toolCall?: boolean
  attachment?: boolean
  structuredOutput?: boolean
  temperature?: boolean
  openWeights?: boolean
  knowledge?: string
  releaseDate?: string
  lastUpdated?: string
  status?: string
  cost?: OfficialCost
}

function entry(input: EntryInput): ModelsDevEntry {
  return {
    key: `${input.providerId}/${input.modelId}`,
    providerId: input.providerId,
    providerName: input.providerName,
    modelId: input.modelId,
    name: input.name,
    family: input.family ?? '',
    canonicalId: input.canonicalId ?? `${input.providerId}/${input.modelId}`,
    contextWindow: input.contextWindow ?? 0,
    maxInputTokens: input.maxInputTokens ?? 0,
    maxOutputTokens: input.maxOutputTokens ?? 0,
    inputModalities: input.inputModalities ?? ['text'],
    outputModalities: input.outputModalities ?? ['text'],
    reasoning: input.reasoning ?? false,
    reasoningOptions: input.reasoningOptions ?? [],
    toolCall: input.toolCall ?? false,
    attachment: input.attachment ?? false,
    structuredOutput: input.structuredOutput ?? false,
    temperature: input.temperature ?? true,
    openWeights: input.openWeights ?? false,
    knowledge: input.knowledge ?? '',
    releaseDate: input.releaseDate ?? '',
    lastUpdated: input.lastUpdated ?? '',
    status: input.status ?? '',
    ...(input.cost === undefined ? {} : { cost: input.cost }),
  }
}

const glmCost: OfficialCost = {
  input: 1.19516,
  output: 4.18306,
  cacheRead: 0.29879,
  cacheWrite: 0,
  tiers: [{ threshold: 200_000, input: 2.0, output: 6.0 }],
}

export const modelsDevFixture: ModelsDevSnapshot = {
  version: 1,
  url: 'https://models.dev/api.json',
  etag: 'fixture',
  fetchedAt: Date.now(),
  checkedAt: Date.now(),
  providers: [
    { id: 'zhipuai', name: 'Zhipu AI' },
    { id: 'zai', name: 'Z.AI' },
    { id: 'openrouter', name: 'OpenRouter' },
    { id: 'deepseek', name: 'DeepSeek' },
    { id: 'alibaba-cn', name: 'Alibaba (China)' },
    { id: 'moonshotai', name: 'Moonshot AI' },
    { id: 'moonshotai-cn', name: 'Moonshot AI (China)' },
    { id: 'alibaba', name: 'Alibaba' },
    { id: 'volcengine', name: 'Volcengine Ark' },
    { id: 'meta', name: 'Meta' },
    { id: 'anthropic', name: 'Anthropic' },
    { id: 'openai', name: 'OpenAI' },
    { id: 'minimax', name: 'MiniMax' },
    { id: 'xai', name: 'xAI' },
    { id: 'google', name: 'Google' },
    { id: 'aggregator', name: 'Aggregator' },
  ],
  models: [
    entry({
      providerId: 'zhipuai', providerName: 'Zhipu AI', modelId: 'glm-5.2', name: 'GLM-5.2',
      family: 'glm', canonicalId: 'zhipuai/glm-5.2', contextWindow: 1_000_000, maxOutputTokens: 131_072,
      reasoning: true, reasoningOptions: [{ type: 'toggle', values: [], min: 0, max: 0 }, { type: 'effort', values: ['high', 'max'], min: 0, max: 0 }],
      toolCall: true, structuredOutput: true, openWeights: true, knowledge: '2025-06', releaseDate: '2026-06-13', lastUpdated: '2026-06-13',
      cost: glmCost,
    }),
    entry({
      providerId: 'zai', providerName: 'Z.AI', modelId: 'glm-5.2', name: 'GLM-5.2',
      family: 'glm', canonicalId: 'zhipuai/glm-5.2', contextWindow: 1_000_000, maxOutputTokens: 131_072,
      reasoning: true, cost: { input: 1.4, output: 4.4, cacheRead: 0.26, cacheWrite: 0, tiers: [] },
    }),
    entry({
      providerId: 'openrouter', providerName: 'OpenRouter', modelId: 'z-ai/glm-5.2', name: 'GLM-5.2',
      family: 'glm', canonicalId: 'zhipuai/glm-5.2', contextWindow: 1_000_000, maxOutputTokens: 131_072,
      cost: { input: 2, output: 5, tiers: [] },
    }),
    entry({
      providerId: 'deepseek', providerName: 'DeepSeek', modelId: 'deepseek-flash', name: 'DeepSeek V4.1 Flash 1017',
      family: 'deepseek', canonicalId: 'deepseek/deepseek-v4.1-flash-1017', contextWindow: 1_048_576, maxOutputTokens: 393_216,
      inputModalities: ['text', 'image'], reasoning: true,
      reasoningOptions: [{ type: 'toggle', values: [], min: 0, max: 0 }, { type: 'effort', values: ['low', 'high', 'max'], min: 0, max: 0 }],
      cost: { input: 0.15, output: 0.6, reasoning: 0.6, cacheRead: 0.003, tiers: [] },
    }),
    entry({
      providerId: 'alibaba-cn', providerName: 'Alibaba (China)', modelId: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash',
      family: 'deepseek', canonicalId: 'alibaba-cn/deepseek-v4.1-flash', contextWindow: 1_048_576, maxOutputTokens: 393_216,
      inputModalities: ['text', 'image'], cost: { input: 0.29754, output: 1.19015, tiers: [] },
    }),
    entry({
      providerId: 'moonshotai', providerName: 'Moonshot AI', modelId: 'kimi-k2.6', name: 'Kimi K2.6',
      family: 'kimi-k2', canonicalId: 'moonshotai/kimi-k2.6', contextWindow: 262_144, maxOutputTokens: 262_144,
      inputModalities: ['text', 'image', 'video'], reasoning: true,
      reasoningOptions: [{ type: 'toggle', values: [], min: 0, max: 0 }],
      toolCall: true, structuredOutput: true, cost: { input: 0.95, output: 4, cacheRead: 0.16, tiers: [] },
    }),
    entry({
      providerId: 'moonshotai-cn', providerName: 'Moonshot AI (China)', modelId: 'kimi-k2.6', name: 'Kimi K2.6',
      family: 'kimi-k2', canonicalId: 'moonshotai/kimi-k2.6', contextWindow: 262_144, maxOutputTokens: 262_144,
      inputModalities: ['text', 'image', 'video'], cost: { input: 0.9711, output: 4.0337, tiers: [] },
    }),
    entry({
      providerId: 'alibaba', providerName: 'Alibaba', modelId: 'qwen3.5-397b-a17b', name: 'Qwen3.5 397B-A17B',
      family: 'qwen', canonicalId: 'alibaba/qwen3.5-397b-a17b', contextWindow: 262_144, maxOutputTokens: 65_536,
      inputModalities: ['text', 'image', 'video'], reasoning: true,
      reasoningOptions: [{ type: 'budget_tokens', values: [], min: 0, max: 81_920 }],
      cost: { input: 0.6, output: 3.6, tiers: [] },
    }),
    entry({
      providerId: 'volcengine', providerName: 'Volcengine Ark', modelId: 'doubao-seed-2-0-pro-260215', name: 'Seed 2.0 Pro',
      family: 'seed', canonicalId: 'bytedance-seed/seed-2.0-pro', contextWindow: 256_000, maxOutputTokens: 128_000,
      inputModalities: ['text', 'image', 'video'], reasoning: true,
      reasoningOptions: [{ type: 'effort', values: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'], min: 0, max: 0 }],
      cost: { input: 0.47499, output: 2.37494, tiers: [] },
    }),
    entry({
      providerId: 'meta', providerName: 'Meta', modelId: 'muse-spark-1.2', name: 'Muse Spark 1.2',
      family: 'muse-spark', canonicalId: 'meta/muse-spark-1.2', contextWindow: 1_048_576, maxOutputTokens: 131_072,
      cost: { input: 1.25, output: 4.25, tiers: [] },
    }),
    entry({
      providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6',
      family: 'claude-sonnet', canonicalId: 'anthropic/claude-sonnet-4-6', contextWindow: 1_000_000, maxOutputTokens: 128_000,
      inputModalities: ['text', 'image', 'pdf'], reasoning: true,
      reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high', 'max'], min: 0, max: 0 }],
      cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75, tiers: [] },
    }),
    entry({
      providerId: 'openai', providerName: 'OpenAI', modelId: 'gpt-5.6', name: 'GPT-5.6',
      family: 'gpt', canonicalId: 'openai/gpt-5.6-sol', contextWindow: 1_050_000, maxOutputTokens: 128_000,
      inputModalities: ['text', 'image', 'pdf'], reasoning: true,
      reasoningOptions: [{ type: 'effort', values: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], min: 0, max: 0 }],
      cost: { input: 4, output: 20, cacheRead: 0.4, cacheWrite: 5, tiers: [] },
    }),
    entry({
      providerId: 'minimax', providerName: 'MiniMax', modelId: 'MiniMax-M2.7', name: 'MiniMax-M2.7',
      family: 'minimax', canonicalId: 'minimax/MiniMax-M2.7', contextWindow: 204_800, maxOutputTokens: 131_072,
      inputModalities: ['text'], cost: { input: 0.3, output: 1.2, cacheRead: 0.06, tiers: [] },
    }),
    entry({
      providerId: 'xai', providerName: 'xAI', modelId: 'grok-4.7', name: 'Grok 4.7',
      family: 'grok', canonicalId: 'xai/grok-4.7', contextWindow: 500_000, maxOutputTokens: 500_000,
      inputModalities: ['text', 'image', 'pdf'], reasoning: true,
      reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high', 'xhigh'], min: 0, max: 0 }],
      cost: { input: 2, output: 6, cacheRead: 0.5, tiers: [] },
    }),
    entry({
      providerId: 'aggregator', providerName: 'Aggregator', modelId: 'own-model', name: 'Own Model',
      family: 'own', canonicalId: 'aggregator/own-model', contextWindow: 128_000, maxOutputTokens: 8_192,
      cost: { input: 1, output: 2, tiers: [] },
    }),
    entry({
      providerId: 'google', providerName: 'Google', modelId: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash',
      family: 'gemini', canonicalId: 'google/gemini-3.6-flash', contextWindow: 1_048_576, maxOutputTokens: 65_536,
      inputModalities: ['text', 'image', 'video', 'audio', 'pdf'], reasoning: true,
      reasoningOptions: [{ type: 'effort', values: ['low', 'medium', 'high'], min: 0, max: 0 }],
      cost: { input: 0.75, output: 3.75, cacheRead: 0.075, tiers: [] },
    }),
  ],
}
