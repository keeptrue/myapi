import type { FastifyInstance } from 'fastify'
import type { CheckinResult, ImportAccountInput, ImportFileInput } from '../../shared/types.js'
import type { StoredAccount } from '../store/schema.js'
import type { Services } from '../services.js'
import { jsonError, requirePanel } from './helpers.js'

function pickModel(services: Services): string | undefined {
  const visible = services.catalog.visibleModels()
  return (visible.find(model => model.available) ?? visible[0])?.slug
}

export function registerAccountRoutes(app: FastifyInstance, services: Services): void {
  const panel = requirePanel(services.auth)

  app.get('/api/accounts', { preHandler: panel }, async () => {
    return { accounts: services.accounts.list() }
  })

  app.post('/api/accounts/import', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    try {
      const account = await services.accounts.importPaste(body as ImportAccountInput)
      return { account: services.accounts.toPublic(account) }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/accounts/import-file', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    try {
      const account = await services.accounts.importFile(body as ImportFileInput)
      return { account: services.accounts.toPublic(account) }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.patch('/api/accounts/:id', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const record = body as Record<string, unknown>
    const patch: Partial<StoredAccount> = {}
    if (typeof record['name'] === 'string' && record['name'].trim() !== '') patch['name'] = record['name'].trim()
    if (typeof record['domainAccount'] === 'string') patch['domainAccount'] = record['domainAccount'].trim()
    if (typeof record['enabled'] === 'boolean') patch['enabled'] = record['enabled']
    const updated = services.store.updateAccount(id, patch)
    if (updated === undefined) return jsonError(reply, 404, '账号不存在', 'not_found')
    return { account: services.accounts.toPublic(updated) }
  })

  app.delete('/api/accounts/:id', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    if (!services.store.removeAccount(id)) return jsonError(reply, 404, '账号不存在', 'not_found')
    return { ok: true }
  })

  app.post('/api/accounts/:id/refresh', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await services.accounts.refreshCredential(id)
      const account = await services.accounts.refreshStatus(id)
      return { account: services.accounts.toPublic(account) }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/accounts/:id/test', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = (request.body ?? {}) as Record<string, unknown>
    const model = typeof body['model'] === 'string' && body['model'] !== '' ? body['model'] : pickModel(services)
    if (model === undefined) return jsonError(reply, 400, '目录里没有可测试的模型，请先刷新模型目录')
    try {
      return { result: await services.accounts.test(id, model) }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/accounts/:id/checkin', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      return { result: await services.accounts.checkin(id) }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/accounts/checkin-all', { preHandler: panel }, async () => {
    const results: CheckinResult[] = []
    for (const account of services.store.accounts.filter(item => item.enabled && item.tokenEnc !== undefined)) {
      results.push(await services.accounts.checkin(account.id))
    }
    return { results }
  })

  app.post('/api/accounts/:id/keepalive', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      await services.accounts.keepalive(id)
      return { ok: true }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/accounts/:id/redeem', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const code = (body as Record<string, unknown>)['code']
    if (typeof code !== 'string' || code.trim() === '') return jsonError(reply, 400, '请输入兑换码')
    try {
      return { result: await services.accounts.redeem(id, code) }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.get('/api/accounts/:id/events', { preHandler: panel }, async (request) => {
    const { id } = request.params as { id: string }
    return { events: services.benefits.recent(300).filter(event => event.accountId === id) }
  })
}
