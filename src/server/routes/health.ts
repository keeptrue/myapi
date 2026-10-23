import type { FastifyInstance } from 'fastify'
import { APP_VERSION } from '../../shared/constants.js'
import type { Services } from '../services.js'

export function registerHealthRoutes(app: FastifyInstance, services: Services): void {
  app.get('/healthz', async () => {
    const catalog = services.catalog.current
    return {
      ok: true,
      version: APP_VERSION,
      uptime: Math.floor(process.uptime()),
      accounts: services.store.accounts.length,
      accounts_ready: services.store.accounts.filter(account => account.enabled && account.cooldownUntil <= Date.now()).length,
      models: catalog.models.length,
      catalog_fetched_at: catalog.fetchedAt,
    }
  })

  app.get('/ping', async (_request, reply) => {
    return reply.type('text/plain; charset=utf-8').send('pong')
  })
}
