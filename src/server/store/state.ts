import { randomBytes } from 'node:crypto'
import { copyFile, mkdir, readdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { ApiKeyPublic, ProbeRecord, ProbeUsage, Settings } from '../../shared/types.js'
import { PROBE_MAX_RECORDS } from '../../shared/constants.js'
import { hashPassword } from '../crypto/password.js'
import { ensureDir, readJsonFile, writeFileAtomic } from './atomic.js'
import {
  emptyState,
  type State,
  type StoredAccount,
  type StoredApiKey,
} from './schema.js'

const BACKUP_KEEP = 5

/**
 * Single-document state store.
 *
 * All mutations go through this object so writes are serialised and debounced;
 * the on-disk file is replaced atomically. Credentials are stored as SecretBox
 * values and never appear in the document as plaintext.
 */
export class StateStore {
  readonly path: string
  private state: State
  private saveTimer: NodeJS.Timeout | undefined
  private saveChain: Promise<void> = Promise.resolve()
  private loaded = false

  constructor(
    readonly dataDir: string,
    private readonly initialSettings: Settings,
  ) {
    this.path = join(dataDir, 'state.json')
    this.state = emptyState(initialSettings)
  }

  async load(): Promise<{ generatedPassword?: string }> {
    await ensureDir(this.dataDir)
    const raw = await readJsonFile<State>(this.path)
    if (raw !== undefined) await this.backup()
    this.state = raw === undefined ? emptyState(this.initialSettings) : migrate(raw, this.initialSettings)
    this.loaded = true

    let generatedPassword: string | undefined
    if (this.state.auth.passwordHash === '') {
      generatedPassword = await this.resetPassword(undefined, true)
    }
    await this.saveNow()
    return generatedPassword === undefined ? {} : { generatedPassword }
  }

  get current(): State {
    return this.state
  }

  get settings(): Settings {
    return this.state.settings
  }

  setSettings(patch: Partial<Settings>): Settings {
    this.state.settings = { ...this.state.settings, ...patch }
    this.scheduleSave()
    return this.state.settings
  }

  get accounts(): StoredAccount[] {
    return this.state.accounts
  }

  account(id: string): StoredAccount | undefined {
    return this.state.accounts.find(account => account.id === id)
  }

  findAccountByAccountId(accountId: string): StoredAccount | undefined {
    return accountId === '' ? undefined : this.state.accounts.find(account => account.accountId === accountId)
  }

  upsertAccount(account: StoredAccount): StoredAccount {
    const index = this.state.accounts.findIndex(existing =>
      (account.accountId !== '' && existing.accountId === account.accountId)
      || (account.accountId === '' && existing.id === account.id))
    if (index === -1) {
      this.state.accounts.push(account)
      this.scheduleSave()
      return account
    }
    const existing = this.state.accounts[index] as StoredAccount
    const next: StoredAccount = { ...account, id: existing.id, createdAt: existing.createdAt }
    this.state.accounts[index] = next
    this.scheduleSave()
    return next
  }

  updateAccount(id: string, patch: Partial<StoredAccount>): StoredAccount | undefined {
    const index = this.state.accounts.findIndex(account => account.id === id)
    const existing = this.state.accounts[index]
    if (index === -1 || existing === undefined) return undefined
    const next = { ...existing, ...patch, updatedAt: Date.now() }
    this.state.accounts[index] = next
    this.scheduleSave()
    return next
  }

  removeAccount(id: string): boolean {
    const before = this.state.accounts.length
    this.state.accounts = this.state.accounts.filter(account => account.id !== id)
    const removed = this.state.accounts.length !== before
    if (removed) {
      this.state.apiKeys = this.state.apiKeys.map(key =>
        key.boundAccountId === id ? { ...key, boundAccountId: null } : key)
      this.scheduleSave()
    }
    return removed
  }

  get apiKeys(): StoredApiKey[] {
    return this.state.apiKeys
  }

  addApiKey(key: StoredApiKey): void {
    this.state.apiKeys.push(key)
    this.scheduleSave()
  }

  updateApiKey(id: string, patch: Partial<StoredApiKey>): StoredApiKey | undefined {
    const index = this.state.apiKeys.findIndex(key => key.id === id)
    const existing = this.state.apiKeys[index]
    if (index === -1 || existing === undefined) return undefined
    const next = { ...existing, ...patch }
    this.state.apiKeys[index] = next
    this.scheduleSave()
    return next
  }

  removeApiKey(id: string): boolean {
    const before = this.state.apiKeys.length
    this.state.apiKeys = this.state.apiKeys.filter(key => key.id !== id)
    const removed = this.state.apiKeys.length !== before
    if (removed) this.scheduleSave()
    return removed
  }

  publicApiKeys(): ApiKeyPublic[] {
    return this.state.apiKeys.map(({ keyHmac: _keyHmac, ...rest }) => rest)
  }

  setModelHidden(slug: string, hidden: boolean): void {
    const set = new Set(this.state.modelVisibility.hidden)
    if (hidden) set.add(slug)
    else set.delete(slug)
    this.state.modelVisibility = { hidden: [...set] }
    this.scheduleSave()
  }

  get hiddenModels(): readonly string[] {
    return this.state.modelVisibility.hidden
  }

  setAliases(aliases: Record<string, string>): void {
    this.state.modelAliases = { ...aliases }
    this.scheduleSave()
  }

  get aliases(): Record<string, string> {
    return this.state.modelAliases
  }

  setModelReference(slug: string, key: string | null): void {
    const next = { ...this.state.modelReferences }
    if (key === null || key.trim() === '') delete next[slug]
    else next[slug] = key.trim()
    this.state.modelReferences = next
    this.scheduleSave()
  }

  get modelReferences(): Record<string, string> {
    return this.state.modelReferences
  }

  putProbe(record: ProbeRecord): void {
    const modality = record.modality ?? 'text'
    this.state.probes = this.state.probes.filter(item =>
      !(item.accountId === record.accountId
        && item.slug === record.slug
        && item.effort === record.effort
        && (item.modality ?? 'text') === modality))
    this.state.probes.push(record)
    const now = Date.now()
    this.state.probes = this.state.probes.filter(item => item.expiresAt > now)
    if (this.state.probes.length > PROBE_MAX_RECORDS) {
      this.state.probes = [...this.state.probes]
        .sort((left, right) => right.testedAt - left.testedAt)
        .slice(0, PROBE_MAX_RECORDS)
    }
    this.scheduleSave()
  }

  probesFor(slug: string): ProbeRecord[] {
    const now = Date.now()
    return this.state.probes.filter(item => item.slug === slug && item.expiresAt > now)
  }

  recordCheckin(accountId: string, day: string, result: string, delta: number): void {
    this.state.checkin[accountId] = { day, result, delta, at: Date.now() }
    this.scheduleSave()
  }

  checkinFor(accountId: string): { day: string; result: string; delta: number; at: number } | undefined {
    return this.state.checkin[accountId]
  }

  setScheduler(patch: Partial<State['scheduler']>): void {
    this.state.scheduler = { ...this.state.scheduler, ...patch }
    this.scheduleSave()
  }

  get scheduler(): State['scheduler'] {
    return this.state.scheduler
  }

  authVersion(): number {
    return this.state.auth.authVersion
  }

  passwordHash(): string {
    return this.state.auth.passwordHash
  }

  passwordGenerated(): boolean {
    return this.state.auth.passwordGenerated
  }

  /** Replace the panel password. Returns the plaintext when generating one. */
  async resetPassword(password: string | undefined, generated = false): Promise<string | undefined> {
    const plaintext = password ?? randomBytes(16).toString('hex')
    this.state.auth.passwordHash = hashPassword(plaintext)
    this.state.auth.passwordGenerated = generated
    this.state.auth.authVersion += 1
    this.state.auth.createdAt = Date.now()
    await this.saveNow()
    return password === undefined ? plaintext : undefined
  }

  async setPassword(password: string): Promise<void> {
    await this.resetPassword(password, false)
  }

  /** Debounced save; callers can mutate state then return. */
  scheduleSave(): void {
    if (!this.loaded) return
    if (this.saveTimer !== undefined) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = undefined
      void this.saveNow()
    }, 1000)
    this.saveTimer.unref?.()
  }

  async saveNow(): Promise<void> {
    if (this.saveTimer !== undefined) {
      clearTimeout(this.saveTimer)
      this.saveTimer = undefined
    }
    const snapshot = JSON.stringify(this.state, null, 2)
    const run = async (): Promise<void> => {
      await ensureDir(this.dataDir)
      await writeFileAtomic(this.path, `${snapshot}\n`)
    }
    this.saveChain = this.saveChain.then(run, run)
    await this.saveChain
  }

  async flush(): Promise<void> {
    await this.saveNow()
  }

  /** Copy the current document into data/backups before loading a newer schema. */
  async backup(): Promise<void> {
    try {
      const backups = join(this.dataDir, 'backups')
      await mkdir(backups, { recursive: true, mode: 0o700 })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await copyFile(this.path, join(backups, `state-${stamp}.json`))
      const entries = (await readdir(backups)).filter(name => name.startsWith('state-')).sort()
      for (const stale of entries.slice(0, Math.max(0, entries.length - BACKUP_KEEP))) {
        await unlink(join(backups, stale)).catch(() => undefined)
      }
    } catch {
      // A backup failure must not prevent the service from starting.
    }
  }
}

