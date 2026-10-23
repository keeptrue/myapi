import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { randomId } from '../util.js'
import type { Services } from '../services.js'
import type { StoredApiKey } from '../store/schema.js'
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

function modelAllowed(services: Services, key: StoredApiKey, model: string): boolean {
  if (key.allowedModels.length === 0) return true
  const info = services.catalog.resolve(model)
  const names = [model, info?.slug ?? '', info?.name ?? '', info?.directoryId ?? '']
    .filter(name => name !== '')
    .map(name => name.toLowerCase())
  return key.allowedModels.some(allowed => names.includes(allowed.toLowerCase()))
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
    const hidden = new Set(services.store.hiddenModels)
    const models = services.catalog.visibleModels()
      .filter(model => !hidden.has(model.slug))
      .filter(model => key.allowedModels.length === 0 || modelAllowed(services, key, model.slug))
      .map(model => ({
        id: model.slug,
        object: 'model',
        created: 0,
        owned_by: 'myapi',
        name: model.name,
        context_window: model.contextWindow,
        max_output_tokens: model.maxOutputTokens,
        reasoning_efforts: model.reasoningEfforts,
        can_disable_thinking: model.canDisableThinking,
        input_modalities: model.inputModalities,
        available: model.available,
        source: model.source,
        directory_id: model.directoryId,
        point_multiplier: model.pointMultiplier,
        astron: {
          slug: model.slug,
          name: model.name,
          directory_id: model.directoryId,
          context_window: model.contextWindow,
          max_output_tokens: model.maxOutputTokens,
          reasoning_efforts: model.reasoningEfforts,
          available: model.available,
          source: model.source,
          point_multiplier: model.pointMultiplier,
        },
      }))
    return { object: 'list', data: models }
  })

  app.post('/v1/chat/completions', chatHooks, async (request, reply) => {
    const key = request.apiKey
    if (key === undefined) return jsonError(reply, 401, 'API Key 无效', 'invalid_api_key')
    const raw = request.body
    if (!isRecord(raw) || typeof raw['model'] !== 'string' || raw['model'].trim() === '') {
      return jsonError(reply, 400, '`model` 是必填字段', 'invalid_request')
    }
    const requested = raw['model'].trim()
    if (!modelAllowed(services, key, requested)) return jsonError(reply, 403, `该 API Key 不允许使用模型 ${requested}`, 'model_not_allowed')
    const info = services.catalog.resolve(requested)
    const upstream = info?.slug ?? requested
    const controller = new AbortController()
    request.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort()
    })
    await services.chat.handle(reply, {
      key,
      body: { ...raw, model: upstream },
      requestedModel: requested,
      upstreamModel: upstream,
      signal: controller.signal,
      requestId: randomId('req'),
      idleMs: Math.max(services.store.settings.idleTimeoutSeconds, 10) * 1000,
    })
    return reply
  })

  app.post('/v1/responses', chatHooks, async (request, reply) => {
    const key = request.apiKey
    if (key === undefined) return jsonError(reply, 401, 'API Key 无效', 'invalid_api_key')
    const raw = request.body
    if (!isRecord(raw) || typeof raw['model'] !== 'string' || raw['model'].trim() === '') {
      return jsonError(reply, 400, '`model` 是必填字段', 'invalid_request')
    }
    const requested = raw['model'].trim()
    if (!modelAllowed(services, key, requested)) return jsonError(reply, 403, `该 API Key 不允许使用模型 ${requested}`, 'model_not_allowed')
    const info = services.catalog.resolve(requested)
    const upstream = info?.slug ?? requested
    const controller = new AbortController()
    request.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort()
    })
    await services.responses.handle(reply, {
      key,
      body: raw,
      requestedModel: requested,
      upstreamModel: upstream,
      signal: controller.signal,
      requestId: randomId('req'),
      idleMs: Math.max(services.store.settings.idleTimeoutSeconds, 10) * 1000,
    })
    return reply
  })

  app.post('/v1/messages', chatHooks, async (request, reply) => {
    const key = request.apiKey
    if (key === undefined) return anthropicErrorReply(reply, 401, 'authentication_error', 'API Key 无效')
    const raw = request.body
    if (!isRecord(raw) || typeof raw['model'] !== 'string' || raw['model'].trim() === '') {
      return anthropicErrorReply(reply, 400, 'invalid_request_error', '`model` 是必填字段')
    }
    const requested = raw['model'].trim()
    if (!modelAllowed(services, key, requested)) {
      return anthropicErrorReply(reply, 403, 'permission_error', `该 API Key 不允许使用模型 ${requested}`)
    }
    const info = services.catalog.resolve(requested)
    const upstream = info?.slug ?? requested
    const controller = new AbortController()
    request.raw.on('close', () => {
      if (!reply.raw.writableEnded) controller.abort()
    })
    await services.anthropic.handle(reply, {
      key,
      body: raw,
      requestedModel: requested,
      upstreamModel: upstream,
      signal: controller.signal,
      requestId: randomId('req'),
      idleMs: Math.max(services.store.settings.idleTimeoutSeconds, 10) * 1000,
    })
    return reply
  })
}
