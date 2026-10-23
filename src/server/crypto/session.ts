import { createHmac, timingSafeEqual } from 'node:crypto'

export interface PanelSessionPayload {
  v: 1
  exp: number
  av: number
}

function sessionKey(masterKey: Buffer): Buffer {
  return createHmac('sha256', masterKey).update('myapi:panel-session').digest()
}

function sign(data: string, masterKey: Buffer): string {
  return createHmac('sha256', sessionKey(masterKey)).update(data, 'utf8').digest('base64url')
}

/** Create a signed, stateless panel session token. */
export function signSession(payload: PanelSessionPayload, masterKey: Buffer): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url')
  return `${body}.${sign(body, masterKey)}`
}

/** Verify a panel session token; returns undefined when invalid or expired. */
export function verifySession(token: string | undefined, masterKey: Buffer, now = Date.now()): PanelSessionPayload | undefined {
  if (token === undefined || token === '') return undefined
  const dot = token.lastIndexOf('.')
  if (dot <= 0) return undefined
  const body = token.slice(0, dot)
  const presented = token.slice(dot + 1)
  const expected = sign(body, masterKey)
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as unknown
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const record = parsed as Record<string, unknown>
    if (record['v'] !== 1 || typeof record['exp'] !== 'number' || typeof record['av'] !== 'number') return undefined
    if (record['exp'] <= now) return undefined
    return { v: 1, exp: record['exp'], av: record['av'] }
  } catch {
    return undefined
  }
}
