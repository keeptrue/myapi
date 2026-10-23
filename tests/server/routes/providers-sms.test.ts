import { describe, expect, it } from 'vitest'
import { cookieHeader, createHarness, type Harness } from '../../helpers/harness.js'
import type { ProviderAdapter } from '../../../src/server/providers/types.js'
import type { AccountDraft, ProviderCapabilities, SmsSendResult } from '../../../src/shared/providers.js'

function capabilities(smsLogin: boolean): ProviderCapabilities {
  return {
    smsLogin,
    webLogin: false,
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

function draft(providerId: string, accountId: string): AccountDraft {
  return {
    providerId,
    label: `${providerId} 账号`,
    credentialKind: 'sms',
    credentials: { session: 'session-1' },
    profile: { accountId },
    nickname: '测试',
    mobileMasked: '138****8000',
  }
}

/** SMS adapter whose send step issues a ticket, as the Loomy flow does. */
function fakeSmsAdapter(id: string, smsLogin: boolean): { adapter: ProviderAdapter; sent: () => number } {
  const state = { sent: 0 }
  const adapter = {
    id,
    displayName: `${id} 测试提供商`,
    vendor: 'test',
    capabilities: capabilities(smsLogin),
    credentialDescriptors: () => [
      { field: 'session', label: 'session', hint: '', secret: true, required: true },
    ],
    importDescriptors: () => [],
    addByPaste: async () => draft(id, 'paste-1'),
    addByImport: async () => draft(id, 'import-1'),
    sendSms: async (): Promise<SmsSendResult> => {
      state.sent += 1
      return { ticket: `msgid-${id}` }
    },
    verifySms: async (): Promise<AccountDraft> => draft(id, 'u-1'),
    startWebLogin: async () => {
      throw new Error('unsupported')
    },
    completeWebLogin: async () => draft(id, 'u-1'),
    inference: async () => new Response('{}'),
    refreshCredential: async () => {
      throw new Error('unsupported')
    },
    refreshCatalog: async () => [],
    queryBalance: async () => ({ known: false, balances: [], fetchedAt: 0 }),
    checkin: async () => ({ ok: false, error: 'unsupported', deltas: [], actions: [], at: 0 }),
    claimItems: async () => [],
    claim: async (_account: unknown, item: { id: string; label: string; kind: 'popup' | 'download' | 'beta' | 'redeem' }) => ({ id: item.id, label: item.label, kind: item.kind, ok: false, message: 'unsupported' }),
    redeem: async () => ({ ok: false, message: 'unsupported', deltas: [], at: 0 }),
    keepalive: async () => ({ ok: false, message: 'unsupported', at: 0 }),
    testConnection: async () => ({ ok: true, latencyMs: 1, message: 'ok' }),
    toPublicProfile: () => ({
      nickname: '测试',
      mobileMasked: '',
      balances: [],
      plans: [],
      pendingClaims: 0,
      lastCheckedAt: 0,
      lastClaimAt: 0,
      extra: {},
    }),
    hasUsableBalance: () => true,
  }
  return { adapter: adapter as unknown as ProviderAdapter, sent: () => state.sent }
}

async function withAdapter(id: string, smsLogin: boolean): Promise<Harness & { sent: () => number }> {
  const harness = await createHarness()
  const { adapter, sent } = fakeSmsAdapter(id, smsLogin)
  harness.services.registry.register(adapter)
  return Object.assign(harness, { sent })
}

describe('provider-dispatched SMS login', () => {
  it('send returns the adapter ticket and verify persists the draft', async () => {
    const h = await withAdapter('smstest', true)
    try {
      const cookie = await h.login()
      const send = await h.app.inject({
        method: 'POST',
        url: '/api/providers/smstest/sms/send',
        headers: cookieHeader(cookie),
        payload: { mobile: '13800138000' },
      })
      expect(send.statusCode).toBe(200)
      expect((send.json() as { ticket?: string }).ticket).toBe('msgid-smstest')

      const verify = await h.app.inject({
        method: 'POST',
        url: '/api/providers/smstest/sms/verify',
        headers: cookieHeader(cookie),
        payload: { mobile: '13800138000', code: '123456', ticket: 'msgid-smstest' },
      })
      expect(verify.statusCode).toBe(200)
      const body = verify.json() as { account: { providerId: string } }
      expect(body.account.providerId).toBe('smstest')
      // The vendor account id lands in the adapter-owned profile of the stored record.
      const stored = h.services.store.findByAccountId('u-1')
      expect(stored?.providerId).toBe('smstest')
      expect(h.sent()).toBe(1)
    } finally {
      await h.close()
    }
  })

  it('rejects the send step for a provider without the SMS capability', async () => {
    const h = await withAdapter('nosms', false)
    try {
      const cookie = await h.login()
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/providers/nosms/sms/send',
        headers: cookieHeader(cookie),
        payload: { mobile: '13800138000' },
      })
      expect(response.statusCode).toBe(400)
      expect(h.sent()).toBe(0)
    } finally {
      await h.close()
    }
  })

  it('answers 404 for an unknown provider id', async () => {
    const h = await createHarness()
    try {
      const cookie = await h.login()
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/providers/nobody/sms/send',
        headers: cookieHeader(cookie),
        payload: { mobile: '13800138000' },
      })
      expect(response.statusCode).toBe(404)
    } finally {
      await h.close()
    }
  })

  it('keeps the AStudio challenge requirement: send without a solved captcha fails', async () => {
    const h = await createHarness()
    try {
      const cookie = await h.login()
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/providers/astudio/sms/send',
        headers: cookieHeader(cookie),
        payload: { mobile: '13800138000' },
      })
      expect(response.statusCode).toBe(400)
      const body = response.json() as { error: { message: string } }
      expect(body.error.message).toContain('滑块验证')
    } finally {
      await h.close()
    }
  })

  it('exposes credentialDescriptors on the provider roster', async () => {
    const h = await withAdapter('smstest', true)
    try {
      const cookie = await h.login()
      const response = await h.app.inject({ method: 'GET', url: '/api/providers', headers: cookieHeader(cookie) })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { providers: { id: string; credentialDescriptors: { field: string }[] }[] }
      const target = body.providers.find(provider => provider.id === 'smstest')
      expect(target?.credentialDescriptors.map(descriptor => descriptor.field)).toContain('session')
    } finally {
      await h.close()
    }
  })
})
