import { PANEL_SESSION_TTL_SECONDS } from '../shared/constants.js'
import type { StoredApiKey } from './store/schema.js'
import type { StateStore } from './store/state.js'
import { apiKeyMatches, generateApiKey } from './crypto/apikey.js'
import { verifyPassword } from './crypto/password.js'
import { signSession, verifySession } from './crypto/session.js'

export type ApiKeyAuthResult =
  | { ok: true; key: StoredApiKey }
  | { ok: false; reason: 'no_keys' | 'invalid' | 'disabled' | 'rate' }

interface LoginAttempt {
  count: number
  resetAt: number
  failures: number
  lockedUntil: number
}

/** Panel password sessions, API-key authentication and login throttling. */
export class AuthService {
  private readonly attempts = new Map<string, LoginAttempt>()
  private readonly keyWindows = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly store: StateStore,
    private readonly masterKey: Buffer,
  ) {}

  loginAllowed(ip: string): boolean {
    const now = Date.now()
    const attempt = this.attempts.get(ip)
    if (attempt === undefined) return true
    if (attempt.lockedUntil > now) return false
    if (attempt.resetAt <= now) {
      this.attempts.delete(ip)
      return true
    }
    return attempt.count < 5
  }

  recordFailure(ip: string): void {
    const now = Date.now()
    const attempt = this.attempts.get(ip) ?? { count: 0, resetAt: now + 60_000, failures: 0, lockedUntil: 0 }
    attempt.count += 1
    attempt.failures += 1
    if (attempt.count >= 5) {
      attempt.lockedUntil = now + Math.min(60_000 * 2 ** Math.max(0, attempt.failures - 5), 15 * 60_000)
    }
    this.attempts.set(ip, attempt)
  }

  recordSuccess(ip: string): void {
    this.attempts.delete(ip)
  }

  checkPassword(password: string): boolean {
    return verifyPassword(password, this.store.passwordHash())
  }

  issueSession(): string {
    return signSession({
      v: 1,
      exp: Date.now() + PANEL_SESSION_TTL_SECONDS * 1000,
      av: this.store.authVersion(),
    }, this.masterKey)
  }

  verifyPanel(token: string | undefined): boolean {
    const session = verifySession(token, this.masterKey)
    return session !== undefined && session.av === this.store.authVersion()
  }

  authenticateApiKey(token: string): ApiKeyAuthResult {
    if (this.store.apiKeys.length === 0) return { ok: false, reason: 'no_keys' }
    const prefix = token.slice(0, 14)
    const key = this.store.apiKeys.find(item => item.enabled && item.prefix === prefix)
      ?? this.store.apiKeys.find(item => item.prefix === prefix)
    if (key === undefined || !apiKeyMatches(token, key.keyHmac, this.masterKey)) {
      return { ok: false, reason: 'invalid' }
    }
    if (!key.enabled) return { ok: false, reason: 'disabled' }
    if (key.rpm > 0) {
      const now = Date.now()
      const window = this.keyWindows.get(key.id)
      if (window === undefined || window.resetAt <= now) {
        this.keyWindows.set(key.id, { count: 1, resetAt: now + 60_000 })
      } else if (window.count >= key.rpm) {
        return { ok: false, reason: 'rate' }
      } else {
        window.count += 1
      }
    }
    this.store.updateApiKey(key.id, { lastUsedAt: Date.now() })
    return { ok: true, key }
  }

  createApiKey(input: { name: string; allowedModels: string[]; boundAccountId: string | null; rpm: number }): { key: string; record: StoredApiKey } {
    const generated = generateApiKey(this.masterKey)
    const now = Date.now()
    const record: StoredApiKey = {
      id: `key_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`,
      name: input.name.trim() === '' ? '未命名密钥' : input.name.trim(),
      prefix: generated.prefix,
      last4: generated.last4,
      keyHmac: generated.keyHmac,
      enabled: true,
      allowedModels: input.allowedModels,
      boundAccountId: input.boundAccountId,
      rpm: input.rpm,
      createdAt: now,
      lastUsedAt: 0,
    }
    this.store.addApiKey(record)
    return { key: generated.key, record }
  }

  rotateApiKey(id: string): { key: string; record: StoredApiKey } | undefined {
    const existing = this.store.apiKeys.find(item => item.id === id)
    if (existing === undefined) return undefined
    const generated = generateApiKey(this.masterKey)
    const record = this.store.updateApiKey(id, {
      prefix: generated.prefix,
      last4: generated.last4,
      keyHmac: generated.keyHmac,
      lastUsedAt: 0,
    })
    return record === undefined ? undefined : { key: generated.key, record }
  }
}
