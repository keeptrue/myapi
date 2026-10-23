import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const N = 16_384
const R = 8
const P = 1
const KEY_LEN = 64
const MAX_MEM = 128 * 1024 * 1024

/** Hash a panel password with scrypt. Format: `scrypt$N$r$p$salt$hash`. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEY_LEN, { N, r: R, p: P, maxmem: MAX_MEM })
  return ['scrypt', N, R, P, salt.toString('base64'), hash.toString('base64')].join('$')
}

/** Verify a panel password against a stored hash in constant time. */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  try {
    const salt = Buffer.from(parts[4] ?? '', 'base64')
    const expected = Buffer.from(parts[5] ?? '', 'base64')
    const actual = scryptSync(password, salt, expected.length, { N: n, r, p, maxmem: MAX_MEM })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** Generate a 32-character hexadecimal panel password. */
export function generatePanelPassword(): string {
  return randomBytes(16).toString('hex')
}
