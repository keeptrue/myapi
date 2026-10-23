import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomId } from '../util.js'
import type { Services } from '../services.js'
import type { StoredApiKey } from '../store/schema.js'
import type { MergedModel } from '../providers/catalog.js'
import { isRecord } from '../gateway/repair.js'
import { anthropicError } from '../gateway/messages-convert.js'
import { jsonError } from './helpers.js'

function tokenOf(request: FastifyRequest): string {
  const authorization = request.headers.authorization
  if (typeof authorization === 'string') {
    const match = /^Bearer\s+(.+)$/iu.exec(authorization.trim())
    if (match?.[1] !== undefined) return match[1].trim()
  }
  const header = request.headers['x-api-key']
  return typeof header === 'string' ? header.trim() : ''
}

function anthropicErrorReply(reply: FastifyReply, status: number, type: string, message: string): FastifyReply {
  return reply.code(status).type('application/json; charset=utf-8').send(anthropicError(type, message))
}

/**
 * Model whitelist check. Model names are unprefixed, so a name matches when it equals the
 * requested model, any provider's upstream slug, or any provider's display name.
 */
function modelAllowed(services: Services, key: StoredApiKey, model: string): boolean {
  if (key.allowedModels.length === 0) return true
  const merged = services.catalog.resolve(model)
  const names = [
    model,
    ...(merged?.providers.map(record => record.upstreamSlug) ?? []),
    ...(merged?.providers.map(record => record.displayName) ?? []),
  ]
    .filter(name => name !== '')
    .map(name => name.toLowerCase())
  return key.allowedModels.some(allowed => names.includes(allowed.toLowerCase()))
}

/** Providers this key may reach, intersected with the model's actual providers. */
function providersFor(services: Services, key: StoredApiKey, model: MergedModel | undefined): string[] {
  if (model === undefined) return []
  if (key.allowedProviders.length === 0) return model.providers.map(record => record.providerId)
  return model.providers
    .filter(record => key.allowedProviders.includes(record.providerId))
    .map(record => record.providerId)
}

export function registerV1Routes(app: FastifyInstance, services: Services): void {
  const guard = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = tokenOf(request)
    if (token === '') {
      jsonError(reply, 401, '缺少 Authorization: Bearer <key> 或 x-api-key', 'auth_required')
      return
    }
    const result = services.auth.authenticateApiKey(token)
    if (!result.ok) {
      if (result.reason === 'no_keys') {
        jsonError(reply, 401, '尚未创建 API Key，请先打开控制台创建一把', 'no_api_key_configured')
        return
      }
      if (result.reason === 'rate') {
        reply.header('Retry-After', '60')
        jsonError(reply, 429, '该 API Key 已达到每分钟请求上限', 'rate_limited')
        return
      }
      jsonError(reply, 401, result.reason === 'disabled' ? '该 API Key 已停用' : 'API Key 无效', 'invalid_api_key')
      return
    }
    request.apiKey = result.key
  }

  const chatHooks = { preHandler: guard }

  app.get('/v1/models', chatHooks, async (request, reply) => {
    const key = request.apiKey
    if (key === undefined) return jsonError(reply, 401, 'API Key 无效', 'invalid_api_key')
    const hidden = new Set(services.catalog.getHidden())
    const models = services.catalog.visible()
      .filter(model => !hidden.has(model.name))
      .filter(model => key.allowedModels.length === 0 || modelAllowed(services, key, model.name))
      .map(model => {
        const providers = providersFor(services, key, model)
        const winner = providers
          .map(id => model.providers.find(record => record.providerId === id))
          .find((record): record is NonNullable<typeof record> => record !== undefined)
        const contextWindow = Math.max(0, ...model.providers.map(record => record.contextWindow))
        const maxOutputTokens = Math.max(0, ...model.providers.map(record => record.maxOutputTokens))
        return {
          id: model.name,
          object: 'model',
          created: 0,
          owned_by: winner?.providerId ?? 'myapi',
          name: winner?.displayName ?? model.name,
          context_window: contextWindow,
          max_output_tokens: maxOutputTokens,
          available: winner?.available ?? false,
          providers: model.providers.map(record => ({
            provider_id: record.providerId,
            upstream_slug: record.upstreamSlug,
            display_name: record.displayName,
            context_window: record.contextWindow,
            max_output_tokens: record.maxOutputTokens,
            available: record.available,
            priority: record.priority,
          })),
        }
      })
    return { object: 'list', data: models }
  })

  const runChat = async (
    services: Services,
    request: FastifyRequest,
    reply: FastifyReply,
    protocol: 'openai' | 'anthropic',
  ): Promise<void> => {
    const key = request.apiKey
    if (key === undefined) {
      if (protocol === 'anthropic') return anthropicErrorReply(reply, 401, 'authentication_error', 'API Key 无效')
      return jsonError(reply, 401, 'API Key 无效', 'invalid_api_key')
    }
    const raw = request.body
    if (!isRecord(raw) || typeof raw['model'] !== 'string' || raw['model'].trim() === '') {
      if (protocol === 'anthropic') return anthropicErrorReply(reply, 400, 'invalid_request_error', '`model` 是必填字段')
      return jsonError(reply, 400, '`model` 是必填字段', 'invalid_request')
    }
    const requested = raw['model'].trim()
    if (!modelAllowed(services, key, requested)) {
      if (protocol === 'anthropic') return anthropicErrorReply(reply, 403, 'permission_error', `该 API Key 不允许使用模型 ${requested}`)
      return jsonError(reply, 403, `该 API Key 不允许使用模型 ${requested}`, 'model_not_allowed')
    }

    // Deterministic provider choice: key scope → alias/name → provider priority → provider id.
    const resolved = services.catalog.resolveUpstream(requested, key.allowedProviders)
    if (resolved === undefined) {
      const message = key.allowedProviders.length > 0
        ? `该 API Key 的提供商范围内没有模型 ${requested}`
        : `模型 ${requested} 不在当前目录中`
      if (protocol === 'anthropic') return anthropicErrorReply(reply, 404, 'not_found_error', message)
      return jsonError(reply, 404, message, 'model_not_found')
    }
    const upstream = resolved.record.upstreamSlug
    reply.header('x-myapi-provider', resolved.providerId)

    const controller = new AbortController()
    request.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort()
    })
    const common = {
      key,
      body: { ...raw, model: upstream },
      requestedModel: requested,
      upstreamModel: upstream,
      signal: controller.signal,
      requestId: randomId('req'),
      idleMs: Math.max(services.store.settings.idleTimeoutSeconds, 10) * 1000,
    }
    if (protocol === 'anthropic') {
      await services.anthropic.handle(reply, common)
    } else if (request.url.includes('/responses')) {
      await services.responses.handle(reply, { ...common, body: raw })
    } else {
      await services.chat.handle(reply, common)
    }
  }

  app.post('/v1/chat/completions', chatHooks, async (request, reply) => {
    await runChat(services, request, reply, 'openai')
    return reply
  })

  app.post('/v1/responses', chatHooks, async (request, reply) => {
    await runChat(services, request, reply, 'openai')
    return reply
  })

  app.post('/v1/messages', chatHooks, async (request, reply) => {
    await runChat(services, request, reply, 'anthropic')
    return reply
  })
}
