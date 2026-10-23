export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function stringField(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function numberField(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export function booleanField(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

export function truncate(value: string, max = 400): string {
  return value.length > max ? `${value.slice(0, max)}…` : value
}

/** Normalize a uid; the login payload uses 0 as a placeholder. */
export function normalizeUid(value: string): string {
  const uid = value.trim()
  if (uid === '' || uid === '0' || uid.length > 256 || !/^[A-Za-z0-9._@-]+$/u.test(uid)) return ''
  return uid
}

export function localDayKey(time = Date.now()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env['TZ'] ?? undefined }).format(new Date(time))
}

export function randomId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`
}
