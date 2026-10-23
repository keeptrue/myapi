import { defaultSettings, type AppConfig } from '../../src/server/config.js'

/**
 * A settings object for unit tests that must not pull in `services.ts`
 * (which wires the whole object graph).
 */
export function testSettings(): ReturnType<typeof defaultSettings> {
  return defaultSettings(testAppConfig())
}

export function testAppConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: '/tmp/myapi-unit',
    adminPassword: 'test-password',
    logLevel: 'error',
    maxBodyMb: 8,
    maxConcurrency: 8,
    trustProxy: false,
    upstreamBase: 'https://upstream.test/v1',
    modelsBase: 'https://models.test/api/v1/model-manager',
    workspaceBase: 'https://workspace.test/xingchen-studio',
    studioVersion: 'test-3.4.4',
    clientType: '22',
    ...overrides,
  }
}
