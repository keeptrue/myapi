import type {
  ModelCapabilities,
  ModelInfo,
  ModelsDevSearchResult,
  OfficialModelInfo,
  OfficialOffer,
} from '../../shared/types.js'
import type { ModelsDevEntry } from './types.js'

/** First-party providers whose prices count as "official" reference prices. */
const OFFICIAL_PROVIDERS = new Set([
  'openai',
  'anthropic',
  'google',
  'deepseek',
  'moonshotai',
  'moonshotai-cn',
  'zhipuai',
  'zai',
  'minimax',
  'minimax-cn',
  'alibaba',
  'alibaba-cn',
  'volcengine',
  'xai',
  'mistral',
  'meta',
  'stepfun-ai',
  'stepfun',
  'sensenova',
  'inclusionai',
  'longcat',
  'xiaomi',
  'cohere',
  'ai21',
  'liquid',
  'arcee',
  'nvidia',
])

const VENDOR_TOKENS = new Set([
  'xop',
  'lm',
  'astron',
  'maas',
  'zhipu',
  'zhipuai',
  'zai',
  'moonshot',
  'moonshotai',
  'alibaba',
  'qwen',
  'bytedance',
  'volcengine',
  'doubao',
  'iflytek',
  'xfyun',
  'openai',
  'anthropic',
  'google',
  'xai',
  'meta',
  'stepfun',
  'sensenova',
])

const IDENTITY_VENDOR_PREFIXES = new Set([
  'doubao',
  'moonshot',
  'moonshotai',
  'zhipu',
  'zhipuai',
  'alibaba',
  'bytedance',
  'volcengine',
  'openai',
  'anthropic',
  'google',
  'xai',
  'meta',
  'nvidia',
  'stepfun',
  'sensenova',
])

const LAB_PREFERENCES: Record<string, readonly string[]> = {
  glm: ['zhipuai', 'zai'],
  qwen: ['alibaba', 'alibaba-cn'],
  kimi: ['moonshotai', 'moonshotai-cn'],
  deepseek: ['deepseek'],
  seed: ['volcengine'],
  minimax: ['minimax', 'minimax-cn'],
  gpt: ['openai'],
  claude: ['anthropic'],
  gemini: ['google'],
  grok: ['xai'],
  step: ['stepfun-ai', 'stepfun'],
  muse: ['meta'],
  llama: ['meta'],
  mistral: ['mistral'],
  cohere: ['cohere'],
}

const FAMILY_ALIASES: Record<string, readonly string[]> = {
  doubao: ['doubao', 'seed'],
  seed: ['seed', 'doubao'],
  kimi: ['kimi', 'moonshot'],
  moonshot: ['moonshot', 'kimi'],
  glm: ['glm', 'zhipu'],
  zhipu: ['zhipu', 'glm'],
  zhipuai: ['zhipu', 'glm'],
  zai: ['zai', 'glm'],
  qwen: ['qwen', 'alibaba'],
  qwen3: ['qwen', 'alibaba'],
  alibaba: ['alibaba', 'qwen'],
  deepseek: ['deepseek'],
  minimax: ['minimax'],
  gpt: ['gpt', 'openai'],
  openai: ['openai', 'gpt'],
  claude: ['claude', 'anthropic'],
  anthropic: ['anthropic', 'claude'],
  gemini: ['gemini', 'google'],
  google: ['google', 'gemini'],
  grok: ['grok', 'xai'],
  xai: ['xai', 'grok'],
  step: ['step', 'stepfun'],
  stepfun: ['stepfun', 'step'],
}

export interface MatchIndex {
  entries: ModelsDevEntry[]
  byKey: Map<string, ModelsDevEntry>
  byNormalized: Map<string, ModelsDevEntry[]>
  byFamily: Map<string, ModelsDevEntry[]>
}

export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[._/\\:]+/gu, '-')
    .replace(/[^a-z0-9-]+/gu, '-')
    .replace(/-+/gu, '-')
    .replace(/^-+|-+$/gu, '')
}

export function stripDateSuffix(value: string): string {
  return value.replace(/-\d{4,8}$/u, '')
}

export function candidateVariants(value: string): string[] {
  const base = stripDateSuffix(normalizeName(value))
  if (base === '') return []
  const stripped = base.replace(/^(xop|lm|astron|maas)-?/u, '')
  return [...new Set([base, stripped])].filter(item => item !== '')
}

