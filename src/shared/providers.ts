/**
 * Provider-agnostic types shared by the gateway, every adapter and the console.
 *
 * Nothing in here may describe a specific vendor. Vendor-specific shapes belong to the
 * adapter that owns them and live inside `StoredAccount.credentialsEnc` (secret) or
 * `StoredAccount.profile` (non-secret).
 */

/** How an account's credential originally entered the gateway. */
export type CredentialKind = 'sms' | 'paste' | 'client-import' | 'web-oauth' | 'bearer-only'

/**
 * Capability flags an adapter declares about itself. The console renders actions from
 * these bits; the scheduler skips work for flags that are false. An adapter must never
 * claim a capability it cannot actually perform.
 */
export interface ProviderCapabilities {
  /** Phone-number + human-verification login flow. */
  smsLogin: boolean
  /** Browser authorization round-trip, captured through a local callback. */
  webLogin: boolean
  /** Accept a pasted token string directly. */
  pasteCredential: boolean
  /** Read a credential file out of a locally installed client. */
  importFromClient: boolean
  /** Automatically exchange a stored credential for a fresh one. */
  tokenRenew: boolean
  /** Fetch the model catalog from upstream. */
  catalogRefresh: boolean
  /** Report quota / balance. */
  balanceQuery: boolean
  /** Daily check-in or equivalent quota claim. */
  checkin: boolean
  /** Membership, popups, redeem codes, or other benefit claiming. */
  benefits: boolean
  /** Periodic keep-alive ping so the login state does not expire. */
  keepalive: boolean
}

export function emptyCapabilities(): ProviderCapabilities {
  return {
    smsLogin: false,
    webLogin: false,
    pasteCredential: false,
    importFromClient: false,
    tokenRenew: false,
    catalogRefresh: false,
    balanceQuery: false,
    checkin: false,
    benefits: false,
    keepalive: false,
  }
}

/** One quota line shown on an account row and on the benefits page. */
export interface AccountBalancePublic {
  key: string
  label: string
  value: number
  unit: string
  known: boolean
}

export interface AccountPlanPublic {
  code: string
  name: string
  active: boolean
}

/**
 * Normalised, non-secret view of an account's vendor-specific state.
 * Adapters map their own fields onto this shape so the console never hardcodes vendor terms.
 */
export interface AccountProfilePublic {
  nickname: string
  mobileMasked: string
  balances: AccountBalancePublic[]
  plans: AccountPlanPublic[]
  pendingClaims: number
  lastCheckedAt: number
  lastClaimAt: number
  extra: Record<string, unknown>
}

/** Describes one field of a paste / import form without leaking vendor vocabulary. */
export interface CredentialDescriptor {
  field: string
  label: string
  hint: string
  secret: boolean
  required: boolean
}

/** One model as reported by one adapter. */
export interface ModelRecord {
  /** Normalised model name. Never prefixed with the provider id. */
  name: string
  providerId: string
  /** The model id the upstream actually expects in the request body. */
  upstreamSlug: string
  displayName: string
  contextWindow: number
  maxOutputTokens: number
  reasoningEfforts: string[]
  inputModalities: string[]
  canDisableThinking: boolean
  available: boolean
  priority: number
  /** Vendor-specific extras, opaque to the gateway. */
  extra: Record<string, unknown>
}

export interface BalanceSnapshot {
  known: boolean
  balances: AccountBalancePublic[]
  fetchedAt: number
}

export interface CheckinDelta {
  key: string
  label: string
  value: number
}

export interface CheckinResult {
  ok: boolean
  error: string
  deltas: CheckinDelta[]
  actions: string[]
  at: number
}

export type ClaimKind = 'popup' | 'download' | 'beta' | 'redeem'

export interface ClaimItem {
  id: string
  label: string
  kind: ClaimKind
}

export interface ClaimResult {
  id: string
  label: string
  kind: ClaimKind
  ok: boolean
  message: string
}

export interface KeepaliveResult {
  ok: boolean
  message: string
  at: number
}

export interface RedeemResult {
  ok: boolean
  message: string
  deltas: CheckinDelta[]
  at: number
}

export interface AccountTestResult {
  ok: boolean
  model?: string
  latencyMs: number
  message: string
}

/** What an adapter returns after a successful onboarding flow, before the store encrypts it. */
export interface AccountDraft {
  providerId: string
  label: string
  credentialKind: CredentialKind
  /** Field name → value. Adapter-defined; stored as one AES-256-GCM blob. */
  credentials: Record<string, string>
  /** Non-secret vendor state, stored verbatim. */
  profile: Record<string, unknown>
  nickname: string
  mobileMasked: string
}

/** Result of starting a browser authorization round-trip. */
export interface WebLoginSession {
  stateId: string
  providerId: string
  authorizeUrl: string
  /** Where the provider will redirect back to. */
  redirectUri: string
  hint: string
  expiresAt: number
}

/** GeeTest triplet required before an SMS can be sent. Solved by a human in a browser. */
export interface SmsChallenge {
  geetest_challenge: string
  geetest_validate: string
  geetest_seccode: string
}

export interface SmsSendInput {
  mobile: string
  /** Present only for providers whose SMS flow sits behind human verification. */
  challenge?: SmsChallenge
}

/** Result of sending an SMS login code. `ticket` carries any opaque send-session id the
 *  verify step must echo back (e.g. an upstream message id); absent when the provider
 *  correlates the pair by phone number alone. */
export interface SmsSendResult {
  ticket?: string
}

export interface SmsVerifyInput {
  mobile: string
  code: string
  /** The `ticket` returned by `sendSms`, when that provider issued one. */
  ticket?: string
}

export interface PasteInput {
  providerId: string
  /** Field name → value, validated against the adapter's credential descriptors. */
  fields: Record<string, string>
  label?: string
}

export interface ImportInput {
  providerId: string
  /** Raw file contents, read locally by the browser and posted to the gateway. */
  files: { field: string; name: string; content: string }[]
  label?: string
}

export interface WebLoginCompleteInput {
  providerId: string
  stateId: string
  /** Full callback URL, used by the manual paste fallback. */
  callbackUrl?: string
}

export interface WebLoginPending {
  stateId: string
  providerId: string
  status: 'pending' | 'done' | 'expired' | 'error'
  message: string
}

export interface RedeemInput {
  providerId: string
  accountId: string
  code: string
}
