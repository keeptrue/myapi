import type { OfficialCost, OfficialReasoningOption } from '../../shared/types.js'

/** One model offer after normalization from models.dev's provider map. */
export interface ModelsDevEntry {
  key: string
  providerId: string
  providerName: string
  modelId: string
  name: string
  family: string
  canonicalId: string
  contextWindow: number
  maxInputTokens: number
  maxOutputTokens: number
  inputModalities: string[]
  outputModalities: string[]
  reasoning: boolean
  reasoningOptions: OfficialReasoningOption[]
  toolCall: boolean
  attachment: boolean
  structuredOutput: boolean
  temperature: boolean
  openWeights: boolean
  knowledge: string
  releaseDate: string
  lastUpdated: string
  status: string
  cost?: OfficialCost
}

export interface ModelsDevProvider {
  id: string
  name: string
}

export interface ModelsDevSnapshot {
  version: 1
  url: string
  etag: string
  fetchedAt: number
  checkedAt: number
  providers: ModelsDevProvider[]
  models: ModelsDevEntry[]
}
