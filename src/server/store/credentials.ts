import type { SecretBox } from '../../shared/types.js'
import { credentialsAad, open, seal } from '../crypto/secretbox.js'
import type { StoredAccount } from './schema.js'
import { isRecord } from '../util.js'

/**
 * Provider-agnostic credential blob codec, shared by every adapter.
 *
 * The blob is one AES-256-GCM `SecretBox` whose AAD binds it to `id + providerId`, so a
 * ciphertext can never be replayed against another provider. Field names inside the map
 * are adapter-owned; this module only seals and opens the envelope.
 */

export interface DecodedCredentials {
  map: Record<string, string>
  /** False when the blob is missing, tampered or not JSON. */
  ok: boolean
}

/** Decode an account's credential blob. A failure never throws: the caller decides
 *  whether to mark the session dead. */
export function decodeCredentials(account: StoredAccount, key: Buffer): DecodedCredentials {
  const raw = open(account.credentialsEnc, credentialsAad(account.id, account.providerId), key)
  if (raw === undefined) return { map: {}, ok: false }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return { map: {}, ok: false }
    const map: Record<string, string> = {}
    for (const [field, value] of Object.entries(parsed)) {
      if (typeof value === 'string') map[field] = value
    }
    return { map, ok: true }
  } catch {
    return { map: {}, ok: false }
  }
}

/** Re-seal a credential map with the provider-bound AAD. */
export function encodeCredentials(
  account: Pick<StoredAccount, 'id' | 'providerId'>,
  map: Record<string, string>,
  key: Buffer,
): SecretBox {
  return seal(JSON.stringify(map), credentialsAad(account.id, account.providerId), key)
}
