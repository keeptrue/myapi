import type { OfficialCost } from '../../shared/types.js'

export function compact(value: number | undefined | null): string {
  const number = value ?? 0
  if (!Number.isFinite(number)) return '—'
  if (Math.abs(number) >= 1_000_000) return `${(number / 1_000_000).toFixed(number >= 10_000_000 ? 1 : 2)}M`
  if (Math.abs(number) >= 1_000) return `${(number / 1_000).toFixed(number >= 10_000 ? 1 : 2)}k`
  return String(Math.round(number))
}

export function int(value: number | undefined | null): string {
  return new Intl.NumberFormat('zh-CN').format(Math.round(value ?? 0))
}

export function percent(value: number | undefined | null): string {
  const number = value ?? 0
  return `${(number * 100).toFixed(number > 0 && number < 0.01 ? 2 : 1)}%`
}

export function ms(value: number | undefined | null): string {
  const number = value ?? 0
  if (number <= 0) return '—'
  if (number < 1000) return `${Math.round(number)}ms`
  return `${(number / 1000).toFixed(number < 10_000 ? 2 : 1)}s`
}

export function timeAgo(value: number | undefined | null): string {
  if (value === undefined || value === null || value <= 0) return '从未'
  const delta = Date.now() - value
  if (delta < 60_000) return '刚刚'
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`
  return `${Math.floor(delta / 86_400_000)} 天前`
}

export function dateTime(value: number | undefined | null): string {
  if (value === undefined || value === null || value <= 0) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export function fullDateTime(value: number | undefined | null): string {
  if (value === undefined || value === null || value <= 0) return '—'
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

export function bucketLabel(bucket: string): string {
  const parts = bucket.split('T')
  return parts.length === 2 ? `${parts[1]}:00` : bucket
}

export function cooldown(value: number): string {
  const remaining = value - Date.now()
  if (remaining <= 0) return ''
  if (remaining < 60_000) return `${Math.ceil(remaining / 1000)}s`
  return `${Math.ceil(remaining / 60_000)}m`
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function usd(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—'
  if (value === 0) return '$0'
  if (value >= 100) return `$${value.toFixed(0)}`
  if (value >= 1) return `$${value.toFixed(2)}`
  if (value >= 0.01) return `$${value.toFixed(3)}`
  return `$${value.toFixed(4)}`
}

export function pricePair(cost: OfficialCost | undefined): string {
  if (cost === undefined || (cost.input === undefined && cost.output === undefined)) return '未标价'
  if (cost.input === 0 && cost.output === 0) return '免费'
  return `${usd(cost.input)} / ${usd(cost.output)}`
}

export function modalityLabel(value: string): string {
  const labels: Record<string, string> = {
    text: '文本',
    image: '图片',
    audio: '音频',
    video: '视频',
    pdf: 'PDF',
  }
  return labels[value] ?? value
}

export function modalityShort(value: string): string {
  const labels: Record<string, string> = {
    text: '文',
    image: '图',
    audio: '音',
    video: '视',
    pdf: 'PDF',
  }
  return labels[value] ?? value
}

export function confidenceLabel(value: string): string {
  const labels: Record<string, string> = {
    manual: '手动',
    exact: '精确',
    fuzzy: '近似',
  }
  return labels[value] ?? '未匹配'
}
