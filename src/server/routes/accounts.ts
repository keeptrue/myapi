import type { FastifyInstance } from 'fastify'
import type { CheckinResult } from '../../shared/providers.js'
import type { StoredAccount } from '../store/schema.js'
import type { Services } from '../services.js'
import type { LegacyImportFileInput, LegacyPasteInput } from '../providers/astudio/accounts.js'
import {
  checkinAccount,
  checkinAllAccounts,
  keepaliveAccount,
  refreshAccountCredential,
  testAccount,
} from '../account-ops.js'
import { jsonError, requirePanel } from './helpers.js'

function pickModel(services: Services): string | undefined {
  const visible = services.astudioCatalog.visibleModels()
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
      const account = await services.accounts.importPaste(body as LegacyPasteInput)
      return { account: services.accounts.toPublic(account) }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/accounts/import-file', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    try {
      const account = await services.accounts.importFile(body as LegacyImportFileInput)
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
    const name = typeof record['name'] === 'string' ? record['name'].trim() : ''
    const domainAccount = typeof record['domainAccount'] === 'string' ? record['domainAccount'].trim() : undefined
    const enabled = typeof record['enabled'] === 'boolean' ? record['enabled'] : undefined
    const updated = services.store.updateAccount(id, {
      ...(name !== '' ? { label: name } : {}),
      ...(enabled === undefined ? {} : { enabled }),
    })
    if (updated === undefined) return jsonError(reply, 404, '账号不存在', 'not_found')
    // domainAccount is adapter-owned state, so it lives in `profile` rather than the shell.
    if (domainAccount !== undefined) {
      const withProfile = services.store.updateProfile(id, { domainAccount })
      if (withProfile !== undefined) return { account: services.accounts.toPublic(withProfile) }
    }
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
      return { account: await refreshAccountCredential(services, id) }
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
      return { result: await testAccount(services, id, model) }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/accounts/:id/checkin', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      return { result: await checkinAccount(services, id) }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/accounts/checkin-all', { preHandler: panel }, async () => {
    return { results: await checkinAllAccounts(services) }
  })

  app.post('/api/accounts/:id/keepalive', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      return await keepaliveAccount(services, id)
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
