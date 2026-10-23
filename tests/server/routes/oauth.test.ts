import { describe, expect, it } from 'vitest'
import { cookieHeader, createHarness, type Harness } from '../../helpers/harness.js'
import type { ProviderAdapter } from '../../../src/server/providers/types.js'
import type { ProviderCapabilities, WebLoginSession } from '../../../src/shared/providers.js'

function capabilities(webLogin: boolean): ProviderCapabilities {
  return {
    smsLogin: false,
    webLogin,
    pasteCredential: true,
    importFromClient: false,
    tokenRenew: false,
    catalogRefresh: false,
    balanceQuery: false,
    checkin: false,
    benefits: false,
    keepalive: false,
  }
}

/**
 * Minimal adapter standing in for the half of the provider layer that owns browser
 * authorization. Only the surface the OAuth routes touch is meaningful; everything else is a
 * placeholder so the real `ProviderAdapter` contract can be filled in later.
 */
function fakeWebLoginAdapter(id: string, webLogin: boolean): { adapter: ProviderAdapter; startCalls: () => number } {
  const state = { startCalls: 0 }
  const adapter = {
    id,
    displayName: `${id} 测试提供商`,
    vendor: 'test',
    capabilities: capabilities(webLogin),
    credentialDescriptors: () => [],
    importDescriptors: () => [],
    startWebLogin: async (): Promise<WebLoginSession> => {
      state.startCalls += 1
      return {
        stateId: `state-${id}`,
        providerId: id,
        authorizeUrl: `https://auth.test/authorize?state=state-${id}`,
        redirectUri: 'http://127.0.0.1:0/callback',
        hint: '请在浏览器窗口里完成授权',
        expiresAt: Date.now() + 300_000,
      }
    },
  }
  return { adapter: adapter as unknown as ProviderAdapter, startCalls: () => state.startCalls }
}

/** Wire fakes into the harness registry without touching `services.ts`. */
async function withProviders(ids: string[]): Promise<Harness & { startCallsFor: (id: string) => number }> {
  const harness = await createHarness()
  const counters = new Map<string, () => number>()
  for (const id of ids) {
    const { adapter, startCalls } = fakeWebLoginAdapter(id, id === 'webonly')
    harness.services.registry.register(adapter)
    counters.set(id, startCalls)
  }
  Object.defineProperty(harness, 'startCallsFor', { value: (id: string) => counters.get(id)?.() ?? 0, enumerable: false })
  return harness as Harness & { startCallsFor: (id: string) => number }
}

describe('OAuth console flow', () => {
  it('GET /api/oauth/status exposes a callback address and a positive TTL', async () => {
    const h = await withProviders(['webonly'])
    try {
      const cookie = await h.login()
      const response = await h.app.inject({ method: 'GET', url: '/api/oauth/status', headers: cookieHeader(cookie) })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { redirectUri: string; ttlSeconds: number }
      expect(typeof body.redirectUri).toBe('string')
      expect(body.redirectUri.length).toBeGreaterThan(0)
      expect(typeof body.ttlSeconds).toBe('number')
      expect(body.ttlSeconds).toBeGreaterThan(0)
    } finally {
      await h.close()
    }
  })

  it('POST /api/oauth/start rejects a provider without webLogin, naming it and creating no state', async () => {
    const h = await withProviders(['nologin'])
    try {
      const cookie = await h.login()
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/oauth/start',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { providerId: 'nologin' },
      })
      expect(response.statusCode).toBe(400)
      const body = response.json() as { error?: { message?: string }; stateId?: string }
      expect((body.error?.message ?? '')).toContain('nologin')
      expect(body.stateId).toBeUndefined()
      // The adapter's start method must never be reached when the capability is off.
      expect(h.startCallsFor('nologin')).toBe(0)
    } finally {
      await h.close()
    }
  })

  it('POST /api/oauth/start rejects an unknown provider with 400', async () => {
    const h = await withProviders(['webonly'])
    try {
      const cookie = await h.login()
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/oauth/start',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { providerId: 'does-not-exist' },
      })
      expect(response.statusCode).toBe(400)
      const body = response.json() as { error?: { message?: string } }
      expect((body.error?.message ?? '')).toContain('does-not-exist')
    } finally {
      await h.close()
    }
  })

  it('POST /api/oauth/start requires the panel session', async () => {
    const h = await withProviders(['webonly'])
    try {
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/oauth/start',
        headers: { 'content-type': 'application/json', 'x-myapi-csrf': '1' },
        payload: { providerId: 'webonly' },
      })
      expect(response.statusCode).toBe(401)
    } finally {
      await h.close()
    }
  })

  it('GET /api/oauth/pending/:stateId reports unknown ids as expired rather than 500', async () => {
    const h = await withProviders(['webonly'])
    try {
      const cookie = await h.login()
      const response = await h.app.inject({
        method: 'GET',
        url: '/api/oauth/pending/unknown-state-id',
        headers: cookieHeader(cookie),
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { status: 'pending' | 'done' | 'expired' | 'error'; message: string }
      expect(['expired', 'error']).toContain(body.status)
      expect(typeof body.message).toBe('string')
    } finally {
      await h.close()
    }
  })
})