function entryKeys(entry: ModelsDevEntry): string[] {
  const keys = new Set<string>()
  const values = [entry.modelId, entry.name]
  if (entry.canonicalId.includes('/')) values.push(entry.canonicalId.split('/').pop() ?? '')
  for (const value of values) {
    const normalized = stripDateSuffix(normalizeName(value))
    if (normalized !== '') keys.add(normalized)
    if (value.includes('/')) {
      const tail = stripDateSuffix(normalizeName(value.split('/').pop() ?? ''))
      if (tail !== '') keys.add(tail)
    }
  }
  return [...keys]
}

function firstToken(value: string): string {
  const normalized = normalizeName(value)
  return normalized.split('-')[0] ?? ''
}

function familyKeys(entry: ModelsDevEntry): string[] {
  const keys = new Set<string>()
  const family = normalizeName(entry.family)
  if (family !== '') keys.add(family)
  const nameToken = firstToken(entry.name)
  if (nameToken !== '') keys.add(nameToken)
  const idToken = firstToken(entry.modelId.split('/').pop() ?? '')
  if (idToken !== '') keys.add(idToken)
  return [...keys]
}

function addIndex(map: Map<string, ModelsDevEntry[]>, key: string, entry: ModelsDevEntry): void {
  if (key === '') return
  const list = map.get(key)
  if (list === undefined) map.set(key, [entry])
  else if (!list.includes(entry)) list.push(entry)
}

export function buildMatchIndex(entries: ModelsDevEntry[]): MatchIndex {
  const byKey = new Map<string, ModelsDevEntry>()
  const byNormalized = new Map<string, ModelsDevEntry[]>()
  const byFamily = new Map<string, ModelsDevEntry[]>()
  for (const entry of entries) {
    byKey.set(entry.key, entry)
    for (const key of entryKeys(entry)) addIndex(byNormalized, key, entry)
    for (const key of familyKeys(entry)) addIndex(byFamily, key, entry)
  }
  return { entries, byKey, byNormalized, byFamily }
}

function modelVariants(model: ModelInfo): string[] {
  return [...new Set([
    ...candidateVariants(model.name),
    ...candidateVariants(model.slug),
    ...candidateVariants(model.directoryId),
  ])]
}

function modelFamilies(model: ModelInfo): string[] {
  const tokens = new Set<string>()
  for (const value of [model.name, model.slug, model.directoryId]) {
    const token = firstToken(value)
    if (token !== '') tokens.add(token)
  }
  const families = new Set<string>()
  for (const token of tokens) {
    families.add(token)
    for (const alias of FAMILY_ALIASES[token] ?? []) families.add(alias)
  }
  return [...families]
}

function contextCompatible(left: number, right: number): boolean {
  if (left <= 0 || right <= 0) return true
  const ratio = left / right
  return ratio >= 0.67 && ratio <= 1.5
}

const SAFE_PREFIX_TOKENS = new Set(['global', 'eu', 'us', 'cn', 'default', 'latest'])

function prefixScore(candidate: string, target: string): number {
  if (candidate.length < 6 || target.length < 6) return 0
  if (target.startsWith(`${candidate}-`)) {
    const extra = target.slice(candidate.length + 1).split('-').filter(Boolean)
    return extra.length > 0 && extra.every(token => /^\d{4,8}$/u.test(token) || SAFE_PREFIX_TOKENS.has(token)) ? 90 : 0
  }
  if (candidate.startsWith(`${target}-`)) {
    const extra = candidate.slice(target.length + 1).split('-').filter(Boolean)
    return extra.length > 0 && extra.every(token => /^\d{4,8}$/u.test(token) || VENDOR_TOKENS.has(token)) ? 90 : 0
  }
  return 0
}

function tokenSubset(candidate: string, target: string): number {
  const candidateTokens = candidate.split('-').filter(Boolean)
  const targetTokens = target.split('-').filter(Boolean)
  if (targetTokens.length < 2 || candidateTokens.length <= targetTokens.length) return 0
  const candidateSet = new Set(candidateTokens)
  for (const token of targetTokens) if (!candidateSet.has(token)) return 0
  const extras = candidateTokens.filter(token => !targetTokens.includes(token))
  if (extras.length === 0 || !extras.every(token => VENDOR_TOKENS.has(token))) return 0
  return 80
}

