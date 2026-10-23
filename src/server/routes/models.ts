import type { FastifyInstance } from 'fastify'
import type { ModelInfo } from '../../shared/types.js'
import {
  PROBE_DEFAULT_MAX_TOKENS,
  PROBE_MAX_MESSAGE_CHARS,
  PROBE_MAX_TOKENS,
} from '../../shared/constants.js'
import type { Services } from '../services.js'
import { ProbeBusyError, ProbeInputError } from '../models/probe.js'
import { compareCapabilities } from '../modelsdev/match.js'
import { isRecord } from '../util.js'
import { jsonError, requirePanel } from './helpers.js'

function defaultEffort(model: ModelInfo): string {
  const declared = new Set(model.reasoningEfforts)
  if (model.canDisableThinking) declared.add('none')
  if (model.defaultReasoning !== '' && declared.has(model.defaultReasoning)) return model.defaultReasoning
  return model.reasoningEfforts[0] ?? ''
}

function clampMaxTokens(value: unknown): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return PROBE_DEFAULT_MAX_TOKENS
  return Math.min(Math.max(Math.floor(parsed), 1), PROBE_MAX_TOKENS)
}

function display(services: Services, model: ModelInfo) {
  const accountNames = model.availableAccountIds.flatMap(id => {
    const account = services.store.account(id)
    return account === undefined ? [] : [account.nickname || account.name || account.accountId]
  })
  const pointMultipliers = (model.pointMultipliers ?? []).map(item => {
    const account = services.store.account(item.accountId)
    return {
      accountId: item.accountId,
      accountName: account === undefined
        ? item.accountId
        : (account.nickname || account.name || account.accountId),
      value: item.value,
    }
  })
  if (pointMultipliers.length === 0 && model.pointMultiplier !== '') {
    pointMultipliers.push({ accountId: '', accountName: '平台', value: model.pointMultiplier })
  }
  const official = services.modelsDev.officialFor(model)
  return {
    ...model,
    hidden: services.store.hiddenModels.includes(model.slug),
    probe: services.catalog.probeSummary(model.slug),
    availableAccounts: accountNames,
    aliases: services.catalog.aliasesFor(model.slug),
    pointMultipliers,
    official,
    capabilities: compareCapabilities(model, official),
  }
}

