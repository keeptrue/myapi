import type { FastifyInstance } from 'fastify'
import type { ProviderCapabilities } from '../../shared/providers.js'
import type { Services } from '../services.js'
import { requirePanel } from './helpers.js'

export interface ProviderDto {
  id: string
  displayName: string
  vendor: string
  capabilities: ProviderCapabilities
  accounts: number
  enabledAccounts: number
}

/**
 * Provider roster for the console.
 *
 * The console renders every action from the capability bits it gets here, so a provider that
 * cannot check in never shows a check-in button — and never silently pretends it can.
 */
export function registerProviderRoutes(app: FastifyInstance, services: Services): void {
  const panel = requirePanel(services.auth)

  app.get('/api/providers', { preHandler: panel }, async () => {
    const accounts = services.store.accounts
    const providers: ProviderDto[] = services.registry.all().map(adapter => {
      const owned = accounts.filter(account => account.providerId === adapter.id)
      return {
        id: adapter.id,
        displayName: adapter.displayName,
        vendor: adapter.vendor,
        capabilities: adapter.capabilities,
        accounts: owned.length,
        enabledAccounts: owned.filter(account => account.enabled).length,
      }
    })
    return { providers }
  })
}