function matchesLoose(variants: string[], entry: ModelsDevEntry): boolean {
  for (const variant of variants) {
    for (const key of entryKeys(entry)) {
      if (variant === key || prefixScore(variant, key) > 0 || tokenSubset(variant, key) > 0) return true
    }
  }
  return false
}

export function entryNameKeys(entry: ModelsDevEntry): string[] {
  const name = stripDateSuffix(normalizeName(entry.name))
  return name === '' ? [] : [name]
}

function entryIdKeys(entry: ModelsDevEntry): string[] {
  const keys = new Set<string>()
  const values = [entry.modelId]
  if (entry.canonicalId.includes('/')) values.push(entry.canonicalId.split('/').pop() ?? '')
  for (const value of values) {
    const normalized = stripDateSuffix(normalizeName(value))
    if (normalized !== '') keys.add(normalized)
    if (value.includes('/')) {
      const tail = stripDateSuffix(normalizeName(value.split('/').pop() ?? ''))
      if (tail !== '') keys.add(tail)
    }
  }
  return [...keys]
}

function scoreKeys(variants: string[], keys: string[], exact: number, prefix: number, subset: number): number {
  let best = 0
  for (const variant of variants) {
    for (const key of keys) {
      if (variant === key) best = Math.max(best, exact)
      else if (prefixScore(variant, key) > 0) best = Math.max(best, prefix)
      else if (tokenSubset(variant, key) > 0) best = Math.max(best, subset)
    }
  }
  return best
}

export function scoreCandidate(model: ModelInfo, entry: ModelsDevEntry): number {
  const variants = modelVariants(model)
  // Display-name matches outrank ID-only matches: resellers often reuse the
  // same model ID behind a qualified display name (Moonshot Kimi, Stealth…).
  let best = Math.max(
    scoreKeys(variants, entryNameKeys(entry), 100, 88, 78),
    scoreKeys(variants, entryIdKeys(entry), 92, 86, 76),
  )
  if (best === 0) return 0
  if (contextCompatible(model.contextWindow, entry.contextWindow)) best += 5
  if (isOfficialEntry(entry)) best += 3
  return best
}

export function collectExactCandidates(model: ModelInfo, index: MatchIndex): ModelsDevEntry[] {
  const variants = modelVariants(model)
  const found = new Set<ModelsDevEntry>()
  for (const variant of variants) {
    const list = index.byNormalized.get(variant)
    if (list !== undefined) for (const entry of list) found.add(entry)
  }
  if (found.size > 0) return [...found]

  const families = modelFamilies(model)
  for (const family of families) {
    const list = index.byFamily.get(family)
    if (list !== undefined) for (const entry of list) if (matchesLoose(variants, entry)) found.add(entry)
  }
  for (const [key, list] of index.byFamily) {
    if (!families.some(family => key.startsWith(family) || family.startsWith(key))) continue
    for (const entry of list) if (matchesLoose(variants, entry)) found.add(entry)
  }
  return [...found]
}

function bigrams(value: string): Set<string> {
  const result = new Set<string>()
  for (let index = 0; index < value.length - 1; index += 1) result.add(value.slice(index, index + 2))
  return result
}

function diceCoefficient(left: string, right: string): number {
  if (left === right) return 1
  const leftPairs = bigrams(left)
  const rightPairs = bigrams(right)
  if (leftPairs.size === 0 || rightPairs.size === 0) return 0
  let overlap = 0
  for (const pair of leftPairs) if (rightPairs.has(pair)) overlap += 1
  return (2 * overlap) / (leftPairs.size + rightPairs.size)
}

function jaccard(left: string, right: string): number {
  const leftTokens = new Set(left.split('-').filter(Boolean))
  const rightTokens = new Set(right.split('-').filter(Boolean))
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0
  let intersection = 0
  for (const token of leftTokens) if (rightTokens.has(token)) intersection += 1
  return intersection / new Set([...leftTokens, ...rightTokens]).size
}

function fuzzyTextScore(candidate: string, target: string): number {
  return diceCoefficient(candidate, target) * 0.6 + jaccard(candidate, target) * 0.4
}

