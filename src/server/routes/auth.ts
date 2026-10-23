import type { FastifyInstance, FastifyRequest } from 'fastify'
import { APP_VERSION, PANEL_COOKIE, PANEL_SESSION_TTL_SECONDS } from '../../shared/constants.js'
import type { Services } from '../services.js'
import { AstronError } from '../providers/astudio/types.js'
import { clientIp, jsonError, requirePanel } from './helpers.js'

function cookieOptions(request: FastifyRequest): {
  path: string
  httpOnly: boolean
  sameSite: 'lax'
  secure: boolean
  maxAge: number
} {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: request.protocol === 'https',
    maxAge: PANEL_SESSION_TTL_SECONDS,
  }
}

export function registerAuthRoutes(app: FastifyInstance, services: Services): void {
  const panel = requirePanel(services.auth)

  app.get('/api/login/geetest', { preHandler: panel }, async (_request, reply) => {
    try {
      return { geetest: await services.client.fetchGeetest() }
    } catch (error: unknown) {
      return jsonError(reply, 502, error instanceof Error ? error.message : String(error), 'geetest_unavailable')
    }
  })

  app.post('/api/login/sms', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const record = body as Record<string, unknown>
    const mobile = typeof record['mobile'] === 'string' ? record['mobile'].trim() : ''
    if (!/^1[3-9]\d{9}$/u.test(mobile)) return jsonError(reply, 400, '请输入 11 位中国大陆手机号')
    const challenge = typeof record['geetest_challenge'] === 'string' ? record['geetest_challenge'] : ''
    const validate = typeof record['geetest_validate'] === 'string' ? record['geetest_validate'] : ''
    const seccode = typeof record['geetest_seccode'] === 'string' ? record['geetest_seccode'] : ''
    if (challenge === '' || validate === '' || seccode === '') return jsonError(reply, 400, '安全验证未完成，请重新完成滑块验证')
    try {
      await services.client.sendSmsCode(mobile, { challenge, validate, seccode })
      return { ok: true }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      const captchaRejected = (error instanceof AstronError && error.code === '20009') || message.includes('20009') || /geetest verify failed/iu.test(message)
      return jsonError(reply, 400, captchaRejected ? '安全验证未通过，请重新完成滑块验证后再试。' : message, 'sms_failed')
    }
  })

  app.post('/api/login/verify', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const record = body as Record<string, unknown>
    const mobile = typeof record['mobile'] === 'string' ? record['mobile'].trim() : ''
    const code = typeof record['verify_code'] === 'string' ? record['verify_code'].trim() : ''
    if (!/^1[3-9]\d{9}$/u.test(mobile)) return jsonError(reply, 400, '请输入 11 位中国大陆手机号')
    if (code === '') return jsonError(reply, 400, '请填写短信验证码')
    try {
      const result = await services.client.loginWithSms(mobile, code)
      if (result.banned) return jsonError(reply, 403, '该账号已被封禁，无法使用。', 'account_banned')
      const account = await services.accounts.fromLogin(result)
      return { account: services.accounts.toPublic(account), is_new: result.isNew }
    } catch (error: unknown) {
      return jsonError(reply, 400, error instanceof Error ? error.message : String(error), 'login_failed')
    }
  })

  app.post('/api/auth/login', async (request, reply) => {
    const ip = clientIp(request)
    if (!services.auth.loginAllowed(ip)) {
      return jsonError(reply, 429, '尝试次数过多，请稍后再试', 'login_rate_limited')
    }
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const password = (body as Record<string, unknown>)['password']
    if (typeof password !== 'string' || password === '') return jsonError(reply, 400, '请输入面板密码')
    if (!services.auth.checkPassword(password)) {
      services.auth.recordFailure(ip)
      return jsonError(reply, 401, '面板密码不正确', 'invalid_password')
    }
    services.auth.recordSuccess(ip)
    reply.setCookie(PANEL_COOKIE, services.auth.issueSession(), cookieOptions(request))
    return { ok: true, version: APP_VERSION }
  })

  app.get('/api/auth/session', async (request) => {
    return {
      authenticated: services.auth.verifyPanel(request.cookies[PANEL_COOKIE]),
      version: APP_VERSION,
      passwordGenerated: services.store.passwordGenerated(),
    }
  })

  app.post('/api/auth/logout', async (request, reply) => {
    reply.clearCookie(PANEL_COOKIE, { path: '/' })
    return { ok: true }
  })

  app.post('/api/auth/password', { preHandler: panel }, async (request, reply) => {
    const body = request.body
    if (typeof body !== 'object' || body === null) return jsonError(reply, 400, '请求体必须是 JSON 对象')
    const record = body as Record<string, unknown>
    const current = record['current']
    const next = record['next']
    if (typeof current !== 'string' || !services.auth.checkPassword(current)) {
      return jsonError(reply, 400, '当前密码不正确', 'invalid_password')
    }
    if (typeof next !== 'string' || next.length < 8) return jsonError(reply, 400, '新密码至少 8 位')
    await services.store.setPassword(next)
    reply.setCookie(PANEL_COOKIE, services.auth.issueSession(), cookieOptions(request))
    return { ok: true }
  })

  app.get('/api/system', { preHandler: panel }, async () => {
    const settings = services.store.settings
    const catalog = services.astudioCatalog.current
    return {
      version: APP_VERSION,
      startedAt: services.startedAt,
      uptimeSeconds: Math.floor(process.uptime()),
      accounts: services.store.accounts.length,
      accountsReady: services.store.accounts.filter(account => account.enabled && account.cooldownUntil <= Date.now()).length,
      models: catalog.models.length,
      catalogFetchedAt: catalog.fetchedAt,
      catalogError: catalog.error,
      upstream: settings.upstreamBase,
      node: process.version,
      platform: process.platform,
    }
  })
}
