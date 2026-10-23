import { describe, expect, it } from 'vitest'
import { parseAstronSession, parseConfigToml, sessionCookie, sessionValid } from '../../../src/server/providers/astudio/session.js'

describe('config.toml parsing', () => {
  it('reads the bearer and uid', () => {
    const parsed = parseConfigToml(`
[model_providers.astron-spark]
experimental_bearer_token = "abc:def"
uid = "user-1"
`)
    expect(parsed).toEqual({ bearer: 'abc:def', uid: 'user-1' })
  })

  it('tolerates missing fields', () => {
    expect(parseConfigToml('nothing here')).toEqual({ bearer: '', uid: '' })
  })
})

describe('astron-session.json parsing', () => {
  it('reads the full session shape', () => {
    const parsed = parseAstronSession(JSON.stringify({
      accountId: 'acc-1',
      uid: '100',
      token: 'tok',
      ssoSessionId: 'sso',
      modelBearerToken: 'bearer',
      mobile: '13800138000',
      nickname: 'n',
    }))
    expect(parsed.accountId).toBe('acc-1')
    expect(parsed.token).toBe('tok')
    expect(parsed.mobile).toBe('13800138000')
  })

  it('throws on malformed JSON', () => {
    expect(() => parseAstronSession('{')).toThrow(/valid JSON/u)
  })
})

describe('session cookie', () => {
  it('mirrors the desktop cookie header', () => {
    const cookie = sessionCookie({ accountId: 'a', token: 't', ssoSessionId: 's' })
    expect(cookie).toContain('ssoSessionId=s')
    expect(cookie).toContain('sso_sessionid=s')
    expect(cookie).toContain('account_id=a')
    expect(cookie).toContain('token=t')
  })

  it('requires accountId and token for a usable session', () => {
    expect(sessionValid({ accountId: 'a', token: 't' })).toBe(true)
    expect(sessionValid({ accountId: '', token: 't' })).toBe(false)
    expect(sessionValid({ accountId: 'a', token: '' })).toBe(false)
  })
})
