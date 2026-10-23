import { join } from 'node:path'
import type { CatalogSnapshot, ModelInfo, ProbeRecord, ProbeResultView, ProbeSummary } from '../../shared/types.js'
import { ensureDir, readJsonFile, writeFileAtomic } from '../store/atomic.js'
import type { StateStore } from '../store/state.js'
import type { StoredAccount } from '../store/schema.js'
import { logger as rootLogger } from '../logger.js'
import { truncate } from '../util.js'
import type { AccountService } from './accounts.js'
import type { AstronApi, CatalogModel, ModelConfig } from './types.js'

/** Efforts the live gateway is known to refuse even though the roster lists them. */
const REFUSED_EFFORTS: Record<string, readonly string[]> = {
  'spark-x2.5-4b': ['minimal', 'medium', 'max'],
  'spark-x2.6-4b': ['minimal', 'medium', 'max'],
}

const MAPPED_EFFORTS = new Set(['minimal', 'low', 'medium', 'high', 'max', 'xhigh'])

function normalize(value: string): string {
  return value.trim().toLowerCase()
}

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0
}

/** Fill fields introduced after the first catalog snapshots were written. */
function normalizeSavedModel(model: ModelInfo): ModelInfo {
  const pointMultipliers = Array.isArray(model.pointMultipliers)
    ? model.pointMultipliers.filter(item => typeof item?.accountId === 'string' && typeof item?.value === 'string')
    : []
  const primary = typeof model.pointMultiplier === 'string' && model.pointMultiplier !== ''
    ? model.pointMultiplier
    : (pointMultipliers[0]?.value ?? '')
  return {
    ...model,
    description: typeof model.description === 'string' ? model.description : '',
    pointMultiplier: primary,
    pointMultipliers,
  }
}

function probeView(record: ProbeRecord): ProbeResultView {
  return {
    accountId: record.accountId,
    effort: record.effort,
    modality: record.modality === 'image' ? 'image' : 'text',
    effortDeclared: record.effortDeclared ?? true,
    state: record.state,
    validation: record.validation,
    reason: record.reason,
    httpStatus: record.httpStatus ?? 0,
    latencyMs: record.latencyMs ?? 0,
    finishReason: record.finishReason ?? '',
    contentPreview: record.contentPreview ?? '',
    reasoningPreview: record.reasoningPreview ?? '',
    usage: record.usage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 },
    testedAt: record.testedAt,
    expiresAt: record.expiresAt,
  }
}

function fromCatalogModel(raw: CatalogModel): ModelInfo | undefined {
  const slug = raw.slug.trim()
  if (slug === '') return undefined
  if (raw.supportedInApi === false) return undefined
  if (raw.visibility !== '' && raw.visibility !== 'list') return undefined
  const contextWindow = positive(raw.contextWindow)
  const maxOutputTokens = positive(raw.maxOutputTokens)
  if (contextWindow === 0 || maxOutputTokens === 0) return undefined
  const efforts = raw.reasoningEfforts.filter(effort => MAPPED_EFFORTS.has(effort))
  const refused = REFUSED_EFFORTS[slug] ?? []
  const kept = efforts.filter(effort => !refused.includes(effort))
  return {
    slug,
    name: raw.name !== '' ? raw.name : slug,
    description: raw.description,
    directoryId: '',
    provider: '',
    contextWindow,
    maxOutputTokens,
    inputModalities: raw.inputModalities.length > 0 ? raw.inputModalities : ['text'],
    reasoningEfforts: kept,
    defaultReasoning: raw.defaultReasoning,
    canDisableThinking: raw.canDisableThinking,
    pointMultiplier: '',
    pointMultipliers: [],
    priority: raw.priority,
    source: 'model-manager',
    available: true,
    availableAccountIds: [],
  }
}

function fromConfig(config: ModelConfig): ModelInfo | undefined {
  const slug = (config.model || config.id).trim()
  if (slug === '') return undefined
  return {
    slug,
    name: config.name !== '' ? config.name : slug,
    description: '',
    directoryId: config.id,
    provider: config.provider,
    contextWindow: 0,
    maxOutputTokens: 0,
    inputModalities: ['text'],
    reasoningEfforts: [],
    defaultReasoning: '',
    canDisableThinking: false,
    pointMultiplier: config.pointMultiplier,
    pointMultipliers: [],
    priority: 0,
    source: 'bot-configs',
    available: true,
    availableAccountIds: [],
  }
}

