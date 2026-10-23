import { resolve } from 'node:path'
import {
  DEFAULT_CATALOG_REFRESH_MINUTES,
  DEFAULT_CLIENT_TYPE,
  DEFAULT_HOST,
  DEFAULT_IDLE_TIMEOUT_SECONDS,
  DEFAULT_LOG_MAX_ENTRIES,
  DEFAULT_LOG_RETENTION_DAYS,
  DEFAULT_MAX_CONCURRENCY,
  DEFAULT_PORT,
  DEFAULT_REQUEST_TIMEOUT_SECONDS,
  DEFAULT_STUDIO_VERSION,
  MODELS_BASE,
  MODELS_DEV_REFRESH_HOURS,
  MODELS_DEV_URL,
  REQUEST_BODY_LIMIT_MB,
  UPSTREAM_BASE,
  WORKSPACE_BASE,
} from '../shared/constants.js'
import type { Settings } from '../shared/types.js'

export interface AppConfig {
  host: string
  port: number
  dataDir: string
  secretKey?: string
  adminPassword?: string
  logLevel: string
  maxBodyMb: number
  maxConcurrency: number
  trustProxy: boolean
  upstreamBase: string
  modelsBase: string
  workspaceBase: string
  studioVersion: string
  clientType: string
}

/**
 * The upstream addresses and limits handed to provider adapters.
 *
 * Adapters receive this rather than `process.env`, so one implementation can run against a
 * different upstream without code changes, and so an adapter cannot bypass the gateway's
 * body-size or concurrency limits.
 */
export interface UpstreamConfig {
  upstreamBase: string
  modelsBase: string
  workspaceBase: string
  studioVersion: string
  clientType: string
  requestTimeoutSeconds: number
  maxBodyMb: number
  maxConcurrency: number
}

export function upstreamConfigFromSettings(settings: Settings): UpstreamConfig {
  return {
    upstreamBase: settings.upstreamBase,
    modelsBase: settings.modelsBase,
    workspaceBase: settings.workspaceBase,
    studioVersion: settings.studioVersion,
    clientType: settings.clientType,
    requestTimeoutSeconds: settings.requestTimeoutSeconds,
    maxBodyMb: settings.maxBodyMb,
    maxConcurrency: settings.maxConcurrency,
  }
}

function readArg(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  return argv[index + 1]
}

function numberArg(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

/** Load runtime configuration from CLI flags and environment variables. */
export function loadConfig(argv: readonly string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): AppConfig {
  const lan = argv.includes('--lan')
  const host = readArg(argv, '--host') ?? env['HOST'] ?? (lan ? '0.0.0.0' : DEFAULT_HOST)
  const port = numberArg(readArg(argv, '--port') ?? env['PORT'], DEFAULT_PORT)
  const dataDir = resolve(readArg(argv, '--data-dir') ?? env['MYAPI_DATA_DIR'] ?? './data')

  return {
    host,
    port,
    dataDir,
    ...(env['MYAPI_SECRET_KEY'] === undefined ? {} : { secretKey: env['MYAPI_SECRET_KEY'] }),
    ...(env['MYAPI_ADMIN_PASSWORD'] === undefined ? {} : { adminPassword: env['MYAPI_ADMIN_PASSWORD'] }),
    logLevel: env['MYAPI_LOG_LEVEL'] ?? 'info',
    maxBodyMb: numberArg(env['MYAPI_MAX_BODY_MB'], REQUEST_BODY_LIMIT_MB),
    maxConcurrency: numberArg(env['MYAPI_MAX_CONCURRENCY'], DEFAULT_MAX_CONCURRENCY),
    trustProxy: env['MYAPI_TRUST_PROXY'] === 'true' || env['MYAPI_TRUST_PROXY'] === '1',
    upstreamBase: env['MYAPI_UPSTREAM_BASE'] ?? UPSTREAM_BASE,
    modelsBase: env['MYAPI_MODELS_BASE'] ?? MODELS_BASE,
    workspaceBase: env['MYAPI_WORKSPACE_BASE'] ?? WORKSPACE_BASE,
    studioVersion: env['MYAPI_STUDIO_VERSION'] ?? DEFAULT_STUDIO_VERSION,
    clientType: env['MYAPI_CLIENT_TYPE'] ?? DEFAULT_CLIENT_TYPE,
  }
}

/** Default persisted settings; upstream overrides come from AppConfig at first boot. */
export function defaultSettings(config: AppConfig): Settings {
  return {
    upstreamBase: config.upstreamBase,
    modelsBase: config.modelsBase,
    workspaceBase: config.workspaceBase,
    studioVersion: config.studioVersion,
    clientType: config.clientType,
    requestTimeoutSeconds: DEFAULT_REQUEST_TIMEOUT_SECONDS,
    idleTimeoutSeconds: DEFAULT_IDLE_TIMEOUT_SECONDS,
    maxConcurrency: config.maxConcurrency,
    maxBodyMb: config.maxBodyMb,
    logRetentionDays: DEFAULT_LOG_RETENTION_DAYS,
    logMaxEntries: DEFAULT_LOG_MAX_ENTRIES,
    catalogRefreshMinutes: DEFAULT_CATALOG_REFRESH_MINUTES,
    corsOrigins: [],
    balanceAwareRotation: true,
    autoCheckin: false,
    checkinHour: 9,
    keepaliveMinutes: 0,
    checkinCompletePopups: true,
    checkinClaimDownload: true,
    checkinClaimBeta: true,
    modelsDevEnabled: true,
    modelsDevUrl: MODELS_DEV_URL,
    modelsDevRefreshHours: MODELS_DEV_REFRESH_HOURS,
  }
}
