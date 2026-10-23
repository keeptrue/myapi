import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SecretBox } from '../../shared/types.js'

const KEY_BYTES = 32
const IV_BYTES = 12

function parseKey(raw: string, source: string): Buffer {
  const key = Buffer.from(raw.trim(), 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error(`${source} must decode to ${KEY_BYTES} bytes (got ${key.length})`)
  }
  return key
}

/**
 * Load the master key from the environment or `data/secret.key`.
 * The file is created with mode 0600 on first boot.
 */
export function loadOrCreateSecretKey(dataDir: string, envValue?: string): Buffer {
  if (envValue !== undefined && envValue.trim() !== '') {
    return parseKey(envValue, 'MYAPI_SECRET_KEY')
  }
  mkdirSync(dataDir, { recursive: true, mode: 0o700 })
  const path = join(dataDir, 'secret.key')
  if (existsSync(path)) {
    return parseKey(readFileSync(path, 'utf8'), path)
  }
  const key = randomBytes(KEY_BYTES)
  writeFileSync(path, `${key.toString('base64')}\n`, { mode: 0o600 })
  try {
    chmodSync(path, 0o600)
  } catch {
    // Non-POSIX filesystems may not support chmod; the file still exists.
  }
  return key
}

/** Encrypt one secret with AES-256-GCM. `aad` binds the ciphertext to its owner. */
export function seal(plaintext: string, aad: string, key: Buffer): SecretBox {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ct: ct.toString('base64'),
  }
}

/** Decrypt a SecretBox. Returns undefined for tampered or undecryptable input. */
export function open(box: SecretBox | undefined, aad: string, key: Buffer): string | undefined {
  if (box === undefined || box.v !== 1) return undefined
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(box.iv, 'base64'))
    decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(Buffer.from(box.tag, 'base64'))
    return Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    return undefined
  }
}

export function secretBoxAad(owner: string, field: string): string {
  return `myapi:${owner}:${field}`
}
