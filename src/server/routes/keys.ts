import type { FastifyInstance } from 'fastify'
import type { ApiKeyPublic } from '../../shared/types.js'
import type { StoredApiKey } from '../store/schema.js'
import type { Services } from '../services.js'
import { jsonError, requirePanel, parsePositiveInt, stringList } from './helpers.js'

function publicKey(record: StoredApiKey): ApiKeyPublic {
  const { keyHmac: _keyHmac, ...rest } = record
  return rest
}

function validateBinding(services: Services, value: unknown): string | null | undefined {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') return undefined
  return services.store.account(value) === undefined ? undefined : value
}

export function registerKeyRoutes(app: FastifyInstance, services: Services): void {
  const panel = requirePanel(services.auth)

  app.get('/api/keys', { preHandler: panel }, async () => {
    return { keys: services.store.publicApiKeys() }
  })

  app.post('/api/keys', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const record = body as Record<string, unknown>
    const bound = validateBinding(services, record['boundAccountId'])
    if (bound === undefined) return jsonError(reply, 400, '绑定账号不存在')
    const created = services.auth.createApiKey({
      name: typeof record['name'] === 'string' ? record['name'] : '默认密钥',
      allowedModels: stringList(record['allowedModels']),
      boundAccountId: bound,
      rpm: parsePositiveInt(record['rpm'], 0, 0, 6000),
    })
    return { key: created.key, record: publicKey(created.record) }
  })

  app.patch('/api/keys/:id', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const record = body as Record<string, unknown>
    const patch: Partial<StoredApiKey> = {}
    if (typeof record['name'] === 'string' && record['name'].trim() !== '') patch.name = record['name'].trim()
    if (typeof record['enabled'] === 'boolean') patch.enabled = record['enabled']
    if (Array.isArray(record['allowedModels'])) patch.allowedModels = stringList(record['allowedModels'])
    if (record['boundAccountId'] !== undefined) {
      const bound = validateBinding(services, record['boundAccountId'])
      if (bound === undefined) return jsonError(reply, 400, '绑定账号不存在')
      patch.boundAccountId = bound
    }
    if (record['rpm'] !== undefined) patch.rpm = parsePositiveInt(record['rpm'], 0, 0, 6000)
    const updated = services.store.updateApiKey(id, patch)
    if (updated === undefined) return jsonError(reply, 404, '密钥不存在', 'not_found')
    return { record: publicKey(updated) }
  })

  app.delete('/api/keys/:id', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!services.store.removeApiKey(id)) return jsonError(reply, 404, '密钥不存在', 'not_found')
    return { ok: true }
  })

  app.post('/api/keys/:id/rotate', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const rotated = services.auth.rotateApiKey(id)
    if (rotated === undefined) return jsonError(reply, 404, '密钥不存在', 'not_found')
    return { key: rotated.key, record: publicKey(rotated.record) }
  })
}
