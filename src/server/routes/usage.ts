import type { FastifyInstance } from 'fastify'
import type { Services } from '../services.js'
import { accountLabel, numberField } from '../util.js'
import { jsonError, requirePanel } from './helpers.js'

function rangeOf(value: unknown): string {
  return typeof value === 'string' && ['24h', '7d', '30d', 'all'].includes(value) ? value : '24h'
}

export function registerUsageRoutes(app: FastifyInstance, services: Services): void {
  const panel = requirePanel(services.auth)

  app.get('/api/usage/summary', { preHandler: panel }, async (request) => {
    const query = request.query as Record<string, unknown>
    return services.usage.summary(rangeOf(query['range']))
  })

  app.get('/api/usage/timeseries', { preHandler: panel }, async (request) => {
    const query = request.query as Record<string, unknown>
    return { timeseries: services.usage.summary(rangeOf(query['range'])).timeseries }
  })

  app.get('/api/usage/by-model', { preHandler: panel }, async () => {
    return { byModel: services.usage.summary('all').byModel }
  })

  app.get('/api/usage/by-account', { preHandler: panel }, async () => {
    const summary = services.usage.summary('all')
    return {
      byAccount: summary.byAccount.map(item => {
        const account = services.store.account(item.key)
        return { ...item, name: account === undefined ? item.key : accountLabel(account) }
      }),
    }
  })

  app.get('/api/usage/by-key', { preHandler: panel }, async () => {
    const summary = services.usage.summary('all')
    return {
      byKey: summary.byKey.map(item => {
        const key = services.store.apiKeys.find(candidate => candidate.id === item.key)
        return { ...item, name: key?.name ?? item.key, prefix: key?.prefix ?? '' }
      }),
    }
  })

  app.get('/api/usage/recent', { preHandler: panel }, async (request) => {
    const query = request.query as Record<string, unknown>
    const limit = Math.min(Math.max(Number(query['limit'] ?? 50) || 50, 1), 500)
    return { entries: services.usage.recent(limit) }
  })

  app.get('/api/logs', { preHandler: panel }, async (request) => {
    const query = request.query as Record<string, unknown>
    const status = query['status'] === undefined || query['status'] === '' ? undefined : Number(query['status'])
    return services.logs.query({
      limit: Number(query['limit'] ?? 100) || 100,
      model: typeof query['model'] === 'string' ? query['model'] : undefined,
      accountId: typeof query['accountId'] === 'string' ? query['accountId'] : undefined,
      keyId: typeof query['keyId'] === 'string' ? query['keyId'] : undefined,
      ...(status === undefined || Number.isNaN(status) ? {} : { status }),
      from: Number(query['from'] ?? 0) || 0,
      to: Number(query['to'] ?? 0) || Number.MAX_SAFE_INTEGER,
    })
  })

  app.get('/api/logs/export', { preHandler: panel }, async (request, reply) => {
    const query = request.query as Record<string, unknown>
    const format = query['format'] === 'jsonl' ? 'jsonl' : 'csv'
    const body = await services.logs.export(format, {
      limit: 1000,
      model: typeof query['model'] === 'string' ? query['model'] : undefined,
      accountId: typeof query['accountId'] === 'string' ? query['accountId'] : undefined,
      from: Number(query['from'] ?? 0) || 0,
      to: Number(query['to'] ?? 0) || Number.MAX_SAFE_INTEGER,
    })
    reply
      .type(format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="myapi-logs.${format}"`)
      .send(body)
  })

  app.delete('/api/logs', { preHandler: panel }, async () => {
    await services.logs.clear()
    services.usage.reset()
    return { ok: true }
  })

  app.get('/api/benefits/summary', { preHandler: panel }, async () => {
    const accounts = services.store.accounts
    return {
      accounts: accounts.length,
      enabledAccounts: accounts.filter(account => account.enabled).length,
      generalPoints: accounts.reduce((sum, account) => sum + numberField(account.profile['pointsBalance']), 0),
      sparkPoints: accounts.reduce((sum, account) => sum + numberField(account.profile['sparkBalance']), 0),
      pendingPopups: accounts.reduce((sum, account) => sum + numberField(account.profile['pendingPopups']), 0),
      activePlans: accounts.filter(account => numberField(account.profile['planActive']) > 0).length,
      lastCheckinDay: services.store.scheduler.lastCheckinDay ?? '',
    }
  })

  app.get('/api/benefits/events', { preHandler: panel }, async (request) => {
    const query = request.query as Record<string, unknown>
    const limit = Math.min(Math.max(Number(query['limit'] ?? 100) || 100, 1), 500)
    const accountId = typeof query['accountId'] === 'string' ? query['accountId'] : ''
    const events = services.benefits.recent(500).filter(event => accountId === '' || event.accountId === accountId).slice(0, limit)
    return { events }
  })

  app.post('/api/benefits/checkin', { preHandler: panel }, async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    const accountId = typeof body['accountId'] === 'string' ? body['accountId'] : ''
    if (accountId !== '') {
      try {
        return { results: [await services.accounts.checkin(accountId)] }
      } catch (error: unknown) {
        return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
      }
    }
    const results = []
    for (const account of services.store.accounts.filter(item => item.enabled && item.credentialsEnc !== undefined)) {
      results.push(await services.accounts.checkin(account.id))
    }
    return { results }
  })
}
