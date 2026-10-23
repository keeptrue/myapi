import { randomBytes } from 'node:crypto'

export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export interface OauthState {
  stateId: string
  providerId: string
  createdAt: number
  /** A state is consumed exactly once, even if the provider retries the redirect. */
  used: boolean
  expiresAt: number
  result?: { label: string }
  error?: string
}

/**
 * In-memory registry of pending browser authorization round-trips.
 *
 * States are short-lived by design — a pending login should never outlive the process, so this
 * deliberately does not touch the persisted state document. Each state is single-use and bound
 * to the provider that created it, which is what makes the unauthenticated callback route safe.
 */
export class OauthStore {
  private readonly states = new Map<string, OauthState>()

  create(providerId: string): OauthState {
    const now = Date.now()
    const state: OauthState = {
      stateId: randomBytes(24).toString('hex'),
      providerId,
      createdAt: now,
      used: false,
      expiresAt: now + OAUTH_STATE_TTL_MS,
    }
    this.states.set(state.stateId, state)
    this.sweep(now)
    return state
  }

  get(stateId: string): OauthState | undefined {
    return this.states.get(stateId)
  }

  /** Consume a state. Returns undefined when it was already used, unknown or expired. */
  consume(stateId: string): OauthState | undefined {
    const now = Date.now()
    const state = this.states.get(stateId)
    if (state === undefined) return undefined
    if (state.used || state.expiresAt <= now) {
      this.states.delete(stateId)
      return undefined
    }
    state.used = true
    return state
  }

  settle(stateId: string, result: { label: string }): void {
    const state = this.states.get(stateId)
    if (state === undefined) return
    state.result = result
  }

  fail(stateId: string, message: string): void {
    const state = this.states.get(stateId)
    if (state === undefined) return
    state.error = message
  }

  status(stateId: string): OauthState | undefined {
    const state = this.states.get(stateId)
    if (state === undefined) return undefined
    if (state.expiresAt <= Date.now()) {
      this.states.delete(stateId)
      return undefined
    }
    return state
  }

  private sweep(now: number): void {
    for (const [id, state] of this.states) {
      if (state.expiresAt <= now) this.states.delete(id)
    }
  }
}

/** The callback must only be reachable from this machine, never from the open internet. */
export function isLoopback(ip: string): boolean {
  const host = ip.replace(/^::ffff:/u, '')
  return host === '127.0.0.1' || host === '::1' || host === 'localhost'
}