function fuzzyScoreCandidate(model: ModelInfo, entry: ModelsDevEntry): number {
  if (!contextCompatible(model.contextWindow, entry.contextWindow)) return 0
  const variants = modelVariants(model)
  let best = 0
  for (const variant of variants) {
    for (const key of entryKeys(entry)) best = Math.max(best, fuzzyTextScore(variant, key))
  }
  if (best === 0) return 0
  return best + (isOfficialEntry(entry) ? 0.02 : 0)
}

function collectFuzzyCandidates(model: ModelInfo, index: MatchIndex): ModelsDevEntry[] {
  const families = modelFamilies(model)
  const candidates = new Set<ModelsDevEntry>()
  for (const [key, list] of index.byFamily) {
    if (!families.some(family => key.startsWith(family) || family.startsWith(key))) continue
    for (const entry of list) {
      if (fuzzyScoreCandidate(model, entry) >= 0.82) candidates.add(entry)
    }
  }
  return [...candidates]
}

/**
 * Group offers that name the same model. Canonical IDs drift between providers
 * (for example deepseek-v4-flash vs deepseek-v4.1-flash-1017), so the display
 * name is the stable identity; canonical ID is only the fallback.
 */
export function identityKey(entry: ModelsDevEntry): string {
  const name = stripDateSuffix(normalizeName(entry.name))
  if (name === '') return entry.canonicalId || entry.key
  const tokens = name.split('-').filter(Boolean)
  while (tokens.length > 2 && IDENTITY_VENDOR_PREFIXES.has(tokens[0] ?? '')) tokens.shift()
  return tokens.join('-') || name
}

function preferredProviders(entry: ModelsDevEntry): string[] {
  const providers = new Set<string>()
  const tokens = new Set<string>()
  const family = normalizeName(entry.family)
  if (family !== '') tokens.add(family.split('-')[0] ?? '')
  const nameToken = firstToken(entry.name)
  if (nameToken !== '') tokens.add(nameToken)
  const idToken = firstToken(entry.modelId.split('/').pop() ?? '')
  if (idToken !== '') tokens.add(idToken)
  for (const token of tokens) {
    for (const provider of LAB_PREFERENCES[token] ?? []) providers.add(provider)
  }
  return [...providers]
}

function groupByIdentity(entries: ModelsDevEntry[]): Map<string, ModelsDevEntry[]> {
  const groups = new Map<string, ModelsDevEntry[]>()
  for (const entry of entries) {
    const key = identityKey(entry)
    const list = groups.get(key)
    if (list === undefined) groups.set(key, [entry])
    else list.push(entry)
  }
  return groups
}

export function groupForEntry(index: MatchIndex, entry: ModelsDevEntry): ModelsDevEntry[] {
  return index.entries.filter(item => identityKey(item) === identityKey(entry))
}

function isOfficialEntry(entry: ModelsDevEntry): boolean {
  return OFFICIAL_PROVIDERS.has(entry.providerId)
}

export function officialScore(entry: ModelsDevEntry, contextWindow: number): number {
  const firstParty = OFFICIAL_PROVIDERS.has(entry.providerId)
  let score = 0
  if (firstParty) {
    score += 80
    // A canonical self-reference only counts for a known lab. Resellers can
    // also set canonical_model_id to their own key, which must not look official.
    if (entry.canonicalId.startsWith(`${entry.providerId}/`)) score += 100
  }
  if (preferredProviders(entry).includes(entry.providerId)) score += 40
  if (entry.cost !== undefined) score += 20
  if (contextWindow > 0 && entry.contextWindow > 0) {
    const ratio = entry.contextWindow / contextWindow
    if (ratio >= 0.8 && ratio <= 1.25) score += 10
  }
  return score
}

export function pickOfficial(group: ModelsDevEntry[], contextWindow: number): ModelsDevEntry | undefined {
  const ranked = [...group].sort((left, right) => {
    const delta = officialScore(right, contextWindow) - officialScore(left, contextWindow)
    if (delta !== 0) return delta
    return left.providerId.localeCompare(right.providerId)
  })
  const top = ranked[0]
  if (top === undefined || officialScore(top, contextWindow) < 80) return undefined
  return top
}

