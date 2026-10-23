import { describe, expect, it } from 'vitest'
import { MissingAdapterMethodError, ProviderRegistry, UnsupportedProviderError } from '../../../src/server/providers/registry.js'
import type { ProviderAdapter } from '../../../src/server/providers/types.js'
import { emptyCapabilities } from '../../../src/shared/providers.js'
import type { StoredAccount } from '../../../src/server/store/schema.js'
import { randomId } from '../../../src/server/util.js'

const UPSTREAM = {
  upstreamBase: '',
  modelsBase: '',
  workspaceBase: '',
  studioVersion: '',
  clientType: '',
  requestTimeoutSeconds: 300,
  maxBodyMb: 32,
  maxConcurrency: 8,
}

function account(providerId: string): StoredAccount {
  return {
    id: randomId('acc'),
    providerId,
    label: '测试账号',
    credentialKind: 'paste',
    enabled: true,
    sessionOk: true,
    statusNote: '',
    lastError: '',
    lastUsedAt: 0,
    cooldownUntil: 0,
    successes: 0,
    failures: 0,
    createdAt: 0,
    updatedAt: 0,
    credentialsEnc: { v: 1, iv: 'aAAA', tag: 'bAAA', ct: 'cAAA' },
    profile: {},
  }
}

function fakeAdapter(id: string, overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    id,
    displayName: id,
    vendor: '测试厂商',
    capabilities: emptyCapabilities(),
    credentialDescriptors: () => [],
    importDescriptors: () => [],
    addByPaste: async () => ({
      providerId: id,
      label: '',
      credentialKind: 'paste',
      credentials: {},
      profile: {},
      nickname: '',
      mobileMasked: '',
    }),
    addByImport: async () => ({
      providerId: id,
      label: '',
      credentialKind: 'client-import',
      credentials: {},
      profile: {},
      nickname: '',
      mobileMasked: '',
    }),
    startWebLogin: async () => {
      throw new UnsupportedProviderError(id, '网页授权登录')
    },
    completeWebLogin: async () => {
      throw new UnsupportedProviderError(id, '网页授权登录')
    },
    refreshCredential: async () => undefined,
    inference: async () => new Response('{}', { status: 200 }),
    refreshCatalog: async () => [],
    queryBalance: async () => ({ known: false, balances: [], fetchedAt: 0 }),
    checkin: async () => ({ ok: false, error: '不支持', deltas: [], actions: [], at: 0 }),
    claimItems: async () => [],
    claim: async () => ({ id: '', label: '', kind: 'popup', ok: false, message: '' }),
    redeem: async () => ({ ok: false, message: '', deltas: [], at: 0 }),
    keepalive: async () => ({ ok: false, message: '', at: 0 }),
    testConnection: async () => ({ ok: false, latencyMs: 0, message: '' }),
    toPublicProfile: () => ({
      nickname: '',
      mobileMasked: '',
      balances: [],
      plans: [],
      pendingClaims: 0,
      lastCheckedAt: 0,
      lastClaimAt: 0,
      extra: {},
    }),
    hasUsableBalance: () => true,
    ...overrides,
  }
}

describe('provider registry', () => {
  it('lists adapters in a stable id order', () => {
    const registry = new ProviderRegistry()
    registry.register(fakeAdapter('qoder'))
    registry.register(fakeAdapter('astudio'))

    expect(registry.ids()).toEqual(['astudio', 'qoder'])
    expect(registry.all().map(adapter => adapter.id)).toEqual(['astudio', 'qoder'])
  })

  it('rejects a duplicate provider id', () => {
    const registry = new ProviderRegistry()
    registry.register(fakeAdapter('astudio'))
    expect(() => registry.register(fakeAdapter('astudio'))).toThrow(/已注册/u)
  })

  it('throws a console-ready message for an unknown provider', () => {
    const registry = new ProviderRegistry()
    expect(() => registry.require('nope')).toThrow(/未知的提供商：nope/u)
  })

  it('reports which capabilities a provider actually declares', () => {
    const registry = new ProviderRegistry()
    const capabilities = { ...emptyCapabilities(), smsLogin: true, checkin: true }
    registry.register(fakeAdapter('astudio', { capabilities }))

    const adapter = registry.require('astudio')
    expect(adapter.capabilities.smsLogin).toBe(true)
    expect(adapter.capabilities.webLogin).toBe(false)
  })

  it('surfaces an unsupported flow as UnsupportedProviderError, not as a crash', async () => {
    const adapter = fakeAdapter('astudio')
    await expect(adapter.startWebLogin(
      { stateId: 'st-1', redirectUri: 'http://127.0.0.1:8787/oauth/callback' },
      { config: UPSTREAM },
    )).rejects.toBeInstanceOf(UnsupportedProviderError)
  })

  it('lets an adapter omit the optional renewal hook and still be usable', async () => {
    const adapter = fakeAdapter('astudio')
    expect(adapter.needsCredentialRefresh?.(account('astudio'))).toBeUndefined()
    await expect(adapter.refreshCredential(account('astudio'), { config: UPSTREAM })).resolves.toBeUndefined()
  })

  it('exposes the adapter context builder with the gateway limits', () => {
    const registry = new ProviderRegistry()
    const context = registry.context({
      host: '127.0.0.1',
      port: 8787,
      dataDir: '/tmp/x',
      logLevel: 'info',
      maxBodyMb: 32,
      maxConcurrency: 8,
      trustProxy: false,
      upstreamBase: 'u',
      modelsBase: 'm',
      workspaceBase: 'w',
      studioVersion: '1',
      clientType: '1',
    })
    expect(context.config.maxBodyMb).toBe(32)
    expect(context.signal).toBeUndefined()
  })

  it('keeps MissingAdapterMethodError available for adapters that declare a capability they do not implement', () => {
    const error = new MissingAdapterMethodError('qoder', 'checkin')
    expect(error).toBeInstanceOf(Error)
    expect(error.message).toContain('qoder')
    expect(error.method).toBe('checkin')
  })
})
