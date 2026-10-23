import { appendFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { BenefitEvent, LogEntry } from '../../shared/types.js'
import { ensureDir } from './atomic.js'

function dayKey(time = Date.now()): string {
  return new Date(time).toISOString().slice(0, 10)
}

function fileFor(dir: string, day: string): string {
  return join(dir, `${day}.jsonl`)
}

export interface LogQuery {
  limit?: number
  cursor?: number
  model?: string
  accountId?: string
  keyId?: string
  status?: number
  from?: number
  to?: number
}

/** Append-only JSONL request log with an in-memory ring for the console. */
export class LogStore {
  private ring: LogEntry[] = []
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly dataDir: string,
    private readonly maxEntries: number,
    private readonly retentionDays: number,
  ) {}

  private get dir(): string {
    return join(this.dataDir, 'logs')
  }

  async init(): Promise<void> {
    await ensureDir(this.dir)
    await this.prune()
    const files = (await readdir(this.dir)).filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/u.test(name)).sort().slice(-3)
    for (const file of files) {
      const text = await readFile(join(this.dir, file), 'utf8').catch(() => '')
      for (const line of text.split('\n')) {
        if (line.trim() === '') continue
        try {
          this.ring.push(JSON.parse(line) as LogEntry)
        } catch {
          // A truncated line from a crash is ignored.
        }
      }
    }
    this.trimRing()
  }

  async append(entry: LogEntry): Promise<void> {
    this.ring.push(entry)
    this.trimRing()
    const line = `${JSON.stringify(entry)}\n`
    const path = fileFor(this.dir, dayKey(entry.time))
    const run = async (): Promise<void> => {
      await mkdir(this.dir, { recursive: true, mode: 0o700 })
      await appendFile(path, line, { mode: 0o600 })
    }
    this.writeChain = this.writeChain.then(run, run)
    await this.writeChain
  }

  recent(limit = 50): LogEntry[] {
    return this.ring.slice(-limit).reverse()
  }

  async query(options: LogQuery = {}): Promise<{ entries: LogEntry[]; nextCursor: number | null }> {
    const limit = Math.min(Math.max(options.limit ?? 100, 1), 1000)
    const from = options.from ?? 0
    const to = options.to ?? Number.MAX_SAFE_INTEGER
    const entries: LogEntry[] = []
    const files = (await readdir(this.dir).catch(() => []))
      .filter(name => /^\d{4}-\d{2}-\d{2}\.jsonl$/u.test(name))
      .sort()
      .reverse()
    for (const file of files) {
      const text = await readFile(join(this.dir, file), 'utf8').catch(() => '')
      const lines = text.split('\n')
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const line = lines[index]
        if (line === undefined || line.trim() === '') continue
        let entry: LogEntry
        try {
          entry = JSON.parse(line) as LogEntry
        } catch {
          continue
        }
        if (entry.time < from || entry.time > to) continue
        if (options.model !== undefined && options.model !== '' && entry.model !== options.model) continue
        if (options.accountId !== undefined && options.accountId !== '' && entry.accountId !== options.accountId) continue
        if (options.keyId !== undefined && options.keyId !== '' && entry.keyId !== options.keyId) continue
        if (options.status !== undefined && entry.status !== options.status) continue
        entries.push(entry)
        if (entries.length >= limit + 1) break
      }
      if (entries.length >= limit + 1) break
    }
    entries.sort((a, b) => b.time - a.time)
    const page = entries.slice(0, limit)
    const nextCursor = entries.length > limit ? limit : null
    void options.cursor
    return { entries: page, nextCursor }
  }

  async export(format: 'csv' | 'jsonl', options: LogQuery = {}): Promise<string> {
    const { entries } = await this.query({ ...options, limit: 1000 })
    if (format === 'jsonl') return entries.map(entry => JSON.stringify(entry)).join('\n')
    const header = ['time', 'model', 'upstream_model', 'account', 'key', 'stream', 'status', 'prompt_tokens', 'completion_tokens', 'first_token_ms', 'duration_ms', 'error']
    const rows = entries.map(entry => [
      new Date(entry.time).toISOString(),
      entry.model,
      entry.upstreamModel,
      entry.accountName,
      entry.keyPrefix,
      entry.stream ? '1' : '0',
      String(entry.status),
      String(entry.promptTokens),
      String(entry.completionTokens),
      String(entry.firstTokenMs),
      String(entry.durationMs),
      entry.error,
    ].map(cell => `"${cell.replaceAll('"', '""')}"`).join(','))
    return [header.join(','), ...rows].join('\n')
  }

  async clear(): Promise<void> {
    this.ring = []
    const files = await readdir(this.dir).catch(() => [])
    await Promise.all(files.map(file => unlink(join(this.dir, file)).catch(() => undefined)))
  }

  private trimRing(): void {
    if (this.ring.length > this.maxEntries) {
      this.ring = this.ring.slice(-this.maxEntries)
    }
  }

  private async prune(): Promise<void> {
    const cutoff = dayKey(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000)
    const files = await readdir(this.dir).catch(() => [])
    for (const file of files) {
      if (!/^\d{4}-\d{2}-\d{2}\.jsonl$/u.test(file)) continue
      if (file.slice(0, 10) < cutoff) await unlink(join(this.dir, file)).catch(() => undefined)
    }
  }
}

/** Append-only benefits event log with a small ring for the console. */
export class BenefitStore {
  private ring: BenefitEvent[] = []
  private writeChain: Promise<void> = Promise.resolve()

  constructor(private readonly dataDir: string) {}

  private get path(): string {
    return join(this.dataDir, 'benefits.jsonl')
  }

  async init(): Promise<void> {
    await ensureDir(this.dataDir)
    const text = await readFile(this.path, 'utf8').catch(() => '')
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      try {
        this.ring.push(JSON.parse(line) as BenefitEvent)
      } catch {
        // ignore a truncated line
      }
    }
    this.ring = this.ring.slice(-500)
  }

  async append(event: BenefitEvent): Promise<void> {
    this.ring.push(event)
    this.ring = this.ring.slice(-500)
    const line = `${JSON.stringify(event)}\n`
    const run = async (): Promise<void> => {
      await mkdir(this.dataDir, { recursive: true, mode: 0o700 })
      await appendFile(this.path, line, { mode: 0o600 })
    }
    this.writeChain = this.writeChain.then(run, run)
    await this.writeChain
  }

  recent(limit = 100): BenefitEvent[] {
    return this.ring.slice(-limit).reverse()
  }
}
