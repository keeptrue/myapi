import { join } from 'node:path'
import { MODELS_DEV_RETRY_MS } from '../../shared/constants.js'
import type {
  ModelInfo,
  ModelsDevSearchResult,
  ModelsDevStatus,
  OfficialModelInfo,
  Settings,
} from '../../shared/types.js'
import { ensureDir, readJsonFile, writeFileAtomic } from '../store/atomic.js'
import type { StateStore } from '../store/state.js'
import { logger as rootLogger } from '../logger.js'
import { truncate } from '../util.js'
import { fetchModelsDev } from './client.js'
import {
  buildMatchIndex,
  groupForEntry,
  matchOfficial,
  officialForEntry,
  searchEntries,
  type MatchIndex,
} from './match.js'
import type { ModelsDevSnapshot } from './types.js'

function emptySnapshot(url: string): ModelsDevSnapshot {
  return { version: 1, url, etag: '', fetchedAt: 0, checkedAt: 0, providers: [], models: [] }
}

export interface ModelsDevServiceOptions {
  store: StateStore
  dataDir: string
  fetchImpl?: typeof fetch
  snapshot?: ModelsDevSnapshot
}

/**
 * models.dev reference metadata, kept separate from AStudio's catalog.
 *
 * A failed refresh never clears the last good snapshot; a URL change discards
 * the old snapshot because its prices belong to a different source.
 */
export class ModelsDevService {
  private readonly log = rootLogger.child({ module: 'modelsdev' })
  private snapshot: ModelsDevSnapshot
  private index: MatchIndex = buildMatchIndex([])
  private source: ModelsDevStatus['source'] = 'empty'
  private error = ''
  private refreshing: Promise<void> | undefined
  private nextAttemptAt = 0
  private generation = 0
  private readonly fetchImpl: typeof fetch
  private readonly injectedSnapshot: ModelsDevSnapshot | undefined

  constructor(private readonly options: ModelsDevServiceOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.injectedSnapshot = options.snapshot
    this.snapshot = emptySnapshot(options.store.settings.modelsDevUrl)
  }

  private get path(): string {
    return join(this.options.dataDir, 'modelsdev.json')
  }

  async load(): Promise<void> {
    if (this.injectedSnapshot !== undefined) {
      this.apply(this.injectedSnapshot, 'saved')
      return
    }
    const saved = await readJsonFile<ModelsDevSnapshot>(this.path)
    if (saved === undefined || saved.version !== 1 || !Array.isArray(saved.models)) return
    if (saved.url !== this.options.store.settings.modelsDevUrl) return
    const models = saved.models.filter(entry => typeof entry?.key === 'string' && entry.key !== '')
    const providers = Array.isArray(saved.providers) ? saved.providers : []
    this.apply({
      ...saved,
      etag: typeof saved.etag === 'string' ? saved.etag : '',
      fetchedAt: Number.isFinite(saved.fetchedAt) ? saved.fetchedAt : 0,
      checkedAt: Number.isFinite(saved.checkedAt) ? saved.checkedAt : 0,
      models,
      providers,
    }, models.length > 0 ? 'saved' : 'empty')
  }

  private apply(snapshot: ModelsDevSnapshot, source: ModelsDevStatus['source']): void {
    this.snapshot = snapshot
    this.index = buildMatchIndex(snapshot.models)
    this.source = source
    this.error = ''
    this.nextAttemptAt = 0
  }

  status(): ModelsDevStatus {
    return {
      enabled: this.options.store.settings.modelsDevEnabled,
      source: this.snapshot.models.length === 0 ? 'empty' : this.source,
      fetchedAt: this.snapshot.fetchedAt,
      checkedAt: this.snapshot.checkedAt,
      error: this.options.store.settings.modelsDevEnabled ? this.error : '',
      refreshing: this.refreshing !== undefined,
      providers: this.snapshot.providers.length,
      models: this.snapshot.models.length,
    }
  }

  refresh(): Promise<void> {
    if (this.refreshing !== undefined) return this.refreshing
    const task = this.doRefresh().finally(() => {
      this.refreshing = undefined
    })
    this.refreshing = task
    return task
  }

  private async doRefresh(): Promise<void> {
    const settings = this.options.store.settings
    if (!settings.modelsDevEnabled) return
    const url = settings.modelsDevUrl
    const generation = this.generation
    try {
      const etag = this.snapshot.url === url ? this.snapshot.etag : ''
      const result = await fetchModelsDev(url, etag, this.fetchImpl)
      if (generation !== this.generation) return
      if (result.notModified) {
        this.snapshot = { ...this.snapshot, etag: result.etag, checkedAt: Date.now() }
        this.error = ''
        this.nextAttemptAt = 0
        await this.persist()
        return
      }
      if (result.snapshot !== undefined) {
        this.apply(result.snapshot, 'live')
        await this.persist()
        this.log.info('models.dev refreshed', {
          providers: result.snapshot.providers.length,
          models: result.snapshot.models.length,
        })
      }
    } catch (error: unknown) {
      if (generation !== this.generation) return
      this.error = truncate(error instanceof Error ? error.message : String(error), 300)
      this.nextAttemptAt = Date.now() + MODELS_DEV_RETRY_MS
      this.log.warn('models.dev refresh failed', { error: this.error })
    }
  }

  /** Scheduler hook: refresh only when the snapshot is stale and not backing off. */
  refreshIfStale(): void {
    const settings = this.options.store.settings
    if (!settings.modelsDevEnabled) return
    if (this.refreshing !== undefined) return
    if (Date.now() < this.nextAttemptAt) return
    const hours = settings.modelsDevRefreshHours
    const age = Date.now() - this.snapshot.checkedAt
    if (this.snapshot.checkedAt === 0 || age >= hours * 60 * 60 * 1000) void this.refresh()
  }

  onSettingsChanged(previous: Settings, next: Settings): void {
    if (previous.modelsDevUrl !== next.modelsDevUrl) {
      this.generation += 1
      this.snapshot = emptySnapshot(next.modelsDevUrl)
      this.index = buildMatchIndex([])
      this.source = 'empty'
      this.error = ''
      this.nextAttemptAt = 0
    }
    if (!next.modelsDevEnabled) return
    if (previous.modelsDevUrl !== next.modelsDevUrl || (!previous.modelsDevEnabled && next.modelsDevEnabled)) {
      void this.refresh()
    }
  }

  officialFor(model: ModelInfo): OfficialModelInfo | null {
    if (!this.options.store.settings.modelsDevEnabled || this.snapshot.models.length === 0) return null
    return matchOfficial(model, this.index, this.options.store.modelReferences[model.slug]) ?? null
  }

  resolveKey(key: string): OfficialModelInfo | null {
    const entry = this.index.byKey.get(key)
    if (entry === undefined) return null
    return officialForEntry(entry, groupForEntry(this.index, entry), 'manual', 'manual')
  }

  search(query: string, limit: number): ModelsDevSearchResult[] {
    return searchEntries(this.index, query, limit)
  }

  private async persist(): Promise<void> {
    try {
      await ensureDir(this.options.dataDir)
      await writeFileAtomic(this.path, `${JSON.stringify(this.snapshot)}\n`)
    } catch (error: unknown) {
      this.log.warn('could not persist models.dev snapshot', error)
    }
  }
}