function toOffer(entry: ModelsDevEntry): OfficialOffer {
  return {
    key: entry.key,
    providerId: entry.providerId,
    providerName: entry.providerName,
    modelId: entry.modelId,
    name: entry.name,
    contextWindow: entry.contextWindow,
    maxOutputTokens: entry.maxOutputTokens,
    ...(entry.cost === undefined ? {} : { cost: entry.cost }),
  }
}

function contextMismatch(left: number, right: number): boolean {
  if (left <= 0 || right <= 0) return false
  return Math.abs(left - right) > Math.max(1024, Math.max(left, right) * 0.1)
}

export function officialForEntry(
  entry: ModelsDevEntry,
  group: ModelsDevEntry[],
  confidence: OfficialModelInfo['confidence'],
  matchedBy: string,
  model?: ModelInfo,
): OfficialModelInfo {
  const contextWindow = model?.contextWindow ?? 0
  const alternatives = group
    .filter(item => item.key !== entry.key && isOfficialEntry(item))
    .sort((left, right) => officialScore(right, contextWindow) - officialScore(left, contextWindow))
    .slice(0, 3)
    .map(toOffer)
  return {
    ...toOffer(entry),
    canonicalId: entry.canonicalId,
    family: entry.family,
    maxInputTokens: entry.maxInputTokens,
    inputModalities: entry.inputModalities,
    outputModalities: entry.outputModalities,
    reasoning: entry.reasoning,
    reasoningOptions: entry.reasoningOptions,
    toolCall: entry.toolCall,
    attachment: entry.attachment,
    structuredOutput: entry.structuredOutput,
    temperature: entry.temperature,
    openWeights: entry.openWeights,
    knowledge: entry.knowledge,
    releaseDate: entry.releaseDate,
    lastUpdated: entry.lastUpdated,
    status: entry.status,
    confidence,
    matchedBy,
    contextMismatch: model !== undefined && contextMismatch(model.contextWindow, entry.contextWindow),
    alternatives,
  }
}

export function bestExactGroup(model: ModelInfo, entries: ModelsDevEntry[]): ModelsDevEntry[] | undefined {
  const scored = [...groupByIdentity(entries)].map(([key, group]) => ({
    key,
    group,
    score: Math.max(...group.map(entry => scoreCandidate(model, entry))),
  })).sort((left, right) => right.score - left.score)
  const top = scored[0]
  const second = scored[1]
  if (top === undefined || top.score < 80) return undefined
  if (second !== undefined && top.score - second.score < 3) return undefined
  return top.group
}

function bestFuzzyGroup(model: ModelInfo, entries: ModelsDevEntry[]): ModelsDevEntry[] | undefined {
  const scored = [...groupByIdentity(entries)].map(([key, group]) => ({
    key,
    group,
    score: Math.max(...group.map(entry => fuzzyScoreCandidate(model, entry))),
  })).sort((left, right) => right.score - left.score)
  const top = scored[0]
  const second = scored[1]
  if (top === undefined || top.score < 0.86) return undefined
  if (second !== undefined && top.score - second.score < 0.05) return undefined
  return top.group
}

/** Match one AStudio model to a models.dev offer, or undefined when ambiguous/absent. */
export function matchOfficial(
  model: ModelInfo,
  index: MatchIndex,
  manualKey?: string,
): OfficialModelInfo | undefined {
  if (manualKey !== undefined && manualKey !== '') {
    const entry = index.byKey.get(manualKey)
    if (entry === undefined) return undefined
    return officialForEntry(entry, groupForEntry(index, entry), 'manual', 'manual', model)
  }

  const exact = collectExactCandidates(model, index)
  if (exact.length > 0) {
    const group = bestExactGroup(model, exact)
    if (group !== undefined) {
      const official = pickOfficial(group, model.contextWindow)
      if (official !== undefined) {
        return officialForEntry(official, group, 'exact', `name/id:${entryKeys(official)[0] ?? official.key}`, model)
      }
    }
  }

  const fuzzy = collectFuzzyCandidates(model, index)
  if (fuzzy.length === 0) return undefined
  const group = bestFuzzyGroup(model, fuzzy)
  if (group === undefined) return undefined
  const official = pickOfficial(group, model.contextWindow)
  if (official === undefined) return undefined
  return officialForEntry(official, group, 'fuzzy', `fuzzy:${entryKeys(official)[0] ?? official.key}`, model)
}

