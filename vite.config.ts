import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// dev 由 src/server/dev.ts 以 middleware 模式挂到 Fastify（8787）上：
// 这里没有第二个 dev 端口，也没有独立的代理目标。
// `bun run build` 仍然产出 dist/web，由生产 server 直接静态托管。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    sourcemap: false,
  },
})
