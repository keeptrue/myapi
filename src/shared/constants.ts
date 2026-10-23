/** Shared constants used by both the gateway and the web console. */

export const APP_NAME = 'myapi'
export const APP_VERSION = '0.1.0'

export const DEFAULT_PORT = 8787
export const DEFAULT_HOST = '127.0.0.1'

export const UPSTREAM_BASE = 'https://maas-api.cn-huabei-1.xf-yun.com/v1'
export const MODELS_BASE = 'https://astronstudio-api-volces-prod.xf-yun.com/api/v1/model-manager'
export const WORKSPACE_BASE = 'https://agent.xfyun.cn/xingchen-studio'
export const DEFAULT_STUDIO_VERSION = '3.4.4'
export const DEFAULT_CLIENT_TYPE = '22'

export const PANEL_COOKIE = 'myapi_panel'
export const PANEL_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7
export const CSRF_HEADER = 'x-myapi-csrf'

export const API_KEY_PREFIX = 'sk-myapi-'
export const API_KEY_PREFIX_DISPLAY_LENGTH = 14

export const REQUEST_BODY_LIMIT_MB = 32
export const CATALOG_MODEL_TOKEN_LIMIT = 16 * 1024 * 1024
export const WORKSPACE_RESPONSE_LIMIT = 4 * 1024 * 1024
export const PROBE_TTL_MS = 7 * 24 * 60 * 60 * 1000
export const PROBE_TIMEOUT_MS = 30_000
export const PROBE_DEFAULT_MAX_TOKENS = 512
export const PROBE_MAX_TOKENS = 4096
export const PROBE_MAX_MESSAGE_CHARS = 4000
export const PROBE_MAX_ACCOUNTS = 3
export const PROBE_RESPONSE_LIMIT = 2 * 1024 * 1024
export const PROBE_PREVIEW_CHARS = 500
export const PROBE_MAX_RECORDS = 1000

export const MODELS_DEV_URL = 'https://models.dev/api.json'
export const MODELS_DEV_TIMEOUT_MS = 180_000
export const MODELS_DEV_RESPONSE_LIMIT = 32 * 1024 * 1024
export const MODELS_DEV_REFRESH_HOURS = 24
export const MODELS_DEV_RETRY_MS = 15 * 60 * 1000

export const POINTS_CACHE_MS = 30_000
export const DEFAULT_CATALOG_REFRESH_MINUTES = 10
export const DEFAULT_REQUEST_TIMEOUT_SECONDS = 300
export const DEFAULT_IDLE_TIMEOUT_SECONDS = 300
export const DEFAULT_MAX_CONCURRENCY = 8
export const DEFAULT_LOG_RETENTION_DAYS = 30
export const DEFAULT_LOG_MAX_ENTRIES = 5000
export const MAX_ACCOUNT_COOLDOWN_SECONDS = 300
export const FAILOVER_ATTEMPTS = 3

export const GATEWAY_REASONS = {
  noApiKey: 'no_api_key_configured',
  invalidApiKey: 'invalid_api_key',
  noAccount: 'no_upstream_account',
  allCooling: 'all_accounts_cooling',
  modelNotAllowed: 'model_not_allowed',
  rateLimited: 'rate_limited',
  overloaded: 'gateway_overloaded',
  upstream: 'upstream_error',
} as const