function toSearchResult(entry: ModelsDevEntry): ModelsDevSearchResult {
  return {
    key: entry.key,
    providerId: entry.providerId,
    providerName: entry.providerName,
    modelId: entry.modelId,
    name: entry.name,
    canonicalId: entry.canonicalId,
    contextWindow: entry.contextWindow,
    maxInputTokens: entry.maxInputTokens,
    maxOutputTokens: entry.maxOutputTokens,
    inputModalities: entry.inputModalities,
    outputModalities: entry.outputModalities,
    reasoning: entry.reasoning,
    ...(entry.cost === undefined ? {} : { cost: entry.cost }),
  }
}

export function searchEntries(index: MatchIndex, query: string, limit: number): ModelsDevSearchResult[] {
  const normalized = normalizeName(query)
  if (normalized === '') return []
  const scored: Array<{ entry: ModelsDevEntry; score: number }> = []
  for (const entry of index.entries) {
    const id = normalizeName(entry.modelId)
    const name = normalizeName(entry.name)
    const canonical = normalizeName(entry.canonicalId)
    const provider = normalizeName(entry.providerName)
    let score = 0
    if (id === normalized || name === normalized) score = 100
    else if (id.startsWith(normalized) || name.startsWith(normalized)) score = 80
    else if (id.includes(normalized) || name.includes(normalized)) score = 60
    else if (canonical.includes(normalized)) score = 50
    else if (provider.includes(normalized)) score = 40
    if (score === 0) continue
    if (isOfficialEntry(entry)) score += 5
    scored.push({ entry, score })
  }
  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score
    const leftOfficial = isOfficialEntry(left.entry) ? 0 : 1
    const rightOfficial = isOfficialEntry(right.entry) ? 0 : 1
    if (leftOfficial !== rightOfficial) return leftOfficial - rightOfficial
    return left.entry.name.localeCompare(right.entry.name)
  })
  return scored.slice(0, limit).map(item => toSearchResult(item.entry))
}

function modalityList(value: string[]): string[] {
  const seen = new Set<string>()
  for (const item of value) {
    const text = item.trim().toLowerCase()
    if (text !== '') seen.add(text)
  }
  return [...seen]
}

function sizeMismatch(left: number, right: number): boolean {
  if (left <= 0 || right <= 0) return false
  return Math.abs(left - right) > Math.max(1024, Math.max(left, right) * 0.1)
}

/** Compare AStudio's effective catalog values with models.dev's reference values. */
export function compareCapabilities(model: ModelInfo, official: OfficialModelInfo | null | undefined): ModelCapabilities {
  const platformModalities = modalityList(model.inputModalities.length > 0 ? model.inputModalities : ['text'])
  const officialModalities = modalityList(official?.inputModalities ?? [])
  const officialReasoning = official?.reasoningOptions ?? []
  const officialEfforts = [...new Set(officialReasoning
    .filter(option => option.type === 'effort')
    .flatMap(option => option.values))]
  return {
    context: {
      platform: model.contextWindow,
      official: official?.contextWindow ?? 0,
      mismatch: official !== null && official !== undefined && sizeMismatch(model.contextWindow, official.contextWindow),
    },
    output: {
      platform: model.maxOutputTokens,
      official: official?.maxOutputTokens ?? 0,
      mismatch: official !== null && official !== undefined && sizeMismatch(model.maxOutputTokens, official.maxOutputTokens),
    },
    inputModalities: {
      platform: platformModalities,
      official: officialModalities,
      extraOfficial: officialModalities.filter(item => !platformModalities.includes(item)),
      effective: platformModalities,
    },
    outputModalities: {
      official: modalityList(official?.outputModalities ?? []),
    },
    reasoning: {
      platformEfforts: model.reasoningEfforts,
      defaultEffort: model.defaultReasoning,
      canDisableThinking: model.canDisableThinking,
      official: official?.reasoning ?? false,
      officialEfforts,
      officialToggle: officialReasoning.some(option => option.type === 'toggle'),
      officialBudgetTokens: officialReasoning.some(option => option.type === 'budget_tokens'),
    },
    features: {
      toolCall: official?.toolCall ?? false,
      attachment: official?.attachment ?? false,
      structuredOutput: official?.structuredOutput ?? false,
      temperature: official?.temperature ?? false,
      openWeights: official?.openWeights ?? false,
    },
  }
}
