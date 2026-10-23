import { Buffer } from 'node:buffer'
import { describe, expect, it } from 'vitest'
import { credentialsAad, legacyCredentialAad, open, seal } from '../../../src/server/crypto/secretbox.js'
import { migrateV1Account, migrateV1State } from '../../../src/server/providers/migration.js'
import { emptyState } from '../../../src/server/store/schema.js'
import { testSettings } from '../../helpers/settings.js'

const key = Buffer.alloc(32, 11)
const settings = testSettings()

interface LegacyBox {
  tokenEnc?: ReturnType<typeof seal>
  ssoSessionEnc?: ReturnType<typeof seal>
  modelBearerEnc?: ReturnType<typeof seal>
}

function legacyAccount(id: string, boxes: LegacyBox = {}): Record<string, unknown> {
  return {
    id,
    name: '主账号',
    accountId: `ast-${id}`,
    uid: 'u-7',
    tokenEnc: boxes.tokenEnc ?? seal('chat-token', legacyCredentialAad(id, 'token'), key),
    ssoSessionEnc: boxes.ssoSessionEnc ?? seal('sso-session', legacyCredentialAad(id, 'ssoSession'), key),
    modelBearerEnc: boxes.modelBearerEnc ?? seal('bearer-token', legacyCredentialAad(id, 'modelBearer'), key),
    mobile: '13800138000',
    nickname: '小明',
    domainAccount: '',
    source: 'sms-login',
    enabled: true,
    sessionOk: true,
    statusNote: '',
    lastError: '',
    lastUsedAt: 0,
    cooldownUntil: 0,
    successes: 3,
    failures: 0,
    pointsKnown: true,
    pointsBalance: 120,
    sparkBalance: 8,
    planCode: 'pro',
    planName: '专业版',
    planActive: true,
    pendingPopups: 2,
    lastCheckedAt: 1_000,
    lastClaimAt: 0,
    createdAt: 10,
    updatedAt: 20,
  }
}

describe('schema v1 → v2 migration', () => {
  it('re-seals the three legacy credential boxes into one provider-bound blob', () => {
    const id = 'acc-1'
    const migrated = migrateV1Account(legacyAccount(id) as never, key)

    expect(migrated.providerId).toBe('astudio')
    expect(migrated.credentialKind).toBe('sms')
    expect(migrated.label).toBe('主账号')
    expect(migrated.sessionOk).toBe(true)

    const plaintext = open(migrated.credentialsEnc, credentialsAad(id, 'astudio'), key)
    expect(plaintext).toBeDefined()
    expect(JSON.parse(plaintext ?? '{}')).toEqual({
      token: 'chat-token',
      ssoSession: 'sso-session',
      modelBearer: 'bearer-token',
      mobile: '13800138000',
    })
  })

  it('moves vendor state into profile and leaves the shell provider-agnostic', () => {
    const migrated = migrateV1Account(legacyAccount('acc-2') as never, key)

    expect(migrated.profile['accountId']).toBe('ast-acc-2')
    expect(migrated.profile['nickname']).toBe('小明')
    expect(migrated.profile['pointsBalance']).toBe(120)
    expect(migrated.profile['sparkBalance']).toBe(8)
    expect(migrated.profile['planName']).toBe('专业版')
    expect(migrated.profile['pendingPopups']).toBe(2)

    // The shell must not carry vendor vocabulary any more.
    for (const field of ['pointsBalance', 'planName', 'nickname', 'mobile', 'accountId', 'uid']) {
      expect(migrated).not.toHaveProperty(field)
    }
  })

  it('maps the v1 source badge onto the v2 credential kind', () => {
    const cases: Array<[string, string]> = [
      ['sms-login', 'sms'],
      ['paste', 'paste'],
      ['file-import', 'client-import'],
      ['model-only', 'bearer-only'],
    ]
    for (const [source, kind] of cases) {
      const migrated = migrateV1Account({ ...legacyAccount('acc-3'), source } as never, key)
      expect(migrated.credentialKind).toBe(kind)
    }
  })

  it('binds the blob to the provider so it cannot be replayed against another provider', () => {
    const id = 'acc-4'
    const migrated = migrateV1Account(legacyAccount(id) as never, key)

    expect(open(migrated.credentialsEnc, credentialsAad(id, 'qoder'), key)).toBeUndefined()
    expect(open(migrated.credentialsEnc, credentialsAad(`other-${id}`, 'astudio'), key)).toBeUndefined()
    // The v1 per-field AAD scheme must not open the v2 blob either.
    expect(open(migrated.credentialsEnc, `myapi:${id}:token`, key)).toBeUndefined()
  })

  it('flags an account whose legacy credentials cannot be decrypted instead of crashing', () => {
    const id = 'acc-5'
    const garbage = { v: 1, iv: 'not-base64', tag: 'nope', ct: 'nope' } as const
    const migrated = migrateV1Account(legacyAccount(id, {
      tokenEnc: garbage,
      ssoSessionEnc: garbage,
      modelBearerEnc: garbage,
    }) as never, key)

    expect(migrated.sessionOk).toBe(false)
    expect(migrated.statusNote).toContain('重新导入')
    // The mobile was plaintext in v1, so the account still carries something usable.
    expect(JSON.parse(open(migrated.credentialsEnc, credentialsAad(id, 'astudio'), key) ?? '{}')).toEqual({ mobile: '13800138000' })
  })

  it('migrates a whole v1 document and stamps schemaVersion 2', () => {
    const next = migrateV1State({
      schemaVersion: 1,
      auth: { passwordHash: 'hash', authVersion: 3, passwordGenerated: true, createdAt: 5 },
      accounts: [legacyAccount('acc-6') as never],
      apiKeys: [{ id: 'k1', name: 'k', prefix: 'sk-myapi-abc', last4: 'abc', enabled: true, allowedModels: [], allowedProviders: [], boundAccountId: null, rpm: 60, createdAt: 1, lastUsedAt: 0, keyHmac: 'h' }],
      modelAliases: { 'glm-5-2': 'glm-5.2' },
      modelVisibility: { hidden: ['old-model'] },
    }, settings, key)

    expect(next.schemaVersion).toBe(2)
    expect(next.auth.passwordHash).toBe('hash')
    expect(next.auth.authVersion).toBe(3)
    expect(next.auth.adminUser).toBe('')
    expect(next.accounts).toHaveLength(1)
    expect(next.accounts[0]?.providerId).toBe('astudio')
    expect(next.modelAliases).toEqual({ 'glm-5-2': 'glm-5.2' })
    expect(next.modelVisibility.hidden).toEqual(['old-model'])
    expect(next.apiKeys).toHaveLength(1)
  })

  it('leaves a v2 document untouched', () => {
    const base = emptyState(settings)
    expect(base.schemaVersion).toBe(2)
    expect(base.auth.adminUser).toBe('')
  })
})
