import type { AstronSession } from './types.js'

function stringValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** Read `experimental_bearer_token` and `uid` from AStudio's config.toml. */
export function parseConfigToml(text: string): { bearer: string; uid: string } {
  const bearer = /experimental_bearer_token\s*=\s*["']([^"']+)["']/u.exec(text)?.[1]?.trim() ?? ''
  const uid = /^\s*uid\s*=\s*["']([^"']+)["']/mu.exec(text)?.[1]?.trim() ?? ''
  return { bearer, uid }
}

/** Parse AStudio's astron-session.json into the session shape used upstream. */
export function parseAstronSession(text: string): Partial<AstronSession> & { mobile: string; nickname: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('astron-session.json is not valid JSON')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('astron-session.json must contain an object')
  }
  const record = parsed as Record<string, unknown>
  return {
    accountId: stringValue(record['accountId'] ?? record['account_id']),
    uid: stringValue(record['uid']),
    token: stringValue(record['token']),
    ssoSessionId: stringValue(record['ssoSessionId'] ?? record['sso_session_id']),
    modelBearerToken: stringValue(record['modelBearerToken'] ?? record['model_bearer_token']),
    mobile: stringValue(record['mobile'] ?? record['phone']),
    nickname: stringValue(record['nickname'] ?? record['displayName']),
  }
}

/** Build the cookie header the desktop client sends to the workspace API. */
export function sessionCookie(session: Pick<AstronSession, 'accountId' | 'token' | 'ssoSessionId'>): string {
  const parts: string[] = []
  if (session.ssoSessionId !== '') {
    parts.push(`ssoSessionId=${session.ssoSessionId}`, `sso_sessionid=${session.ssoSessionId}`)
  }
  if (session.accountId !== '') parts.push(`account_id=${session.accountId}`)
  if (session.token !== '') parts.push(`token=${session.token}`)
  return parts.join('; ')
}

export function sessionValid(session: Pick<AstronSession, 'accountId' | 'token'> | Partial<AstronSession>): boolean {
  return typeof session.accountId === 'string' && session.accountId !== ''
    && typeof session.token === 'string' && session.token !== ''
}
