import type {
  AccountDraft,
  AccountProfilePublic,
  AccountTestResult,
  BalanceSnapshot,
  ClaimItem,
  ClaimResult,
  CheckinResult,
  CredentialDescriptor,
  ImportInput,
  KeepaliveResult,
  ModelRecord,
  PasteInput,
  ProviderCapabilities,
  RedeemInput,
  RedeemResult,
  SmsSendInput,
  SmsVerifyInput,
  WebLoginCompleteInput,
  WebLoginSession,
} from '../../shared/providers.js'
import type { StoredAccount } from '../store/schema.js'
import type { UpstreamConfig } from '../config.js'

/**
 * Context handed to every adapter. Adapters must not read `process.env` directly —
 * configuration flows through here so the same adapter can run under different
 * upstreams without code changes.
 */
export interface AdapterContext {
  config: UpstreamConfig
  /** Aborts when the owning request is cancelled. */
  signal?: AbortSignal
}

/** One inference call, as the gateway sees it. */
export interface InferenceRequest {
  /** The account that was selected to serve this call; its credential session is the adapter's concern. */
  account: StoredAccount
  /** Upstream path, e.g. `/chat/completions`. */
  path: string
  /** The upstream model id to send. */
  model: string
  /** Parsed request body; the adapter owns its shape. */
  body: unknown
  signal: AbortSignal
}

/**
 * The single extension point of myapi.
 *
 * A provider adapter owns everything that is specific to one vendor: how a credential
 * is obtained, how it is renewed, what the model catalog looks like, whether the vendor
 * has check-in or benefit claiming, and how to render that state for a human.
 *
 * The gateway only ever touches the provider-agnostic fields of `StoredAccount`. Anything
 * vendor-specific stays inside the adapter and travels through `credentialsEnc` (secret)
 * or `profile` (non-secret).
 *
 * Implementations must degrade honestly: when an upstream call fails or a capability is
 * absent, return the failure rather than inventing a default.
 */
export interface ProviderAdapter {
  readonly id: string
  readonly displayName: string
  readonly vendor: string
  readonly capabilities: ProviderCapabilities

  // ---- Onboarding ----

  /** Fields the paste form should render for this provider. */
  credentialDescriptors(): CredentialDescriptor[]

  /** File pickers the import form should render. `field` keys into `ImportInput.files`. */
  importDescriptors(): { field: string; label: string; hint: string; accept: string }[]

  /** Send an SMS, after the caller has solved human verification in a browser. */
  sendSms?(input: SmsSendInput, context: AdapterContext): Promise<void>

  /** Complete an SMS login and produce an account draft. */
  verifySms?(input: SmsVerifyInput, context: AdapterContext): Promise<AccountDraft>

  /** Validate and accept pasted credentials. */
  addByPaste(input: PasteInput, context: AdapterContext): Promise<AccountDraft>

  /** Validate and accept credentials read from a locally installed client. */
  addByImport(input: ImportInput, context: AdapterContext): Promise<AccountDraft>

  /** Begin a browser authorization round-trip. */
  startWebLogin(context: AdapterContext): Promise<WebLoginSession>

  /** Finish a browser authorization round-trip, from either the callback or a pasted URL. */
  completeWebLogin(input: WebLoginCompleteInput, context: AdapterContext): Promise<AccountDraft>

  // ---- Lifecycle ----

  /**
   * Forward one inference request to this provider's upstream.
   *
   * Returns the raw upstream `Response` — the gateway handles streaming, retries and usage
   * extraction identically for every provider, so adapters only own the wire format.
   */
  inference(request: InferenceRequest, context: AdapterContext): Promise<Response>

  /** Exchange stored credentials for fresh ones. Must throw on failure. */
  refreshCredential(account: StoredAccount, context: AdapterContext): Promise<void>

  /**
   * Whether the stored credential must be renewed before it can serve a request.
   * Optional: adapters that always hold a valid token omit it and are never renewed here.
   */
  needsCredentialRefresh?(account: StoredAccount): boolean

  /**
   * Fetch this account's model catalog. Returns an empty array when the vendor exposes
   * nothing; the unified catalog keeps the previous snapshot on failure.
   */
  refreshCatalog(account: StoredAccount, context: AdapterContext): Promise<ModelRecord[]>

  queryBalance(account: StoredAccount, context: AdapterContext): Promise<BalanceSnapshot>

  checkin(account: StoredAccount, context: AdapterContext): Promise<CheckinResult>

  /** Items currently claimable for this account, rendered by the benefits page. */
  claimItems(account: StoredAccount, context: AdapterContext): Promise<ClaimItem[]>

  claim(account: StoredAccount, item: ClaimItem, context: AdapterContext): Promise<ClaimResult>

  redeem(input: RedeemInput, context: AdapterContext): Promise<RedeemResult>

  keepalive(account: StoredAccount, context: AdapterContext): Promise<KeepaliveResult>

  /** Round-trip a minimal chat request to prove the credential still works. */
  testConnection(account: StoredAccount, context: AdapterContext): Promise<AccountTestResult>

  // ---- Presentation ----

  /** Map the stored profile onto the normalised shape the console renders. */
  toPublicProfile(account: StoredAccount): AccountProfilePublic

  /** Whether this account can currently serve `model`. Defaults to "unknown, allow". */
  modelAvailable?(account: StoredAccount, model: string): boolean

  /**
   * Whether the account still has usable quota.
   *
   * The gateway uses this for balance-aware rotation and must not interpret vendor fields
   * itself, so the decision lives with the adapter that owns the numbers.
   */
  hasUsableBalance(account: StoredAccount): boolean
}
