#!/usr/bin/env node
// 开发启动器：一个进程、一个地址。
// - Fastify 监听 8787，Vite 以 middleware 模式挂在同一个 HTTP server 上，HMR 同端口。
// - 因此 dev 只有 http://127.0.0.1:8787/ 一个入口，与 `bun start` 的生产 URL 完全一致；
//   8787 也不会再返回上一次 build 的 dist/web 旧界面。
// - bun 运行时用 `bun --watch`，node 运行时回退到 tsx watch，两者都跑同一个 dev 入口。
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import process from 'node:process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const isBun = typeof process.versions.bun === 'string'
const entry = path.join(root, 'src', 'server', 'dev.ts')

// 端口：--port <n> > MYAPI_DEV_PORT > PORT > 8787（server 与 HMR 共用这一个）
function argPort(argv) {
  const i = argv.indexOf('--port')
  return i !== -1 ? argv[i + 1] : undefined
}
const port = argPort(process.argv.slice(2)) ?? process.env['MYAPI_DEV_PORT'] ?? process.env['PORT'] ?? '8787'

function devSpec() {
  if (isBun) return [process.execPath, ['--watch', entry, '--port', port]]
  // node：直接跑 tsx 的 CLI 入口，不依赖 .bin shim
  return [process.execPath, [path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), 'watch', entry, '--port', port]]
}

const [cmd, args] = devSpec()

console.log(`  dev 启动器（运行时：${isBun ? `bun ${process.versions.bun}` : `node ${process.versions.node}`}）`)
console.log(`  http://127.0.0.1:${port}/   Fastify + Vite HMR 同一端口，只有这一个地址`)
console.log('')

const child = spawn(cmd, args, { cwd: root, stdio: 'inherit', env: process.env })
let stopping = false

function stop(signal) {
  if (stopping) return
  stopping = true
  if (child.exitCode === null && child.signalCode === null) child.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))

child.on('error', error => {
  process.stderr.write(`  dev 启动失败：${error.message}\n`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (!stopping && signal !== null) process.stderr.write(`  dev 已退出（${signal}）\n`)
  process.exit(code ?? (stopping ? 0 : 1))
})
