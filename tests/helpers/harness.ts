import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import { createServices, refreshUnifiedCatalog, type Services } from '../../src/server/services.js'
import { buildApp } from '../../src/server/app.js'
import type { AppConfig } from '../../src/server/config.js'
import { FakeAstron } from './fake-astron.js'
import { modelsDevFixture } from './modelsdev-fixture.js'

export interface Harness {
  app: FastifyInstance
  services: Services
  fake: FakeAstron
  dir: string
  close: () => Promise<void>
  login: () => Promise<string>
  createKey: (input?: { name?: string; allowedModels?: string[]; boundAccountId?: string | null }) => string
  addAccount: (input?: { accountId?: string; token?: string; bearer?: string; points?: number; spark?: number }) => Promise<string>
}

export function testConfig(dir: string): AppConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir: dir,
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
  }
}

export async function createHarness(options: { modelsDevFetch?: typeof fetch } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'myapi-test-'))
  const fake = new FakeAstron()
  const services = await createServices(testConfig(dir), {
    client: fake,
    modelsDev: {
      snapshot: modelsDevFixture,
      ...(options.modelsDevFetch === undefined ? {} : { fetchImpl: options.modelsDevFetch }),
    },
  })
  await refreshUnifiedCatalog(services)
  const app = await buildApp(services, { serveWeb: false })
  const sockets: string[] = []

  const login = async (): Promise<string> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json', 'x-myapi-csrf': '1' },
      payload: { password: 'test-password' },
    })
    if (response.statusCode !== 200) throw new Error(`login failed: ${response.statusCode} ${response.body}`)
    const setCookie = response.headers['set-cookie']
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie
    if (raw === undefined) throw new Error('no session cookie')
    const cookie = raw.split(';')[0] ?? ''
    sockets.push(cookie)
    return cookie
  }

  const createKey = (input: { name?: string; allowedModels?: string[]; allowedProviders?: string[]; boundAccountId?: string | null } = {}): string => {
    const created = services.auth.createApiKey({
      name: input.name ?? 'test',
      allowedModels: input.allowedModels ?? [],
      allowedProviders: input.allowedProviders ?? [],
      boundAccountId: input.boundAccountId ?? null,
      rpm: 0,
    })
    return created.key
  }

  const addAccount = async (input: { accountId?: string; token?: string; bearer?: string; points?: number; spark?: number } = {}): Promise<string> => {
    const accountId = input.accountId ?? `account-${Math.random().toString(36).slice(2, 8)}`
    const token = input.token ?? `token-${accountId}`
    const bearer = input.bearer ?? `bearer-${accountId}`
    fake.nextBearer = bearer
    fake.nextAccountId = accountId
    fake.points = input.points ?? 1000
    fake.spark = input.spark ?? 1000
    const account = await services.accounts.importPaste({
      accountId,
      token,
      ssoSessionId: `sso-${accountId}`,
      uid: `uid-${accountId}`,
      mobile: '13800138000',
    })
    // A new account can change what the unified catalog resolves to, so refresh it too.
    await refreshUnifiedCatalog(services)
    return account.id
  }

  return {
    app,
    services,
    fake,
    dir,
    login,
    createKey,
    addAccount,
    close: async () => {
      await app.close()
      await services.store.flush()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

export function cookieHeader(cookie: string): Record<string, string> {
  return { cookie, 'x-myapi-csrf': '1' }
}