export function registerModelRoutes(app: FastifyInstance, services: Services): void {
  const panel = requirePanel(services.auth)

  app.get('/api/models', { preHandler: panel }, async () => {
    return {
      source: services.catalog.current.source,
      fetchedAt: services.catalog.current.fetchedAt,
      error: services.catalog.current.error,
      modelsDev: services.modelsDev.status(),
      models: services.catalog.models.map(model => display(services, model)),
    }
  })

  app.post('/api/models/refresh', { preHandler: panel }, async () => {
    const snapshot = await services.catalog.refresh()
    return {
      source: snapshot.source,
      fetchedAt: snapshot.fetchedAt,
      error: snapshot.error,
      modelsDev: services.modelsDev.status(),
      models: snapshot.models.map(model => display(services, model)),
    }
  })

  app.patch('/api/models/:slug', { preHandler: panel }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const visible = (body as Record<string, unknown>)['visible']
    if (typeof visible !== 'boolean') return jsonError(reply, 400, 'visible 必须是布尔值')
    if (services.catalog.resolve(slug) === undefined) return jsonError(reply, 404, '模型不存在', 'not_found')
    services.store.setModelHidden(slug, !visible)
    return { ok: true, hidden: services.store.hiddenModels }
  })

  app.post('/api/models/:slug/probe', { preHandler: panel }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const model = services.catalog.resolve(slug)
    if (model === undefined) return jsonError(reply, 404, '模型不存在', 'not_found')
    const body = isRecord(request.body) ? request.body : {}

    const rawMessage = body['message']
    if (rawMessage !== undefined && typeof rawMessage !== 'string') {
      return jsonError(reply, 400, 'message 必须是字符串')
    }
    const message = typeof rawMessage === 'string' && rawMessage.trim() !== ''
      ? rawMessage.trim().slice(0, PROBE_MAX_MESSAGE_CHARS)
      : 'hi'

    let effort: string
    const rawEffort = body['effort']
    if (rawEffort === undefined) {
      effort = defaultEffort(model)
    } else if (rawEffort === null || rawEffort === '') {
      effort = ''
    } else if (typeof rawEffort === 'string') {
      effort = rawEffort.trim()
      if (effort !== '' && !/^[a-z][a-z0-9_-]{0,31}$/u.test(effort)) {
        return jsonError(reply, 400, 'effort 格式不正确，允许小写字母、数字、下划线和连字符')
      }
    } else {
      return jsonError(reply, 400, 'effort 必须是字符串或 null')
    }

    const rawAccountId = body['accountId']
    if (rawAccountId !== undefined && rawAccountId !== null && typeof rawAccountId !== 'string') {
      return jsonError(reply, 400, 'accountId 必须是字符串')
    }
    const accountId = typeof rawAccountId === 'string' && rawAccountId.trim() !== '' ? rawAccountId.trim() : undefined

    for (const field of ['allAccounts', 'image'] as const) {
      if (body[field] !== undefined && typeof body[field] !== 'boolean') {
        return jsonError(reply, 400, `${field} 必须是布尔值`)
      }
    }
    const allAccounts = body['allAccounts'] === true
    const image = body['image'] === true
    if (image) {
      const official = services.modelsDev.officialFor(model)
      const declared = model.inputModalities.includes('image')
        || official?.inputModalities.includes('image') === true
      if (!declared) return jsonError(reply, 400, '平台目录与 models.dev 都未声明图片输入；请改用文本探测或先手动绑定官方条目', 'probe_image_unsupported')
    }

    try {
      const results = await services.probe.run({
        model,
        message,
        effort,
        maxTokens: clampMaxTokens(body['maxTokens']),
        ...(accountId === undefined ? {} : { accountId }),
        allAccounts,
        image,
      })
      return { results, probe: services.catalog.probeSummary(model.slug) }
    } catch (error: unknown) {
      if (error instanceof ProbeBusyError) return jsonError(reply, 409, error.message, 'probe_in_progress')
      if (error instanceof ProbeInputError) return jsonError(reply, 400, error.message, 'probe_invalid')
      throw error
    }
  })

  app.put('/api/models/:slug/reference', { preHandler: panel }, async (request, reply) => {
    const { slug } = request.params as { slug: string }
    const model = services.catalog.resolve(slug)
    if (model === undefined) return jsonError(reply, 404, '模型不存在', 'not_found')
    const body = request.body
    if (!isRecord(body)) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const rawKey = body['key']
    if (rawKey !== null && typeof rawKey !== 'string') {
      return jsonError(reply, 400, 'key 必须是字符串或 null')
    }
    const key = typeof rawKey === 'string' ? rawKey.trim() : ''
    if (key !== '' && services.modelsDev.resolveKey(key) === null) {
      return jsonError(reply, 400, `models.dev 条目不存在：${key}`, 'reference_not_found')
    }
    services.store.setModelReference(model.slug, key === '' ? null : key)
    return { ok: true, official: services.modelsDev.officialFor(model) }
  })

  app.get('/api/models-dev', { preHandler: panel }, async () => {
    return { status: services.modelsDev.status() }
  })

  app.post('/api/models-dev/refresh', { preHandler: panel }, async (_request, reply) => {
    if (!services.store.settings.modelsDevEnabled) {
      return jsonError(reply, 400, 'models.dev 官方元数据未启用', 'models_dev_disabled')
    }
    await services.modelsDev.refresh()
    return { status: services.modelsDev.status() }
  })

  app.get('/api/models-dev/search', { preHandler: panel }, async (request) => {
    const query = request.query as Record<string, unknown>
    const q = typeof query['q'] === 'string' ? query['q'].trim() : ''
    const rawLimit = Number(query['limit'])
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.floor(rawLimit), 1), 50) : 20
    return { models: q === '' ? [] : services.modelsDev.search(q, limit) }
  })

  app.get('/api/model-aliases', { preHandler: panel }, async () => {
    return { aliases: services.store.aliases }
  })

  app.put('/api/model-aliases', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const aliases = (body as Record<string, unknown>)['aliases']
    if (typeof aliases !== 'object' || aliases === null || Array.isArray(aliases)) {
      return jsonError(reply, 400, 'aliases 必须是对象')
    }
    const cleaned: Record<string, string> = {}
    for (const [alias, target] of Object.entries(aliases)) {
      if (typeof target !== 'string' || target.trim() === '') continue
      if (services.catalog.resolve(target) === undefined) {
        return jsonError(reply, 400, `别名 ${alias} 指向的模型不存在：${target}`)
      }
      cleaned[alias.trim()] = target.trim()
    }
    services.store.setAliases(cleaned)
    return { aliases: cleaned }
  })
}
