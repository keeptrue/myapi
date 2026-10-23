import { describe, expect, it } from 'vitest'
import { cookieHeader, createHarness } from '../../helpers/harness.js'

describe('SMS login flow', () => {
  it('returns a GeeTest challenge, accepts the SMS payload and creates an account', async () => {
    const h = await createHarness()
    try {
      const cookie = await h.login()
      const geetest = await h.app.inject({
        method: 'GET',
        url: '/api/login/geetest',
        headers: cookieHeader(cookie),
      })
      expect(geetest.statusCode).toBe(200)
      expect((geetest.json() as { geetest: { gt: string } }).geetest.gt).toBe('gt-test')

      const sms = await h.app.inject({
        method: 'POST',
        url: '/api/login/sms',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: {
          mobile: '13800138000',
          geetest_challenge: 'c',
          geetest_validate: 'v',
          geetest_seccode: 's',
        },
      })
      expect(sms.statusCode).toBe(200)
      expect(h.fake.smsCalls).toBe(1)

      const verify = await h.app.inject({
        method: 'POST',
        url: '/api/login/verify',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { mobile: '13800138000', verify_code: '123456' },
      })
      expect(verify.statusCode).toBe(200)
      expect(h.fake.loginCalls).toBe(1)
      const body = verify.json() as { account: { accountId: string; sessionOk: boolean } }
      expect(body.account.accountId).toBe('account-1')
      expect(body.account.sessionOk).toBe(true)
      expect(h.services.store.accounts).toHaveLength(1)
    } finally {
      await h.close()
    }
  })
})
