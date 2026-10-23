import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    globals: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    pool: 'forks',
  },
})