/**
 * The live model directory, merged from AStudio's model-manager roster and each
 * account's `bot/models/configs` credential list.
 *
 * The model-manager document carries context windows and reasoning levels; the
 * per-account config carries which models the account can actually call. A
 * model that neither source names is never invented.
 */
export class CatalogService {
  private readonly log = rootLogger.child({ module: 'catalog' })
  private snapshot: CatalogSnapshot = { fetchedAt: 0, source: 'empty', error: '', models: [] }
  private refreshing: Promise<CatalogSnapshot> | undefined

  constructor(
    private readonly store: StateStore,
    private readonly client: AstronApi,
    private readonly accounts: AccountService,
    private readonly dataDir: string,
  ) {}

  private get path(): string {
    return join(this.dataDir, 'catalog.json')
  }

  async load(): Promise<void> {
    await ensureDir(this.dataDir)
    const saved = await readJsonFile<CatalogSnapshot>(this.path)
    if (saved === undefined || !Array.isArray(saved.models)) return
    this.snapshot = {
      fetchedAt: saved.fetchedAt,
      source: saved.models.length === 0 ? 'empty' : 'saved',
      error: saved.error ?? '',
      models: saved.models.map(normalizeSavedModel),
    }
  }

  get current(): CatalogSnapshot {
    return this.snapshot
  }

  get models(): ModelInfo[] {
    return this.snapshot.models
  }

  visibleModels(): ModelInfo[] {
    const hidden = new Set(this.store.hiddenModels)
    return this.snapshot.models.filter(model => !hidden.has(model.slug))
  }

  hidden(): string[] {
    return [...this.store.hiddenModels]
  }

  /** Resolve a client-supplied name through alias, slug, display name and directory id. */
  resolve(name: string): ModelInfo | undefined {
    const key = normalize(name)
    if (key === '') return undefined
    const aliases = this.store.aliases
    const aliasTarget = Object.entries(aliases).find(([alias]) => normalize(alias) === key)?.[1]
    const target = aliasTarget === undefined ? key : normalize(aliasTarget)
    return this.snapshot.models.find(model =>
      normalize(model.slug) === target
      || normalize(model.name) === target
      || normalize(model.directoryId) === target)
  }

  /** All names a model answers to, used by the gateway to resolve aliases. */
  aliasesFor(slug: string): string[] {
    return Object.entries(this.store.aliases)
      .filter(([, target]) => normalize(target) === normalize(slug))
      .map(([alias]) => alias)
  }

  probeSummary(slug: string): ProbeSummary {
    const results = this.store.probesFor(slug)
      .map(probeView)
      .sort((left, right) => right.testedAt - left.testedAt)
      .slice(0, 30)
    const acceptedEfforts = [...new Set(results.filter(item => item.state === 'ok').map(item => item.effort))]
    const rejectedEfforts = [...new Set(results.filter(item => item.state === 'rejected').map(item => item.effort))]
    const first = results[0]
    return {
      slug,
      results,
      ...(first === undefined ? {} : { latest: first }),
      acceptedEfforts,
      rejectedEfforts,
    }
  }

  private async fetchAccount(account: StoredAccount): Promise<{
    models: ModelInfo[]
    configs: ModelConfig[]
    errors: string[]
  }> {
    const errors: string[] = []
    const session = this.accounts.sessionFor(account)
    let models: ModelInfo[] = []
    let configs: ModelConfig[] = []
    if (session.modelBearerToken !== '') {
      try {
        const catalog = await this.client.fetchCatalog(session.modelBearerToken)
        models = catalog.map(fromCatalogModel).filter((model): model is ModelInfo => model !== undefined)
      } catch (error: unknown) {
        errors.push(`catalog[${account.name}]: ${truncate(error instanceof Error ? error.message : String(error), 200)}`)
      }
    }
    if (session.token !== '' || session.ssoSessionId !== '') {
      try {
        const result = await this.client.fetchModelConfigs(session)
        configs = result.configs
      } catch (error: unknown) {
        errors.push(`configs[${account.name}]: ${truncate(error instanceof Error ? error.message : String(error), 200)}`)
      }
    }
    return { models, configs, errors }
  }

