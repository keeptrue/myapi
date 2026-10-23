import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ModelRecord } from '../../shared/providers.js'

/** One model name, with every provider that can serve it. Same-named models are kept, never dropped. */
export interface MergedModel {
  name: string
  providers: ModelRecord[]
  hidden: boolean
}

interface SnapshotFile {
  fetchedAt: number
  source: 'live' | 'saved' | 'empty'
  error: string
  records: ModelRecord[]
}

/**
 * The gateway-level model catalog.
 *
 * Adapters report flat `ModelRecord[]` lists; this class merges them by normalised name so a
 * model offered by two providers shows up once, with both providers listed. Model names carry
 * no provider prefix — the API key's provider scope decides which provider actually serves a
 * request, and the tie-break rule below makes the choice deterministic.
 *
 * A failed or empty refresh keeps the previous snapshot rather than inventing a catalog.
 */
export class UnifiedCatalog {
  private records: ModelRecord[] = []
  private snapshot: SnapshotFile | undefined
  private aliases: Record<string, string> = {}
  private hidden = new Set<string>()

  fetchedAt = 0
  source: 'live' | 'saved' | 'empty' = 'empty'
  error = ''

  constructor(readonly path: string) {}

  async load(): Promise<void> {
    try {
      const raw = await readFile(this.path, 'utf8')
      const parsed = JSON.parse(raw) as SnapshotFile
      if (Array.isArray(parsed?.records)) {
        this.snapshot = parsed
        this.records = parsed.records
        this.fetchedAt = parsed.fetchedAt ?? 0
        this.source = parsed.source ?? 'saved'
        this.error = typeof parsed.error === 'string' ? parsed.error : ''
      }
    } catch {
      // No snapshot yet, or an unreadable one: start empty rather than guessing.
      this.snapshot = undefined
    }
  }

  setAliases(aliases: Record<string, string>): void {
    this.aliases = aliases
  }

  getAliases(): Record<string, string> {
    return { ...this.aliases }
  }

  setHidden(names: readonly string[]): void {
    this.hidden = new Set(names)
  }

  getHidden(): string[] {
    return [...this.hidden]
  }

  /** Replace every record. An empty result keeps the last good snapshot. */
  async replace(records: ModelRecord[]): Promise<void> {
    const normalised = records.map(normalizeRecord)
    if (normalised.length === 0) {
      this.error = this.records.length > 0
        ? '上游未返回任何模型，保留上次快照'
        : '上游未返回任何模型'
      this.source = this.records.length > 0 ? 'saved' : 'empty'
      await this.persist()
      return
    }
    this.records = normalised
    this.error = ''
    this.fetchedAt = Date.now()
    this.source = 'live'
    await this.persist()
  }

  private async persist(): Promise<void> {
    const payload: SnapshotFile = {
      fetchedAt: this.fetchedAt,
      source: this.source,
      error: this.error,
      records: this.records,
    }
    try {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 })
      await writeFile(this.path, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
    } catch {
      // Persisting the catalog is best-effort; the in-memory copy stays authoritative.
    }
  }

  all(): ModelRecord[] {
    return [...this.records]
  }

  /** Merged, alias-resolved view used by the console and `/v1/models`. */
  merged(): MergedModel[] {
    const byName = new Map<string, ModelRecord[]>()
    for (const record of this.records) {
      const bucket = byName.get(record.name)
      if (bucket === undefined) {
        byName.set(record.name, [record])
      } else {
        bucket.push(record)
      }
    }
    const out: MergedModel[] = []
    for (const [name, providers] of byName) {
      providers.sort(compareRecords)
      out.push({ name, providers, hidden: this.hidden.has(name) })
    }
    out.sort((left, right) => left.name.localeCompare(right.name))
    return out
  }

  /** Visible (non-hidden) models, in name order. */
  visible(): MergedModel[] {
    return this.merged().filter(model => !model.hidden)
  }

  /** Resolve a client-supplied model name, honouring aliases. */
  resolve(name: string): MergedModel | undefined {
    const key = normalizeName(name)
    if (key === '') return undefined
    const alias = this.aliases[key]
    const target = alias !== undefined ? normalizeName(alias) : key
    return this.merged().find(model => model.name === target)
  }

  /**
   * Pick the record that should serve `name` for a key restricted to `allowedProviders`.
   *
   * Deterministic tie-break, in order: alias/name resolution → key's provider scope →
   * provider priority → provider id. The winner is returned together with the provider id so
   * the gateway can echo it back in `x-myapi-provider`.
   */
  resolveUpstream(
    name: string,
    allowedProviders: string[],
  ): { record: ModelRecord; providerId: string } | undefined {
    const merged = this.resolve(name)
    if (merged === undefined) return undefined
    const scope = allowedProviders.length === 0 ? null : new Set(allowedProviders)
    const candidates = merged.providers.filter(record => scope === null || scope.has(record.providerId))
    if (candidates.length === 0) return undefined
    const winner = [...candidates].sort(compareRecords)[0]
    if (winner === undefined) return undefined
    return { record: winner, providerId: winner.providerId }
  }

  /** Provider ids that actually offer at least one visible model. */
  providersInScope(allowedProviders: string[]): string[] {
    const scope = allowedProviders.length === 0 ? null : new Set(allowedProviders)
    const ids = new Set<string>()
    for (const record of this.records) {
      if (scope === null || scope.has(record.providerId)) ids.add(record.providerId)
    }
    return [...ids].sort()
  }

  /** Every provider that has at least one model on record, regardless of visibility. */
  providerIds(): string[] {
    return [...new Set(this.records.map(record => record.providerId))].sort()
  }
}

/** Lower number wins. Ties break on provider id so the choice never depends on map order. */
function compareRecords(left: ModelRecord, right: ModelRecord): number {
  if (left.priority !== right.priority) return left.priority - right.priority
  return left.providerId.localeCompare(right.providerId)
}

/** Model names are unprefixed and case-insensitive on the wire. */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/gu, '')
}

function normalizeRecord(record: ModelRecord): ModelRecord {
  return { ...record, name: normalizeName(record.name) }
}
