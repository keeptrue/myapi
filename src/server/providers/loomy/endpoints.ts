import { LOOMY_PROVIDER_ID } from '../ids.js'

/**
 * Loomy (讯飞) upstream addresses and the client-embedded signing pair.
 *
 * The values ship inside the Loomy desktop client's encrypted `.env.prod`; they are
 * client fingerprint constants, not user credentials. Every one can be overridden by
 * an environment variable so a change upstream never needs a rebuild.
 */

/** Account plane (CAccount) default base — `.env.prod` `VITE_XFYUN_BASE_URL`. */
export const DEFAULT_XFYUN_BASE_URL = 'https://account.xfinfr.com'

/** Integration gateway default base — `.env.prod` `LOOMY_POINTS_BASE_URL`.
 *  Points, the daily-login refresh and the model gateway all live under this host. */
export const DEFAULT_INTEGRATION_BASE_URL = 'https://loomyad.xunfei.cn'

/** Client-embedded AccessKeyId (`.env.prod` `VITE_XFYUN_ACCESS_KEY_ID`). */
export const DEFAULT_ACCESS_KEY_ID = '2thryby66wxi53sk'

/** Client-embedded AccessKeySecret (same `_SECRET`). */
export const DEFAULT_ACCESS_KEY_SECRET = 'zsak6eadrbawz683wf5r3m2snrwj868r'

/** Request envelope `base.appid` — the Loomy desktop client's fixed value. */
export const DEFAULT_APP_ID = 'GM3LOOMY'

/** Everything the Loomy adapter needs to talk to its upstream. Built once at service
 *  assembly time; the adapter itself never reads `process.env`. */
export interface LoomyConfig {
  xfyunBaseUrl: string
  integrationBaseUrl: string
  accessKeyId: string
  accessKeySecret: string
  appId: string
  requestTimeoutMs: number
}

function envOverride(name: string): string {
  const value = process.env[name]?.trim().replace(/\/+$/u, '') ?? ''
  return value === '' ? '' : value
}

function orDefault(value: string, fallback: string): string {
  return value === '' ? fallback : value
}

/** Read Loomy overrides from the environment; empty values fall back to the embedded defaults. */
export function loadLoomyConfigFromEnv(): LoomyConfig {
  return {
    xfyunBaseUrl: orDefault(envOverride('LOOMY_XFYUN_BASE_URL'), DEFAULT_XFYUN_BASE_URL),
    integrationBaseUrl: orDefault(envOverride('LOOMY_POINTS_BASE_URL'), DEFAULT_INTEGRATION_BASE_URL),
    accessKeyId: orDefault(envOverride('LOOMY_XFYUN_ACCESS_KEY_ID'), DEFAULT_ACCESS_KEY_ID),
    accessKeySecret: orDefault(envOverride('LOOMY_XFYUN_ACCESS_KEY_SECRET'), DEFAULT_ACCESS_KEY_SECRET),
    appId: orDefault(envOverride('LOOMY_XFYUN_APP_ID'), DEFAULT_APP_ID),
    requestTimeoutMs: 20_000,
  }
}

/** Model gateway base — the client splices it onto the points base (`/api/v1`). */
export function modelBaseUrl(config: LoomyConfig): string {
  return `${config.integrationBaseUrl}/api/v1`
}

export const LOOMY_DISPLAY_NAME = 'Loomy'
export const LOOMY_VENDOR = '科大讯飞'

/** Capability bits for Loomy, declared honestly: no renewal (14-day session, no refresh
 *  endpoint upstream), no desktop import, no OAuth, no benefit claiming beyond the
 *  daily points refresh that masquerades as check-in. */
export function loomyCapabilities() {
  return {
    smsLogin: true,
    webLogin: false,
    pasteCredential: true,
    importFromClient: false,
    tokenRenew: false,
    catalogRefresh: true,
    balanceQuery: true,
    checkin: true,
    benefits: false,
    keepalive: false,
  } as const
}

/** Session lifetime as reported by the login response (`expire` seconds → ms). */
export const LOOMY_SESSION_TTL_MS = 14 * 24 * 3600 * 1000

/** Warn the human one day before the estimated expiry: there is no renewal path. */
export const LOOMY_EXPIRY_MARGIN_MS = 24 * 3600 * 1000

export { LOOMY_PROVIDER_ID }
