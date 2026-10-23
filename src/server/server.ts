import type { FastifyInstance } from 'fastify'
import { APP_NAME, APP_VERSION } from '../shared/constants.js'
import { buildApp } from './app.js'
import { loadConfig } from './config.js'
import { logger } from './logger.js'
import { createServices } from './services.js'

/** Shutdown hook returned by a startup step (dev mounts Vite this way). */
export type Cleanup = () => void | Promise<void>

export interface StartOptions {
  /**
   * Serve `dist/web` from Fastify. Defaults to true.
   * Dev turns this off so 8787 never answers with a stale build while Vite owns the UI.
   */
  serveWeb?: boolean
  /** Runs after the app is built and before `listen()`; cleanup runs on shutdown. */
  beforeListen?: (app: FastifyInstance) => Promise<Cleanup | undefined>
  /** Marks the runtime as dev so the banner does not pretend to be a production start. */
  dev?: boolean
}

async function runCleanups(cleanups: Cleanup[]): Promise<void> {
  for (const cleanup of cleanups.reverse()) {
    try {
      await cleanup()
    } catch (error: unknown) {
      logger.warn('cleanup failed', error)
    }
  }
}

/**
 * Boot the gateway: one HTTP server, one URL.
 *
 * `main.ts` is the production entry; `dev.ts` passes `beforeListen` to mount Vite
 * in middleware mode on the very same port, so dev and `bun start` agree on the URL.
 */
export async function startServer(options: StartOptions = {}): Promise<void> {
  const config = loadConfig()
  const services = await createServices(config)
  const app = await buildApp(services, { serveWeb: options.serveWeb })

  const cleanups: Cleanup[] = []
  if (options.beforeListen !== undefined) {
    const cleanup = await options.beforeListen(app)
    if (cleanup !== undefined) cleanups.push(cleanup)
  }

  try {
    await app.listen({ host: config.host, port: config.port })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error)
    if (message.includes('EADDRINUSE')) {
      logger.error(`端口 ${config.port} 已被占用；用 --port 或 PORT 指定其它端口`)
    } else {
      logger.error('启动失败', error)
    }
    await runCleanups(cleanups)
    await services.store.flush()
    process.exit(1)
  }

  const displayHost = config.host === '0.0.0.0' || config.host === '::' ? '127.0.0.1' : config.host
  const url = `http://${displayHost}:${config.port}/`
  console.log('')
  console.log(`  ${APP_NAME} v${APP_VERSION}`)
  console.log(`  控制台   ${url}`)
  if (options.dev === true) console.log('  开发模式 Vite HMR 已挂载在同一端口，只有这一个地址')
  console.log(`  数据目录 ${config.dataDir}`)
  console.log(`  上游     ${services.store.settings.upstreamBase}`)
  if (services.generatedPassword !== undefined) {
    console.log('')
    console.log('  首次启动：已生成控制台密码')
    console.log(`  ${services.generatedPassword}`)
    console.log('  登录后请在「设置」中修改；密码只在本次日志中出现。')
  } else {
    console.log('  面板密码：已设置（可用 MYAPI_ADMIN_PASSWORD 覆盖，或在设置中修改）')
  }
  console.log('')

  services.scheduler.start()
  void services.catalog.refresh().catch(error => logger.warn('catalog refresh failed', error))

  let closing = false
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return
    closing = true
    logger.info(`收到 ${signal}，正在退出`)
    services.scheduler.stop()
    // Vite 先于 HTTP server 收尾，避免 HMR websocket 挂在已关闭的连接上。
    await runCleanups(cleanups)
    await app.close().catch(() => undefined)
    await services.store.flush().catch(() => undefined)
    process.exit(0)
  }
  process.on('SIGINT', () => void shutdown('SIGINT'))
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('unhandledRejection', reason => {
    logger.error('unhandled rejection', reason)
  })
}
