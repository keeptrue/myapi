import type { FastifyInstance } from 'fastify'
import type { Settings } from '../../shared/types.js'
import type { Services } from '../services.js'
import { jsonError, requirePanel, parsePositiveInt, stringList } from './helpers.js'

const RESTART_FIELDS = ['upstreamBase', 'modelsBase', 'workspaceBase', 'studioVersion', 'clientType', 'maxBodyMb', 'maxConcurrency', 'logRetentionDays', 'logMaxEntries']

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || value.trim() === '') return false
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function applyPatch(current: Settings, body: Record<string, unknown>, reply: import('fastify').FastifyReply): Settings | undefined {
  const next: Settings = { ...current }
  for (const field of ['upstreamBase', 'modelsBase', 'workspaceBase', 'modelsDevUrl'] as const) {
    if (body[field] === undefined) continue
    if (!isHttpUrl(body[field])) {
      jsonError(reply, 400, `${field} 必须是 http(s) URL`)
      return undefined
    }
    next[field] = String(body[field]).replace(/\/+$/u, '')
  }
  if (body['studioVersion'] !== undefined) {
    if (typeof body['studioVersion'] !== 'string' || body['studioVersion'].trim() === '') {
      jsonError(reply, 400, 'studioVersion 不能为空')
      return undefined
    }
    next.studioVersion = body['studioVersion'].trim()
  }
  if (body['clientType'] !== undefined) {
    if (typeof body['clientType'] !== 'string' || body['clientType'].trim() === '') {
      jsonError(reply, 400, 'clientType 不能为空')
      return undefined
    }
    next.clientType = body['clientType'].trim()
  }
  const numbers: Array<[keyof Settings, number, number]> = [
    ['requestTimeoutSeconds', 10, 3600],
    ['idleTimeoutSeconds', 10, 3600],
    ['maxConcurrency', 1, 64],
    ['maxBodyMb', 1, 256],
    ['logRetentionDays', 1, 365],
    ['logMaxEntries', 100, 100_000],
    ['catalogRefreshMinutes', 1, 1440],
    ['modelsDevRefreshHours', 1, 720],
    ['checkinHour', 0, 23],
    ['keepaliveMinutes', 0, 1440],
  ]
  for (const [field, min, max] of numbers) {
    if (body[field] === undefined) continue
    const value = parsePositiveInt(body[field], Number(current[field]), min, max)
    next[field] = value as never
  }
  for (const field of ['balanceAwareRotation', 'autoCheckin', 'checkinCompletePopups', 'checkinClaimDownload', 'checkinClaimBeta', 'modelsDevEnabled'] as const) {
    if (body[field] === undefined) continue
    if (typeof body[field] !== 'boolean') {
      jsonError(reply, 400, `${field} 必须是布尔值`)
      return undefined
    }
    next[field] = body[field] as boolean
  }
  if (body['corsOrigins'] !== undefined) {
    if (!Array.isArray(body['corsOrigins'])) {
      jsonError(reply, 400, 'corsOrigins 必须是字符串数组')
      return undefined
    }
    next.corsOrigins = stringList(body['corsOrigins'])
  }
  return next
}

export function registerSettingsRoutes(app: FastifyInstance, services: Services): void {
  const panel = requirePanel(services.auth)

  app.get('/api/settings', { preHandler: panel }, async () => {
    return {
      settings: services.store.settings,
      aliases: services.store.aliases,
      restartFields: RESTART_FIELDS,
    }
  })

  app.put('/api/settings', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const previous = services.store.settings
    const changed = applyPatch(previous, body as Record<string, unknown>, reply)
    if (changed === undefined) return reply
    const settings = services.store.setSettings(changed)
    services.modelsDev.onSettingsChanged(previous, settings)
    return {
      settings,
      restartFields: RESTART_FIELDS,
      needsRestart: RESTART_FIELDS.some(field => JSON.stringify((settings as unknown as Record<string, unknown>)[field]) !== JSON.stringify((services.store.settings as unknown as Record<string, unknown>)[field])),
    }
  })
}
