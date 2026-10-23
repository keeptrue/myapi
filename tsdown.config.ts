import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/server/main.ts'],
  outDir: 'dist/server',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  clean: true,
  sourcemap: false,
})
