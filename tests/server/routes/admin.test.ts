import { describe, expect, it } from 'vitest'
import { cookieHeader, createHarness } from '../../helpers/harness.js'
import { API_KEY_PREFIX } from '../../../src/shared/constants.js'

describe('admin auth and keys', () => {
  it('requires the CSRF marker and the correct password', async () => {
    const h = await createHarness()
    try {
      const noCsrf = await h.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json' },
        payload: { password: 'test-password' },
      })
      expect(noCsrf.statusCode).toBe(403)

      const wrong = await h.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        headers: { 'content-type': 'application/json', 'x-myapi-csrf': '1' },
        payload: { password: 'nope' },
      })
      expect(wrong.statusCode).toBe(401)

      const cookie = await h.login()
      const session = await h.app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })
      expect(session.json()).toMatchObject({ authenticated: true })
    } finally {
      await h.close()
    }
  })

  it('creates, rotates and deletes a key', async () => {
    const h = await createHarness()
    try {
      const cookie = await h.login()
      const created = await h.app.inject({
        method: 'POST',
        url: '/api/keys',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { name: 'smoke', allowedModels: [], boundAccountId: null, rpm: 0 },
      })
      expect(created.statusCode).toBe(200)
      const payload = created.json() as { key: string; record: { id: string; prefix: string } }
      expect(payload.key.startsWith(API_KEY_PREFIX)).toBe(true)
      expect(payload.record.prefix).toBe(payload.key.slice(0, 14))

      const rotated = await h.app.inject({
        method: 'POST',
        url: `/api/keys/${payload.record.id}/rotate`,
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: {},
      })
      expect(rotated.statusCode).toBe(200)
      const rotatedPayload = rotated.json() as { key: string }
      expect(rotatedPayload.key).not.toBe(payload.key)

      const removed = await h.app.inject({
        method: 'DELETE',
        url: `/api/keys/${payload.record.id}`,
        headers: cookieHeader(cookie),
      })
      expect(removed.statusCode).toBe(200)
      expect(h.services.store.apiKeys).toHaveLength(0)
    } finally {
      await h.close()
    }
  })

  it('updates settings and refreshes the model catalog', async () => {
    const h = await createHarness()
    try {
      const cookie = await h.login()
      await h.addAccount()
      const settings = await h.app.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { autoCheckin: true, checkinHour: 7, catalogRefreshMinutes: 5 },
      })
      expect(settings.statusCode).toBe(200)
      expect(h.services.store.settings.autoCheckin).toBe(true)
      expect(h.services.store.settings.checkinHour).toBe(7)

      const models = await h.app.inject({
        method: 'POST',
        url: '/api/models/refresh',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: {},
      })
      expect(models.statusCode).toBe(200)
      expect((models.json() as { models: unknown[] }).models).toHaveLength(2)
    } finally {
      await h.close()
    }
  })

  it('imports a pasted account and a session file', async () => {
    const h = await createHarness()
    try {
      const cookie = await h.login()
      const pasted = await h.app.inject({
        method: 'POST',
        url: '/api/accounts/import',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { accountId: 'acc-file', token: 'tok', ssoSessionId: 'sso', uid: 'u1' },
      })
      expect(pasted.statusCode).toBe(200)

      const imported = await h.app.inject({
        method: 'POST',
        url: '/api/accounts/import-file',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: {
          configToml: 'experimental_bearer_token = "bearer-x"\nuid = "u2"\n',
          sessionJson: JSON.stringify({ accountId: 'acc-file2', token: 'tok2', ssoSessionId: 'sso2' }),
        },
      })
      expect(imported.statusCode).toBe(200)
      expect(h.services.store.accounts.length).toBe(2)

      const modelOnlyA = await h.app.inject({
        method: 'POST',
        url: '/api/accounts/import',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { modelBearerToken: 'bearer-a', name: '模型专用 A' },
      })
      const modelOnlyB = await h.app.inject({
        method: 'POST',
        url: '/api/accounts/import',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { modelBearerToken: 'bearer-b', name: '模型专用 B' },
      })
      const idA = (modelOnlyA.json() as { account: { id: string } }).account.id
      const idB = (modelOnlyB.json() as { account: { id: string } }).account.id
      expect(idA).not.toBe(idB)
      expect(h.services.store.accounts.length).toBe(4)
    } finally {
      await h.close()
    }
  })
})
