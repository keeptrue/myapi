import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { API_KEY_PREFIX, API_KEY_PREFIX_DISPLAY_LENGTH } from '../../shared/constants.js'

export interface GeneratedApiKey {
  key: string
  prefix: string
  last4: string
  keyHmac: string
}

function pepperKey(masterKey: Buffer): Buffer {
  return createHmac('sha256', masterKey).update('myapi:api-key:pepper').digest()
}

/** HMAC-SHA256 of an API key, hex encoded. The plaintext key is never stored. */
export function hmacApiKey(key: string, masterKey: Buffer): string {
  return createHmac('sha256', pepperKey(masterKey)).update(key, 'utf8').digest('hex')
}

export function apiKeyPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX_DISPLAY_LENGTH)
}

export function generateApiKey(masterKey: Buffer): GeneratedApiKey {
  const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
  return {
    key,
    prefix: apiKeyPrefix(key),
    last4: key.slice(-4),
    keyHmac: hmacApiKey(key, masterKey),
  }
}

/** Constant-time comparison of a presented key against a stored HMAC. */
export function apiKeyMatches(key: string, storedHmac: string, masterKey: Buffer): boolean {
  const actual = Buffer.from(hmacApiKey(key, masterKey), 'hex')
  const expected = Buffer.from(storedHmac, 'hex')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
