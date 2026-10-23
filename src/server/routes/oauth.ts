import type { FastifyInstance } from 'fastify'
import { OAUTH_STATE_TTL_MS, isLoopback } from '../providers/oauth.js'
import { upstreamConfigFromSettings } from '../config.js'
import { toAccountPublic } from '../providers/public.js'
import type { Services } from '../services.js'
import { clientIp, jsonError, requirePanel } from './helpers.js'

/**
 * Browser authorization round-trips.
 *
 * The callback route is intentionally unauthenticated — there is no panel session to carry into
 * a redirect that starts in a different browser context. Safety comes from the state token
 * instead: it is random, single-use, bound to the provider that created it, short-lived, and the
 * callback only accepts a loopback source.
 *
 * The callback hangs off the main app and port rather than a separate listener. Providers require
 * a redirect URI to be registered ahead of time, so a stable same-port path is more usable than a
 * random per-startup port.
 */

function redirectUriFor(services: Services): string {
  const host = services.config.host === '0.0.0.0' || services.config.host === '' ? '127.0.0.1' : services.config.host
  return `http://${host}:${services.config.port}/oauth/callback`
}

function panelRedirect(stateId: string, status: string): string {
  return `/oauth?state=${encodeURIComponent(stateId)}&status=${status}`
}

function adapterContext(services: Services) {
  return { config: upstreamConfigFromSettings(services.store.settings) }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function registerOauthRoutes(app: FastifyInstance, services: Services): void {
  const oauth = services.oauth
  const panel = requirePanel(services.auth)

  app.get('/api/oauth/status', { preHandler: panel }, async () => {
    return { redirectUri: redirectUriFor(services), ttlSeconds: OAUTH_STATE_TTL_MS / 1000 }
  })

  app.post('/api/oauth/start', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const providerId = (body as Record<string, unknown>)['providerId']
    if (typeof providerId !== 'string' || providerId.trim() === '') return jsonError(reply, 400, '请选择提供商')
    const adapter = services.registry.get(providerId.trim())
    if (adapter === undefined) return jsonError(reply, 400, `未知的提供商：${providerId}`)
    if (!adapter.capabilities.webLogin) {
      return jsonError(reply, 400, `${adapter.displayName} 不支持网页授权登录`)
    }

    const state = oauth.create(adapter.id)
    let session
    try {
      session = await adapter.startWebLogin({ stateId: state.stateId, redirectUri: redirectUriFor(services) }, adapterContext(services))
    } catch (error: unknown) {
      oauth.fail(state.stateId, messageOf(error))
      return jsonError(reply, 400, messageOf(error))
    }
    return {
      stateId: state.stateId,
      authorizeUrl: session.authorizeUrl,
      redirectUri: session.redirectUri,
      hint: session.hint,
      expiresAt: state.expiresAt,
    }
  })

  app.get('/api/oauth/pending/:stateId', { preHandler: panel }, async (request) => {
    const { stateId } = request.params as { stateId: string }
    const state = oauth.status(stateId)
    if (state === undefined) return { status: 'expired' as const, message: '授权已过期或不存在，请重新发起' }
    if (state.result !== undefined) return { status: 'done' as const, message: '授权完成', label: state.result.label }
    if (state.error !== undefined) return { status: 'error' as const, message: state.error }
    return { status: 'pending' as const, message: '等待浏览器完成授权' }
  })

  /** Manual fallback: the human pastes the callback URL they were redirected to. */
  app.post('/api/oauth/exchange', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const record = body as Record<string, unknown>
    const providerId = record['providerId']
    const stateId = record['stateId']
    const callbackUrl = record['callbackUrl']
    if (typeof providerId !== 'string' || typeof stateId !== 'string' || typeof callbackUrl !== 'string') {
      return jsonError(reply, 400, 'providerId / stateId / callbackUrl 都是必填')
    }
    const state = oauth.consume(stateId)
    if (state === undefined) return jsonError(reply, 400, '授权已过期、已使用或不存在')
    if (state.providerId !== providerId) return jsonError(reply, 400, 'state 与提供商不匹配')
    const adapter = services.registry.get(providerId)
    if (adapter === undefined) return jsonError(reply, 400, `未知的提供商：${providerId}`)
    try {
      const draft = await adapter.completeWebLogin({ providerId, stateId, callbackUrl }, adapterContext(services))
      const account = services.store.upsertDraft(draft)
      oauth.settle(stateId, { label: account.label })
      return { ok: true, account: toAccountPublic(services, account), message: '授权完成' }
    } catch (error: unknown) {
      oauth.fail(stateId, messageOf(error))
      return jsonError(reply, 400, messageOf(error))
    }
  })

  /** The provider's redirect target. No panel session; the state token is the guard. */
  app.get('/oauth/callback', async (request, reply) => {
    const origin = `http://${request.headers.host ?? '127.0.0.1'}`
    const url = new URL(request.url, origin)
    const stateId = url.searchParams.get('state') ?? ''

    if (!isLoopback(clientIp(request))) {
      return reply.code(403).type('text/plain; charset=utf-8').send('回调地址只接受本机访问')
    }
    if (stateId === '') return reply.redirect(panelRedirect('', 'error'))

    const state = oauth.consume(stateId)
    if (state === undefined) return reply.redirect(panelRedirect(stateId, 'expired'))

    const adapter = services.registry.get(state.providerId)
    if (adapter === undefined) {
      oauth.fail(stateId, '提供商已移除')
      return reply.redirect(panelRedirect(stateId, 'error'))
    }
    try {
      const draft = await adapter.completeWebLogin(
        { providerId: state.providerId, stateId, callbackUrl: url.toString() },
        adapterContext(services),
      )
      const account = services.store.upsertDraft(draft)
      oauth.settle(stateId, { label: account.label })
      return reply.redirect(panelRedirect(stateId, 'ok'))
    } catch (error: unknown) {
      oauth.fail(stateId, messageOf(error))
      return reply.redirect(panelRedirect(stateId, 'error'))
    }
  })
}