  refresh(): Promise<CatalogSnapshot> {
    if (this.refreshing !== undefined) return this.refreshing
    this.refreshing = this.doRefresh().finally(() => {
      this.refreshing = undefined
    })
    return this.refreshing
  }

  private async doRefresh(): Promise<CatalogSnapshot> {
    const accounts = this.store.accounts.filter(account => account.enabled)
    if (accounts.length === 0) {
      this.snapshot = { fetchedAt: Date.now(), source: 'empty', error: '没有可用账号', models: [] }
      await this.persist()
      return this.snapshot
    }

    const results = await Promise.all(accounts.map(async account => ({ account, ...(await this.fetchAccount(account)) })))
    const errors = results.flatMap(result => result.errors)
    const configs = results.flatMap(result => result.configs)

    const bySlug = new Map<string, ModelInfo>()
    for (const result of results) {
      for (const model of result.models) {
        const existing = bySlug.get(normalize(model.slug))
        if (existing === undefined) {
          bySlug.set(normalize(model.slug), model)
        } else {
          existing.source = 'merged'
          if (existing.contextWindow === 0) existing.contextWindow = model.contextWindow
          if (existing.maxOutputTokens === 0) existing.maxOutputTokens = model.maxOutputTokens
          if (existing.reasoningEfforts.length === 0) existing.reasoningEfforts = model.reasoningEfforts
        }
      }
    }

    // Per-account availability from bot/models/configs. Each config answers to
    // its slug, display name and directory id.
    const availability = new Map<string, Set<string>>()
    for (const result of results) {
      const account = result.account
      for (const config of result.configs) {
        for (const key of [config.model, config.id, config.name]) {
          const normalized = normalize(key)
          if (normalized === '') continue
          const set = availability.get(normalized) ?? new Set<string>()
          set.add(account.id)
          availability.set(normalized, set)
        }
        const model = fromConfig(config)
        if (model === undefined) continue
        const key = normalize(model.slug)
        const existing = bySlug.get(key)
        if (existing === undefined) {
          if (config.pointMultiplier !== '') {
            model.pointMultipliers = [{ accountId: account.id, value: config.pointMultiplier }]
          }
          bySlug.set(key, model)
          continue
        }
        existing.source = 'merged'
        if (existing.directoryId === '') existing.directoryId = config.id
        if (existing.provider === '') existing.provider = config.provider
        if (config.pointMultiplier !== '') {
          if (existing.pointMultiplier === '') existing.pointMultiplier = config.pointMultiplier
          if (!existing.pointMultipliers.some(item => item.accountId === account.id)) {
            existing.pointMultipliers.push({ accountId: account.id, value: config.pointMultiplier })
          }
        }
      }
    }

    for (const model of bySlug.values()) {
      const ids = new Set<string>()
      for (const key of [model.slug, model.name, model.directoryId]) {
        const set = availability.get(normalize(key))
        if (set !== undefined) for (const id of set) ids.add(id)
      }
      model.availableAccountIds = [...ids]
      model.available = configs.length === 0 ? true : ids.size > 0
    }

    const models = [...bySlug.values()].sort((left, right) => {
      if (left.available !== right.available) return left.available ? -1 : 1
      if (left.priority !== right.priority) return right.priority - left.priority
      return left.name.localeCompare(right.name)
    })

    if (models.length === 0) {
      if (this.snapshot.models.length > 0) {
        this.snapshot = { ...this.snapshot, error: errors.join('; ') || '目录为空' }
      } else {
        this.snapshot = { fetchedAt: Date.now(), source: 'empty', error: errors.join('; ') || '目录为空', models: [] }
      }
    } else {
      this.snapshot = {
        fetchedAt: Date.now(),
        source: 'live',
        error: errors.join('; '),
        models,
      }
    }
    if (errors.length > 0) this.log.warn('catalog refresh partially failed', { errors: errors.length })
    await this.persist()
    return this.snapshot
  }

  private async persist(): Promise<void> {
    try {
      await ensureDir(this.dataDir)
      await writeFileAtomic(this.path, `${JSON.stringify(this.snapshot, null, 2)}\n`)
    } catch (error: unknown) {
      this.log.warn('could not persist catalog snapshot', error)
    }
  }
}
