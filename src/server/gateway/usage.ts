import type { Counter, LogEntry, Stats, UsageSummary } from '../../shared/types.js'
import { emptyCounter } from '../store/schema.js'
import type { StateStore } from '../store/state.js'
import type { LogStore } from '../store/logs.js'

function add(target: Counter, entry: LogEntry): void {
  target.requests += 1
  if (entry.status >= 200 && entry.status < 400) target.successes += 1
  else target.failures += 1
  target.promptTokens += entry.promptTokens
  target.completionTokens += entry.completionTokens
  target.cachedTokens += entry.cachedTokens
  target.reasoningTokens += entry.reasoningTokens
  if (entry.firstTokenMs > 0) {
    target.firstTokenMsSum += entry.firstTokenMs
    target.firstTokenCount += 1
  }
}

function bucketFor(time: number): string {
  const date = new Date(time)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}`
}

function rangeStart(range: string): number {
  const now = Date.now()
  if (range === '24h') return now - 24 * 60 * 60 * 1000
  if (range === '7d') return now - 7 * 24 * 60 * 60 * 1000
  if (range === '30d') return now - 30 * 24 * 60 * 60 * 1000
  return 0
}

function sumCounters(counters: Iterable<Counter>): Counter {
  const total = emptyCounter()
  for (const counter of counters) {
    total.requests += counter.requests
    total.successes += counter.successes
    total.failures += counter.failures
    total.promptTokens += counter.promptTokens
    total.completionTokens += counter.completionTokens
    total.cachedTokens += counter.cachedTokens
    total.reasoningTokens += counter.reasoningTokens
    total.firstTokenMsSum += counter.firstTokenMsSum
    total.firstTokenCount += counter.firstTokenCount
  }
  return total
}

function sortCounters(record: Record<string, Counter>, limit = 20): Array<{ key: string; value: Counter }> {
  return Object.entries(record)
    .sort((left, right) => right[1].requests - left[1].requests)
    .slice(0, limit)
    .map(([key, value]) => ({ key, value }))
}

/** Aggregates request logs into the dashboard statistics document. */
export class UsageService {
  constructor(
    private readonly store: StateStore,
    private readonly logs: LogStore,
  ) {}

  get stats(): Stats {
    return this.store.current.stats
  }

  record(entry: LogEntry): void {
    const stats = this.store.current.stats
    add(stats.total, entry)
    const model = entry.model || 'unknown'
    stats.byModel[model] ??= emptyCounter()
    add(stats.byModel[model] as Counter, entry)
    const hour = bucketFor(entry.time)
    stats.byHour[hour] ??= emptyCounter()
    add(stats.byHour[hour] as Counter, entry)
    const account = entry.accountId || 'none'
    stats.byAccount[account] ??= emptyCounter()
    add(stats.byAccount[account] as Counter, entry)
    const key = entry.keyId || 'none'
    stats.byKey[key] ??= emptyCounter()
    add(stats.byKey[key] as Counter, entry)
    this.store.scheduleSave()
    void this.logs.append(entry).catch(() => undefined)
  }

  summary(range = '24h'): UsageSummary {
    const stats = this.store.current.stats
    const start = rangeStart(range)
    const buckets = Object.entries(stats.byHour)
      .filter(([bucket]) => {
        if (start === 0) return true
        const time = new Date(`${bucket}:00:00`).getTime()
        return Number.isFinite(time) && time >= start
      })
      .sort(([left], [right]) => left.localeCompare(right))
    const total = buckets.length > 0
      ? sumCounters(buckets.map(([, counter]) => counter))
      : { ...stats.total }
    return {
      range,
      total,
      byModel: sortCounters(stats.byModel),
      byAccount: sortCounters(stats.byAccount),
      byKey: sortCounters(stats.byKey),
      timeseries: buckets.map(([bucket, counter]) => ({
        bucket,
        requests: counter.requests,
        promptTokens: counter.promptTokens,
        completionTokens: counter.completionTokens,
        failures: counter.failures,
      })),
    }
  }

  recent(limit = 50): LogEntry[] {
    return this.logs.recent(limit)
  }

  reset(): void {
    this.store.current.stats = {
      total: emptyCounter(),
      byModel: {},
      byHour: {},
      byAccount: {},
      byKey: {},
    }
    this.store.scheduleSave()
  }
}
