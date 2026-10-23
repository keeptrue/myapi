import { defaultSettings, type AppConfig } from './config.js'
import { setLogLevel } from './logger.js'
import { loadOrCreateSecretKey } from './crypto/secretbox.js'
import { StateStore } from './store/state.js'
import { BenefitStore, LogStore } from './store/logs.js'
import { AstronClient } from './astron/client.js'
import { AccountService } from './astron/accounts.js'
import { CatalogService } from './astron/catalog.js'
import { ModelsDevService } from './modelsdev/service.js'
import { ProbeService } from './models/probe.js'
import type { ModelsDevSnapshot } from './modelsdev/types.js'
import { AccountSelector } from './gateway/select.js'
import { GatewayEngine } from './gateway/engine.js'
import { UsageService } from './gateway/usage.js'
import { ChatGateway } from './gateway/chat.js'
import { ResponsesGateway } from './gateway/responses.js'
import { AnthropicGateway } from './gateway/messages.js'
import { AuthService } from './auth.js'
import { Scheduler } from './scheduler.js'
import type { AstronApi } from './astron/types.js'

export interface Services {
  config: AppConfig
  startedAt: number
  masterKey: Buffer
  store: StateStore
  logs: LogStore
  benefits: BenefitStore
  client: AstronApi
  accounts: AccountService
  catalog: CatalogService
  modelsDev: ModelsDevService
  probe: ProbeService
  selector: AccountSelector
  engine: GatewayEngine
  usage: UsageService
  chat: ChatGateway
  responses: ResponsesGateway
  anthropic: AnthropicGateway
  auth: AuthService
  scheduler: Scheduler
  generatedPassword?: string
}

export interface CreateServicesOptions {
  client?: AstronApi
  modelsDev?: {
    fetchImpl?: typeof fetch
    snapshot?: ModelsDevSnapshot
  }
}

/** Wire the runtime object graph. Tests may inject a fake upstream client. */
export async function createServices(config: AppConfig, options: CreateServicesOptions = {}): Promise<Services> {
  setLogLevel(config.logLevel)
  const masterKey = loadOrCreateSecretKey(config.dataDir, config.secretKey)
  const store = new StateStore(config.dataDir, defaultSettings(config))
  const loaded = await store.load()
  let generatedPassword = loaded.generatedPassword
  if (config.adminPassword !== undefined && config.adminPassword !== '') {
    await store.setPassword(config.adminPassword)
    generatedPassword = undefined
  }

  const settings = store.settings
  const logs = new LogStore(config.dataDir, settings.logMaxEntries, settings.logRetentionDays)
  await logs.init()
  const benefits = new BenefitStore(config.dataDir)
  await benefits.init()

  const client = options.client ?? new AstronClient({
    upstreamBase: settings.upstreamBase,
    modelsBase: settings.modelsBase,
    workspaceBase: settings.workspaceBase,
    studioVersion: settings.studioVersion,
    clientType: settings.clientType,
    version: '0.1.0',
  })
  const accounts = new AccountService(store, client, masterKey, benefits)
  const catalog = new CatalogService(store, client, accounts, config.dataDir)
  await catalog.load()
  const modelsDev = new ModelsDevService({
    store,
    dataDir: config.dataDir,
    ...(options.modelsDev?.fetchImpl === undefined ? {} : { fetchImpl: options.modelsDev.fetchImpl }),
    ...(options.modelsDev?.snapshot === undefined ? {} : { snapshot: options.modelsDev.snapshot }),
  })
  await modelsDev.load()
  const probe = new ProbeService({ store, client, accounts })

  const selector = new AccountSelector(store, accounts, catalog)
  const engine = new GatewayEngine({ store, client, accounts, catalog, selector })
  const usage = new UsageService(store, logs)
  const chat = new ChatGateway(engine, catalog, usage)
  const responses = new ResponsesGateway(engine, usage)
  const anthropic = new AnthropicGateway(engine, usage)
  const auth = new AuthService(store, masterKey)

  const services: Services = {
    config,
    startedAt: Date.now(),
    masterKey,
    store,
    logs,
    benefits,
    client,
    accounts,
    catalog,
    modelsDev,
    probe,
    selector,
    engine,
    usage,
    chat,
    responses,
    anthropic,
    auth,
    scheduler: undefined as unknown as Scheduler,
    ...(generatedPassword === undefined ? {} : { generatedPassword }),
  }
  services.scheduler = new Scheduler(services)
  return services
}
