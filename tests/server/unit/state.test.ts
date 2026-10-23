import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { StateStore } from '../../../src/server/store/state.js'
import { defaultSettings } from '../../../src/server/config.js'
import { testConfig } from '../../helpers/harness.js'
import { credentialsAad, loadOrCreateSecretKey, open, seal } from '../../../src/server/crypto/secretbox.js'
import type { StoredAccount } from '../../../src/server/store/schema.js'

function account(id: string, box: ReturnType<typeof seal>): StoredAccount {
  return {
    id,
    providerId: 'astudio',
    label: id,
    credentialKind: 'paste',
    enabled: true,
    sessionOk: true,
    statusNote: '',
    lastError: '',
    lastUsedAt: 0,
    cooldownUntil: 0,
    successes: 0,
    failures: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    credentialsEnc: box,
    profile: {},
  }
}

describe('state store', () => {
  it('creates a password, persists accounts and reloads encrypted secrets', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myapi-state-'))
    try {
      const config = testConfig(dir)
      const key = loadOrCreateSecretKey(dir)
      const store = new StateStore(dir, defaultSettings(config), key)
      const loaded = await store.load()
      expect(loaded.generatedPassword).toMatch(/^[0-9a-f]{32}$/u)
      expect(store.passwordHash()).not.toBe('')

      const box = seal('token-value', credentialsAad('acc-1', 'astudio'), key)
      store.upsertAccount(account('acc-1', box))
      await store.saveNow()

      const reopened = new StateStore(dir, defaultSettings(config), key)
      const second = await reopened.load()
      expect(second.generatedPassword).toBeUndefined()
      expect(reopened.accounts).toHaveLength(1)
      expect(open(reopened.account('acc-1')?.credentialsEnc, credentialsAad('acc-1', 'astudio'), key)).toBe('token-value')

      const versionBefore = reopened.authVersion()
      await reopened.setPassword('new-password')
      expect(reopened.authVersion()).toBe(versionBefore + 1)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
