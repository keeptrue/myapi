import { describe, expect, it } from 'vitest'
import { open, seal, secretBoxAad } from '../../../src/server/crypto/secretbox.js'
import { generatePanelPassword, hashPassword, verifyPassword } from '../../../src/server/crypto/password.js'
import { apiKeyMatches, generateApiKey, hmacApiKey } from '../../../src/server/crypto/apikey.js'
import { signSession, verifySession } from '../../../src/server/crypto/session.js'
import { API_KEY_PREFIX } from '../../../src/shared/constants.js'

const key = Buffer.alloc(32, 7)

describe('secretbox', () => {
  it('round-trips a secret bound to its owner', () => {
    const box = seal('hello', secretBoxAad('acct', 'token'), key)
    expect(open(box, secretBoxAad('acct', 'token'), key)).toBe('hello')
  })

  it('rejects a different aad', () => {
    const box = seal('hello', secretBoxAad('acct', 'token'), key)
    expect(open(box, secretBoxAad('acct', 'modelBearer'), key)).toBeUndefined()
  })

  it('rejects tampering', () => {
    const box = seal('hello', 'aad', key)
    expect(open({ ...box, ct: Buffer.from('tampered').toString('base64') }, 'aad', key)).toBeUndefined()
  })
})

describe('panel password', () => {
  it('verifies only the matching password', () => {
    const hash = hashPassword('correct horse battery staple')
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(verifyPassword('wrong', hash)).toBe(false)
    expect(verifyPassword('', 'garbage')).toBe(false)
  })

  it('generates 32 hex characters', () => {
    expect(generatePanelPassword()).toMatch(/^[0-9a-f]{32}$/u)
  })
})

describe('api keys', () => {
  it('stores an HMAC and verifies constant-time equality', () => {
    const generated = generateApiKey(key)
    expect(generated.key.startsWith(API_KEY_PREFIX)).toBe(true)
    expect(apiKeyMatches(generated.key, generated.keyHmac, key)).toBe(true)
    expect(apiKeyMatches(`${generated.key}x`, generated.keyHmac, key)).toBe(false)
    expect(hmacApiKey(generated.key, key)).toBe(generated.keyHmac)
  })
})

describe('panel session', () => {
  it('verifies a signed, unexpired session', () => {
    const token = signSession({ v: 1, exp: Date.now() + 60_000, av: 3 }, key)
    expect(verifySession(token, key)?.av).toBe(3)
  })

  it('rejects an expired or tampered session', () => {
    const token = signSession({ v: 1, exp: Date.now() - 1, av: 3 }, key)
    expect(verifySession(token, key)).toBeUndefined()
    const valid = signSession({ v: 1, exp: Date.now() + 60_000, av: 3 }, key)
    expect(verifySession(valid.replace(/.$/u, 'x'), key)).toBeUndefined()
  })
})
