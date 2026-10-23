// 开发入口：Fastify 监听 8787，Vite 以 middleware 模式挂在同一个 HTTP server 上。
// 只有一个地址、一个进程；HMR 走同端口的 WebSocket，因此 dev 与 `bun start` 的 URL 一致。
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import type { Server } from 'node:http'
import type { FastifyInstance } from 'fastify'
import { logger } from './logger.js'
import { startServer } from './server.js'

const root = fileURLToPath(new URL('../..', import.meta.url))

// 这些前缀属于 API 面，Vite 不参与；其余 GET/HEAD 全部交给 Vite（含 SPA fallback）。
const API_PREFIXES = ['/api', '/v1', '/healthz', '/ping'] as const

function isApiRequest(url: string): boolean {
  return API_PREFIXES.some(prefix => url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`))
}

async function attachVite(app: FastifyInstance): Promise<() => Promise<void>> {
  // 只有 dev 入口会 import vite：生产构建（tsdown entry = main.ts）不会把它带进产物。
  const { createServer } = await import('vite')
  const vite = await createServer({
    root,
    configFile: join(root, 'vite.config.ts'),
    appType: 'spa',
    server: {
      middlewareMode: true,
      // 复用 Fastify 的 http server，HMR 直接跑在 8787 上，不再单开 5173。
      hmr: { server: app.server as Server },
    },
  })

  const middleware = vite.middlewares
  app.addHook('onRequest', (request, reply, done) => {
    const url = request.raw.url ?? '/'
    const isRead = request.method === 'GET' || request.method === 'HEAD'
    if (!isRead || isApiRequest(url)) {
      done()
      return
    }
    // Vite 自己写原始响应；先结束 Fastify 生命周期（handleRequest 见 reply.sent 直接返回），
    // 再把 raw req/res 交给 Vite，避免 Fastify 侧留下悬挂的请求。
    reply.hijack()
    done()
    middleware(request.raw, reply.raw, (error?: unknown) => {
      if (error !== undefined) {
        logger.error('vite middleware failed', error)
        reply.raw.statusCode = 500
        reply.raw.end('vite middleware failed')
        return
      }
      reply.raw.statusCode = 404
      reply.raw.end()
    })
  })

  return async () => {
    await vite.close()
  }
}

void startServer({ dev: true, serveWeb: false, beforeListen: attachVite }).catch(error => {
  logger.error('fatal', error)
  process.exit(1)
})

