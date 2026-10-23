import type { OfficialCost, OfficialCostRates, OfficialCostTier, OfficialReasoningOption } from '../../shared/types.js'
import { booleanField, isRecord, numberField, stringField } from '../util.js'
import type { ModelsDevEntry, ModelsDevProvider, ModelsDevSnapshot } from './types.js'

function optionalNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const seen = new Set<string>()
  for (const item of value) {
    const text = stringField(item).toLowerCase()
    if (text !== '') seen.add(text)
  }
  return [...seen]
}

function parseRates(raw: Record<string, unknown>): OfficialCostRates {
  const rates: OfficialCostRates = {}
  const input = optionalNumber(raw['input'])
  if (input !== undefined) rates.input = input
  const output = optionalNumber(raw['output'])
  if (output !== undefined) rates.output = output
  const cacheRead = optionalNumber(raw['cache_read'])
  if (cacheRead !== undefined) rates.cacheRead = cacheRead
  const cacheWrite = optionalNumber(raw['cache_write'])
  if (cacheWrite !== undefined) rates.cacheWrite = cacheWrite
  const reasoning = optionalNumber(raw['reasoning'])
  if (reasoning !== undefined) rates.reasoning = reasoning
  const inputAudio = optionalNumber(raw['input_audio'])
  if (inputAudio !== undefined) rates.inputAudio = inputAudio
  const outputAudio = optionalNumber(raw['output_audio'])
  if (outputAudio !== undefined) rates.outputAudio = outputAudio
  return rates
}

function hasRates(rates: OfficialCostRates): boolean {
  return Object.keys(rates).length > 0
}

/** Parse models.dev's cost object; all values are USD per 1M tokens. */
export function parseCost(value: unknown): OfficialCost | undefined {
  if (!isRecord(value)) return undefined
  const base = parseRates(value)
  const tiers: OfficialCostTier[] = []
  if (Array.isArray(value['tiers'])) {
    for (const row of value['tiers']) {
      if (!isRecord(row)) continue
      const tier = isRecord(row['tier']) ? row['tier'] : {}
      const threshold = optionalNumber(tier['size'])
      if (threshold === undefined || threshold <= 0) continue
      const rates = parseRates(row)
      tiers.push({ threshold, ...rates })
    }
  }
  let contextOver200k: OfficialCostRates | undefined
  if (isRecord(value['context_over_200k'])) {
    const rates = parseRates(value['context_over_200k'])
    if (hasRates(rates)) contextOver200k = rates
  }
  if (!hasRates(base) && tiers.length === 0 && contextOver200k === undefined) return undefined
  return {
    ...base,
    tiers,
    ...(contextOver200k === undefined ? {} : { contextOver200k }),
  }
}

function parseReasoningOptions(value: unknown): OfficialReasoningOption[] {
  if (!Array.isArray(value)) return []
  const options: OfficialReasoningOption[] = []
  for (const row of value) {
    if (!isRecord(row)) continue
    const type = stringField(row['type'])
    if (type !== 'toggle' && type !== 'effort' && type !== 'budget_tokens') continue
    options.push({
      type,
      values: stringList(row['values']),
      min: numberField(row['min']),
      max: numberField(row['max']),
    })
  }
  return options
}

function normalizeEntry(
  providerId: string,
  providerName: string,
  modelKey: string,
  raw: Record<string, unknown>,
): ModelsDevEntry | undefined {
  const type = stringField(raw['type'])
  if (type !== '' && type !== 'chat') return undefined
  const modalities = isRecord(raw['modalities']) ? raw['modalities'] : {}
  const outputModalities = stringList(modalities['output'])
  if (outputModalities.length > 0 && !outputModalities.includes('text')) return undefined
  const inputModalities = stringList(modalities['input'])
  const modelId = stringField(raw['id']) || modelKey
  if (modelId === '') return undefined
  const limit = isRecord(raw['limit']) ? raw['limit'] : {}
  const name = stringField(raw['name']) || modelId
  const canonicalId = stringField(raw['canonical_model_id']) || `${providerId}/${modelId}`
  const cost = parseCost(raw['cost'])
  return {
    key: `${providerId}/${modelId}`,
    providerId,
    providerName,
    modelId,
    name,
    family: stringField(raw['family']),
    canonicalId,
    contextWindow: numberField(limit['context']),
    maxInputTokens: numberField(limit['input']),
    maxOutputTokens: numberField(limit['output']),
    inputModalities,
    outputModalities: outputModalities.length > 0 ? outputModalities : ['text'],
    reasoning: booleanField(raw['reasoning']),
    reasoningOptions: parseReasoningOptions(raw['reasoning_options']),
    toolCall: booleanField(raw['tool_call']),
    attachment: booleanField(raw['attachment']),
    structuredOutput: booleanField(raw['structured_output']),
    temperature: booleanField(raw['temperature']),
    openWeights: booleanField(raw['open_weights']),
    knowledge: stringField(raw['knowledge']),
    releaseDate: stringField(raw['release_date']),
    lastUpdated: stringField(raw['last_updated']),
    status: stringField(raw['status']),
    ...(cost === undefined ? {} : { cost }),
  }
}

/** Normalize models.dev's provider → models map into a compact snapshot. */
export function normalizeApi(
  raw: unknown,
  url: string,
  now: number,
  etag = '',
): ModelsDevSnapshot {
  const providers: ModelsDevProvider[] = []
  const models: ModelsDevEntry[] = []
  if (!isRecord(raw)) {
    return { version: 1, url, etag, fetchedAt: 0, checkedAt: now, providers, models }
  }
  const root = isRecord(raw['providers']) ? raw['providers'] : raw
  for (const [providerKey, providerRaw] of Object.entries(root)) {
    if (!isRecord(providerRaw)) continue
    const providerId = stringField(providerRaw['id']) || providerKey
    const providerName = stringField(providerRaw['name']) || providerId
    const providerModels = isRecord(providerRaw['models']) ? providerRaw['models'] : {}
    let kept = 0
    for (const [modelKey, modelRaw] of Object.entries(providerModels)) {
      if (!isRecord(modelRaw)) continue
      const entry = normalizeEntry(providerId, providerName, modelKey, modelRaw)
      if (entry === undefined) continue
      models.push(entry)
      kept += 1
    }
    if (kept > 0) providers.push({ id: providerId, name: providerName })
  }
  return { version: 1, url, etag, fetchedAt: now, checkedAt: now, providers, models }
}