function emptyProbeUsage(): ProbeUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
}

/** Older probe records predate modality/usage/diagnostics; fill safe defaults. */
function normalizeProbeRecord(record: ProbeRecord): ProbeRecord {
  return {
    ...record,
    modality: record.modality === 'image' ? 'image' : 'text',
    effortDeclared: record.effortDeclared ?? true,
    httpStatus: record.httpStatus ?? 0,
    latencyMs: record.latencyMs ?? 0,
    finishReason: record.finishReason ?? '',
    contentPreview: record.contentPreview ?? '',
    reasoningPreview: record.reasoningPreview ?? '',
    usage: record.usage ?? emptyProbeUsage(),
  }
}

function migrate(raw: State, settings: Settings): State {
  const state: State = { ...emptyState(settings), ...raw }
  state.settings = { ...settings, ...raw.settings }
  state.accounts = Array.isArray(raw.accounts) ? raw.accounts : []
  state.apiKeys = Array.isArray(raw.apiKeys) ? raw.apiKeys : []
  state.probes = Array.isArray(raw.probes) ? raw.probes.map(normalizeProbeRecord) : []
  state.modelVisibility = { hidden: raw.modelVisibility?.hidden ?? [] }
  state.modelAliases = raw.modelAliases ?? {}
  state.modelReferences = typeof raw.modelReferences === 'object' && raw.modelReferences !== null && !Array.isArray(raw.modelReferences)
    ? raw.modelReferences
    : {}
  state.checkin = raw.checkin ?? {}
  state.scheduler = raw.scheduler ?? {}
  const blank = emptyState(settings).stats
  state.stats = {
    total: raw.stats?.total ?? blank.total,
    byModel: raw.stats?.byModel ?? {},
    byHour: raw.stats?.byHour ?? {},
    byAccount: raw.stats?.byAccount ?? {},
    byKey: raw.stats?.byKey ?? {},
  }
  return state
}
