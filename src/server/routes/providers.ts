import type { FastifyInstance } from 'fastify'
import type { ProviderCapabilities } from '../../shared/providers.js'
import type { Services } from '../services.js'
import { upstreamConfigFromSettings } from '../config.js'
import { toAccountPublic } from '../providers/public.js'
import { jsonError, requirePanel } from './helpers.js'

export interface ProviderDto {
  id: string
  displayName: string
  vendor: string
  capabilities: ProviderCapabilities
  /** Field descriptors for the paste-credential form; the console renders them verbatim. */
  credentialDescriptors: { field: string; label: string; hint: string; secret: boolean; required: boolean }[]
  accounts: number
  enabledAccounts: number
}

/**
 * Provider roster for the console, plus provider-dispatched onboarding endpoints.
 *
 * The console renders every action from the capability bits it gets here, so a provider that
 * cannot check in never shows a check-in button — and never silently pretends it can. The SMS
 * endpoints route through the registry so a provider-specific flow (GeeTest challenge, send
 * tickets) stays inside its adapter.
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
        credentialDescriptors: adapter.credentialDescriptors(),
        accounts: owned.length,
        enabledAccounts: owned.filter(account => account.enabled).length,
      }
    })
    return { providers }
  })

  app.post('/api/providers/:id/sms/send', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const record = body as Record<string, unknown>
    const mobile = typeof record['mobile'] === 'string' ? record['mobile'].trim() : ''
    const adapter = services.registry.get(id)
    if (adapter === undefined) return jsonError(reply, 404, `未知的提供商：${id}`)
    if (!adapter.capabilities.smsLogin || adapter.sendSms === undefined) {
      return jsonError(reply, 400, '该提供商不支持短信登录')
    }
    // Geetest triplets only exist for providers whose SMS sits behind human verification;
    // adapters that do not need one simply never read the field.
    const challenge = {
      geetest_challenge: typeof record['geetest_challenge'] === 'string' ? record['geetest_challenge'] : '',
      geetest_validate: typeof record['geetest_validate'] === 'string' ? record['geetest_validate'] : '',
      geetest_seccode: typeof record['geetest_seccode'] === 'string' ? record['geetest_seccode'] : '',
    }
    try {
      const result = await adapter.sendSms({ mobile, challenge }, { config: upstreamConfigFromSettings(services.store.settings) })
      return { ok: true, ticket: result.ticket }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error), 'sms_failed')
    }
  })

  app.post('/api/providers/:id/paste', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const record = body as Record<string, unknown>
    const fields: Record<string, string> = {}
    const rawFields = record['fields']
    if (typeof rawFields === 'object' && rawFields !== null) {
      for (const [field, value] of Object.entries(rawFields as Record<string, unknown>)) {
        if (typeof value === 'string') fields[field] = value
      }
    }
    const label = typeof record['label'] === 'string' ? record['label'].trim() : undefined
    const adapter = services.registry.get(id)
    if (adapter === undefined) return jsonError(reply, 404, `未知的提供商：${id}`)
    if (!adapter.capabilities.pasteCredential) return jsonError(reply, 400, '该提供商不支持粘贴凭据')
    try {
      const draft = await adapter.addByPaste({ providerId: id, fields, label }, { config: upstreamConfigFromSettings(services.store.settings) })
      const account = services.store.upsertDraft({ ...draft, label: label !== undefined && label !== '' ? label : draft.label })
      return { account: toAccountPublic(services, account), is_new: true }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error))
    }
  })

  app.post('/api/providers/:id/sms/verify', { preHandler: panel }, async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const record = body as Record<string, unknown>
    const mobile = typeof record['mobile'] === 'string' ? record['mobile'].trim() : ''
    const code = typeof record['code'] === 'string' ? record['code'].trim() : ''
    const ticket = typeof record['ticket'] === 'string' ? record['ticket'].trim() : ''
    const label = typeof record['label'] === 'string' ? record['label'].trim() : undefined
    const adapter = services.registry.get(id)
    if (adapter === undefined) return jsonError(reply, 404, `未知的提供商：${id}`)
    if (!adapter.capabilities.smsLogin || adapter.verifySms === undefined) {
      return jsonError(reply, 400, '该提供商不支持短信登录')
    }
    try {
      const draft = await adapter.verifySms({ mobile, code, ticket: ticket === '' ? undefined : ticket }, { config: upstreamConfigFromSettings(services.store.settings) })
      const account = services.store.upsertDraft({ ...draft, label: label !== undefined && label !== '' ? label : draft.label })
      return { account: toAccountPublic(services, account), is_new: true }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error), 'login_failed')
    }
  })
}
