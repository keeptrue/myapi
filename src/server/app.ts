import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import Fastify, { type FastifyInstance } from 'fastify'
import cookie from '@fastify/cookie'
import cors from '@fastify/cors'
import fastifyStatic from '@fastify/static'
import type { Services } from './services.js'
import { guardMutation } from './routes/helpers.js'
import { registerAuthRoutes } from './routes/auth.js'
import { registerAccountRoutes } from './routes/accounts.js'
import { registerKeyRoutes } from './routes/keys.js'
import { registerModelRoutes } from './routes/models.js'
import { registerUsageRoutes } from './routes/usage.js'
import { registerSettingsRoutes } from './routes/settings.js'
import { registerV1Routes } from './routes/v1.js'
import { registerHealthRoutes } from './routes/health.js'
import { logger as rootLogger } from './logger.js'

export interface BuildAppOptions {
  webRoot?: string
  serveWeb?: boolean
}

/** Build the Fastify application; exported so tests can inject requests. */
export async function buildApp(services: Services, options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const log = rootLogger.child({ module: 'http' })
  const app = Fastify({
    logger: false,
    bodyLimit: Math.max(services.store.settings.maxBodyMb, 1) * 1024 * 1024,
    trustProxy: services.config.trustProxy,
  })

  await app.register(cookie)
  await app.register(cors, {
    origin: (origin, callback) => {
      if (origin === undefined || origin === '') {
        callback(null, true)
        return
      }
      const allowed = services.store.settings.corsOrigins
      callback(null, allowed.includes(origin))
    },
    credentials: false,
  })

  app.addHook('onRequest', async (request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff')
    reply.header('Referrer-Policy', 'no-referrer')
    reply.header('X-Frame-Options', 'DENY')
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' https://static.geetest.com https://*.geetest.com https://*.geevisit.com; style-src 'self' 'unsafe-inline' https://static.geetest.com https://*.geetest.com https://*.geevisit.com; img-src 'self' data: https://*.geetest.com https://*.geevisit.com; connect-src 'self' https://static.geetest.com https://*.geetest.com https://*.geevisit.com; font-src 'self' data: https://static.geetest.com https://*.geetest.com https://*.geevisit.com; frame-ancestors 'none'",
    )
    if (request.url.startsWith('/api/') && request.method !== 'GET' && request.method !== 'HEAD' && request.method !== 'OPTIONS') {
      if (!guardMutation(request, reply)) return reply
    }
  })

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (reply.sent) return
    log.error('request failed', { url: request.url, message: error.message })
    const status = typeof error.statusCode === 'number' && error.statusCode >= 400 ? error.statusCode : 500
    void reply.code(status).type('application/json; charset=utf-8').send({
      error: {
        message: status >= 500 ? '服务内部错误' : error.message,
        type: 'api_error',
        code: 'internal_error',
      },
    })
  })

  registerHealthRoutes(app, services)
  registerAuthRoutes(app, services)
  registerAccountRoutes(app, services)
  registerKeyRoutes(app, services)
  registerModelRoutes(app, services)
  registerUsageRoutes(app, services)
  registerSettingsRoutes(app, services)
  registerV1Routes(app, services)

  const serveWeb = options.serveWeb ?? true
  const webRoot = options.webRoot ?? resolve(process.cwd(), 'dist/web')
  const indexFile = join(webRoot, 'index.html')
  const hasWeb = serveWeb && existsSync(indexFile)
  if (hasWeb) {
    await app.register(fastifyStatic, {
      root: webRoot,
      prefix: '/',
      index: false,
      wildcard: true,
      decorateReply: true,
    })
    app.get('/', async (_request, reply) => reply.header('Cache-Control', 'no-store').sendFile('index.html'))
  } else {
    app.get('/', async (_request, reply) => reply
      .type('text/html; charset=utf-8')
      .send('<h1>myapi</h1><p>Web console is not built. Run <code>bun run build</code> or use <code>bun run dev</code>.</p>'))
  }

  app.setNotFoundHandler((request, reply) => {
    if (request.method === 'GET' && hasWeb && !request.url.startsWith('/api/') && !request.url.startsWith('/v1/')) {
      return reply.header('Cache-Control', 'no-store').sendFile('index.html')
    }
    return reply.code(404).type('application/json; charset=utf-8').send({
      error: { message: `no such route: ${request.method} ${request.url}`, type: 'invalid_request_error', code: 'not_found' },
    })
  })

  return app
}
