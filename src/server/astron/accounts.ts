import { createHash, randomUUID } from 'node:crypto'
import type { AccountPublic, AccountSource, AccountTestResult, CheckinResult, ImportAccountInput, ImportFileInput } from '../../shared/types.js'
import { PROBE_TIMEOUT_MS } from '../../shared/constants.js'
import { open, seal, secretBoxAad } from '../crypto/secretbox.js'
import { logger as rootLogger } from '../logger.js'
import type { StateStore } from '../store/state.js'
import type { StoredAccount } from '../store/schema.js'
import type { BenefitStore } from '../store/logs.js'
import { parseAstronSession, parseConfigToml, sessionValid } from './session.js'
import {
  AstronError,
  isSessionExpired,
  type AstronApi,
  type AstronSession,
  type LoginResult,
  type PointsBalance,
} from './types.js'
import { localDayKey, normalizeUid, truncate } from '../util.js'

const CLAIMABLE_POPUPS = new Set(['DAILY_REWARD_DIALOG', 'NEW_USER_DIALOG', 'CLIENT_DOWNLOAD_REWARD_DIALOG'])

function emptyPoints(): PointsBalance {
  return {
    totalAmount: 0,
    totalBalance: 0,
    memberBalance: 0,
    buyBalance: 0,
    activityBalance: 0,
    sparkTotalAmount: 0,
    sparkTotalBalance: 0,
    activityNextExpireTime: '',
    buyNextExpireTime: '',
  }
}

function maskMobile(mobile: string): string {
  const value = mobile.trim()
  if (/^\d{11}$/u.test(value)) return `${value.slice(0, 3)}****${value.slice(-4)}`
  if (value.length > 6) return `${value.slice(0, 3)}***${value.slice(-2)}`
  return value
}

function localId(seed: string): string {
  return `local_${createHash('sha256').update(seed).digest('hex').slice(0, 16)}`
}

/** Account persistence, credential refresh, status and benefits. */
export class AccountService {
  private readonly log = rootLogger.child({ module: 'accounts' })

  constructor(
    private readonly store: StateStore,
    private readonly client: AstronApi,
    private readonly masterKey: Buffer,
    private readonly benefits: BenefitStore,
  ) {}

  private sealFor(accountId: string, field: string, value: string | undefined): ReturnType<typeof seal> | undefined {
    if (value === undefined || value.trim() === '') return undefined
    return seal(value.trim(), secretBoxAad(accountId, field), this.masterKey)
  }

  private openFor(account: StoredAccount, field: string, box: StoredAccount['tokenEnc']): string {
    const value = open(box, secretBoxAad(account.id, field), this.masterKey)
    return value ?? ''
  }

  sessionFor(account: StoredAccount): AstronSession {
    return {
      accountId: account.accountId,
      uid: account.uid,
      token: this.openFor(account, 'token', account.tokenEnc),
      ssoSessionId: this.openFor(account, 'ssoSession', account.ssoSessionEnc),
      modelBearerToken: this.openFor(account, 'modelBearer', account.modelBearerEnc),
    }
  }

  toPublic(account: StoredAccount): AccountPublic {
    return {
      id: account.id,
      name: account.name,
      accountId: account.accountId,
      uid: account.uid,
      mobileMasked: maskMobile(account.mobile),
      nickname: account.nickname,
      domainAccount: account.domainAccount,
      source: account.source,
      enabled: account.enabled,
      sessionOk: account.sessionOk,
      statusNote: account.statusNote,
      lastError: account.lastError,
      lastUsedAt: account.lastUsedAt,
      cooldownUntil: account.cooldownUntil,
      successes: account.successes,
      failures: account.failures,
      pointsKnown: account.pointsKnown,
      pointsBalance: account.pointsBalance,
      sparkBalance: account.sparkBalance,
      planCode: account.planCode,
      planName: account.planName,
      planActive: account.planActive,
      pendingPopups: account.pendingPopups,
      lastCheckedAt: account.lastCheckedAt,
      lastClaimAt: account.lastClaimAt,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      credentials: {
        cookie: account.tokenEnc !== undefined,
        modelBearer: account.modelBearerEnc !== undefined,
      },
    }
  }

  list(): AccountPublic[] {
    return this.store.accounts.map(account => this.toPublic(account))
  }

  get(id: string): StoredAccount | undefined {
    return this.store.account(id)
  }

  private async persist(input: {
    id?: string
    name: string
    accountId: string
    uid: string
    token?: string
    ssoSessionId?: string
    modelBearerToken?: string
    mobile: string
    nickname: string
    source: AccountSource
    sessionOk: boolean
    statusNote?: string
  }): Promise<StoredAccount> {
    const existing = input.accountId !== ''
      ? this.store.findAccountByAccountId(input.accountId)
      : input.id === undefined ? undefined : this.store.account(input.id)
    const seed = input.token !== undefined && input.token !== ''
      ? input.token
      : input.modelBearerToken !== undefined && input.modelBearerToken !== ''
        ? input.modelBearerToken
        : randomUUID()
    const id = existing?.id ?? input.id ?? (input.accountId === '' ? localId(seed) : randomUUID())
    const now = Date.now()
    const account: StoredAccount = {
      id,
      name: input.name.trim() !== '' ? input.name.trim() : (input.nickname || input.mobile || input.accountId || 'AStudio account'),
      accountId: input.accountId,
      uid: normalizeUid(input.uid),
      mobile: input.mobile,
      nickname: input.nickname,
      domainAccount: existing?.domainAccount ?? '',
      source: input.source,
      enabled: existing?.enabled ?? true,
      sessionOk: input.sessionOk,
      statusNote: input.statusNote ?? '',
      lastError: '',
      lastUsedAt: existing?.lastUsedAt ?? 0,
      cooldownUntil: 0,
      successes: existing?.successes ?? 0,
      failures: existing?.failures ?? 0,
      pointsKnown: existing?.pointsKnown ?? false,
      pointsBalance: existing?.pointsBalance ?? 0,
      sparkBalance: existing?.sparkBalance ?? 0,
      planCode: existing?.planCode ?? '',
      planName: existing?.planName ?? '',
      planActive: existing?.planActive ?? false,
      pendingPopups: existing?.pendingPopups ?? 0,
      lastCheckedAt: existing?.lastCheckedAt ?? 0,
      lastClaimAt: existing?.lastClaimAt ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...(() => {
        const box = this.sealFor(id, 'token', input.token)
        return box === undefined ? {} : { tokenEnc: box }
      })(),
      ...(() => {
        const box = this.sealFor(id, 'ssoSession', input.ssoSessionId)
        return box === undefined ? {} : { ssoSessionEnc: box }
      })(),
      ...(() => {
        const box = this.sealFor(id, 'modelBearer', input.modelBearerToken)
        return box === undefined ? {} : { modelBearerEnc: box }
      })(),
    }
    return this.store.upsertAccount(account)
  }

  async fromLogin(result: LoginResult): Promise<StoredAccount> {
    const account = await this.persist({
      name: result.nickname || result.mobile || result.accountId,
      accountId: result.accountId,
      uid: result.uid,
      token: result.token,
      ssoSessionId: result.ssoSessionId,
      modelBearerToken: result.modelBearerToken,
      mobile: result.mobile,
      nickname: result.nickname,
      source: 'sms-login',
      sessionOk: true,
    })
    await this.record(account, '手机号登录', 'ok', `accountId=${result.accountId}${result.isNew ? '（新账号）' : ''}`)
    void this.refreshStatus(account.id).catch(() => undefined)
    return account
  }

  async importPaste(input: ImportAccountInput): Promise<StoredAccount> {
    const token = input.token?.trim() ?? ''
    const sso = input.ssoSessionId?.trim() ?? ''
    const bearerInput = input.modelBearerToken?.trim() ?? ''
    const accountId = input.accountId?.trim() ?? ''
    const uid = input.uid?.trim() ?? ''
    const mobile = input.mobile?.trim() ?? ''
    if (token === '' && sso === '' && bearerInput === '') {
      throw new Error('至少需要 chat token、ssoSessionId 或 modelBearerToken 之一')
    }
    let bearer = bearerInput
    let resolvedUid = uid
    let resolvedMobile = mobile
    let sessionOk = false
    let statusNote = ''
    if (token !== '' || sso !== '') {
      const session: AstronSession = {
        accountId,
        uid,
        token: token !== '' ? token : sso,
        ssoSessionId: sso !== '' ? sso : token,
        modelBearerToken: bearer,
      }
      try {
        if (sessionValid(session) || sso !== '') {
          const info = await this.client.fetchUserInfo(session)
          resolvedUid = resolvedUid || info.uid
          resolvedMobile = resolvedMobile || info.mobile
          const credentials = await this.client.fetchModelConfigs(session)
          bearer = bearer || credentials.bearer
          sessionOk = true
        }
      } catch (error: unknown) {
        if (isSessionExpired(error)) {
          statusNote = '会话已失效，请重新登录'
        } else {
          statusNote = truncate(error instanceof Error ? error.message : String(error), 200)
        }
      }
    }
    if (bearer === '' && !sessionOk) {
      throw new Error(statusNote !== '' ? `导入失败：${statusNote}` : '未能取得模型凭据')
    }
    const account = await this.persist({
      ...(accountId === '' ? { id: localId(token || sso || bearer) } : {}),
      name: input.name ?? '',
      accountId,
      uid: resolvedUid,
      token,
      ssoSessionId: sso,
      modelBearerToken: bearer,
      mobile: resolvedMobile,
      nickname: '',
      source: sessionOk ? 'paste' : 'model-only',
      sessionOk,
      statusNote,
    })
    await this.record(account, '导入账号', 'ok', sessionOk ? 'cookie + bearer' : '仅模型凭据')
    if (sessionOk) void this.refreshStatus(account.id).catch(() => undefined)
    return account
  }

  async importFile(input: ImportFileInput): Promise<StoredAccount> {
    const config = input.configToml === undefined ? { bearer: '', uid: '' } : parseConfigToml(input.configToml)
    let session: ReturnType<typeof parseAstronSession> = { mobile: '', nickname: '' }
    if (input.sessionJson !== undefined && input.sessionJson.trim() !== '') {
      session = parseAstronSession(input.sessionJson)
    }
    const account = await this.importPaste({
      token: session.token ?? '',
      ssoSessionId: session.ssoSessionId ?? '',
      accountId: session.accountId ?? '',
      uid: session.uid ?? config.uid,
      mobile: session.mobile ?? '',
      modelBearerToken: session.modelBearerToken ?? config.bearer,
      ...(input.name === undefined ? {} : { name: input.name }),
    })
    return this.store.updateAccount(account.id, { source: 'file-import' }) ?? account
  }

  async refreshCredential(id: string): Promise<StoredAccount> {
    const account = this.store.account(id)
    if (account === undefined) throw new Error('账号不存在')
    const session = this.sessionFor(account)
    if (session.token === '' && session.ssoSessionId === '') {
      throw new Error('账号没有会话 Cookie，无法刷新模型凭据；仅模型账号的 Bearer 被上游拒绝时，请重新导入完整会话')
    }
    try {
      const credentials = await this.client.fetchModelConfigs(session)
      const updated = this.store.updateAccount(id, {
        modelBearerEnc: seal(credentials.bearer, secretBoxAad(id, 'modelBearer'), this.masterKey),
        sessionOk: true,
        lastError: '',
        cooldownUntil: 0,
        statusNote: '',
      })
      return updated ?? account
    } catch (error: unknown) {
      const expired = isSessionExpired(error)
      this.store.updateAccount(id, {
        lastError: truncate(error instanceof Error ? error.message : String(error), 400),
        statusNote: expired ? '会话已失效，请重新登录' : account.statusNote,
        sessionOk: expired ? false : account.sessionOk,
        cooldownUntil: Date.now() + (expired ? 300 : 60) * 1000,
      })
      throw error
    }
  }

  async refreshStatus(id: string): Promise<StoredAccount> {
    const account = this.store.account(id)
    if (account === undefined) throw new Error('账号不存在')
    const session = this.sessionFor(account)
    if (session.token === '' && session.ssoSessionId === '') {
      throw new Error('账号没有会话 Cookie，无法读取权益')
    }
    const [points, membership, popups] = await Promise.allSettled([
      this.client.pointsBalance(session),
      this.client.membership(session),
      this.client.pendingPopups(session),
    ])
    const errors: string[] = []
    let sessionExpired = false
    const balance = points.status === 'fulfilled' ? points.value : emptyPoints()
    if (points.status === 'rejected') {
      errors.push(`points: ${messageOf(points.reason)}`)
      sessionExpired ||= isSessionExpired(points.reason)
    }
    const plan = membership.status === 'fulfilled' ? membership.value : undefined
    if (membership.status === 'rejected') errors.push(`membership: ${messageOf(membership.reason)}`)
    const pendingCount = popups.status === 'fulfilled' ? popups.value.length : account.pendingPopups
    if (popups.status === 'rejected') errors.push(`popups: ${messageOf(popups.reason)}`)

    const updated = this.store.updateAccount(id, {
      ...(points.status === 'fulfilled' ? {
        pointsKnown: true,
        pointsBalance: balance.totalBalance,
        sparkBalance: balance.sparkTotalBalance,
      } : {}),
      ...(plan === undefined ? {} : {
        planCode: plan.planCode,
        planName: plan.planName,
        planActive: plan.active,
      }),
      pendingPopups: pendingCount,
      lastCheckedAt: Date.now(),
      statusNote: truncate(errors.join('; '), 400),
      sessionOk: sessionExpired ? false : account.sessionOk,
    })
    if (sessionExpired) {
      this.store.updateAccount(id, { statusNote: '会话已失效，请重新登录', sessionOk: false })
    }
    return updated ?? account
  }

  async checkin(id: string): Promise<CheckinResult> {
    const account = this.store.account(id)
    if (account === undefined) throw new Error('账号不存在')
    const session = this.sessionFor(account)
    const settings = this.store.settings
    const name = account.nickname || account.name || account.accountId
    const result: CheckinResult = {
      accountId: account.id,
      name,
      points: account.pointsBalance,
      spark: account.sparkBalance,
      pointsDelta: 0,
      plan: account.planName,
      popups: account.pendingPopups,
      actions: [],
      error: '',
    }
    const balanceBefore = account.pointsBalance + account.sparkBalance
    try {
      const tenant = await this.client.initTenantApp(session)
      if (tenant.banned) {
        this.store.updateAccount(id, { statusNote: '账号已被封禁', enabled: false })
        result.error = '账号已被封禁'
        await this.record(account, '签到', 'failed', result.error)
        return result
      }
      result.actions.push('每日登录')
      await this.record(account, '签到', 'ok', 'init-app')
    } catch (error: unknown) {
      result.error = truncate(messageOf(error), 300)
      await this.record(account, '签到', 'failed', result.error)
      if (isSessionExpired(error)) this.store.updateAccount(id, { sessionOk: false, statusNote: '会话已失效，请重新登录' })
      return result
    }

    if (settings.checkinCompletePopups) {
      try {
        const popups = await this.client.pendingPopups(session)
        for (const popup of popups) {
          if (!CLAIMABLE_POPUPS.has(popup.componentType)) continue
          try {
            await this.client.completePopup(session, popup.popupId, popup.instanceKey)
            result.actions.push(popupLabel(popup.componentType))
            await this.record(account, popupLabel(popup.componentType), 'ok', `popupId=${popup.popupId}`)
          } catch (error: unknown) {
            await this.record(account, popupLabel(popup.componentType), 'failed', truncate(messageOf(error), 200))
          }
        }
      } catch (error: unknown) {
        await this.record(account, '领取弹窗', 'failed', truncate(messageOf(error), 200))
      }
    }

    if (settings.checkinClaimDownload) {
      try {
        await this.client.claimDownloadReward(session)
        result.actions.push('客户端下载奖励')
        await this.record(account, '客户端下载奖励', 'ok', '')
      } catch (error: unknown) {
        const ignored = isAlreadyClaimed(error)
        await this.record(account, '客户端下载奖励', ignored ? 'skipped' : 'failed', ignored ? '今日已领取' : truncate(messageOf(error), 200))
      }
    }

    if (settings.checkinClaimBeta && account.domainAccount.trim() !== '') {
      try {
        const eligibility = await this.client.betaEligibility(session)
        if (eligibility.canClaim) {
          await this.client.claimBeta(session, account.domainAccount.trim())
          result.actions.push('Beta 资格')
          await this.record(account, 'Beta 领取', 'ok', account.domainAccount)
          await this.refreshCredential(id).catch(() => undefined)
        } else {
          await this.record(account, 'Beta 领取', 'skipped', eligibility.reason || '不具备领取资格')
        }
      } catch (error: unknown) {
        await this.record(account, 'Beta 领取', 'failed', truncate(messageOf(error), 200))
      }
    }

    try {
      const refreshed = await this.refreshStatus(id)
      result.points = refreshed.pointsBalance
      result.spark = refreshed.sparkBalance
      result.popups = refreshed.pendingPopups
      result.plan = refreshed.planName
      result.pointsDelta = refreshed.pointsBalance + refreshed.sparkBalance - balanceBefore
      this.store.recordCheckin(id, localDayKey(), result.actions.join('、') || '已签到', result.pointsDelta)
      this.store.updateAccount(id, { lastClaimAt: Date.now() })
      if (result.actions.length > 0 && result.pointsDelta === 0) {
        await this.record(account, '结算', 'skipped', '调用成功但积分无变化（可能今日已领）')
      }
    } catch (error: unknown) {
      result.error = truncate(messageOf(error), 300)
    }
    return result
  }

  async keepalive(id: string): Promise<void> {
    const account = this.store.account(id)
    if (account === undefined || !account.enabled) return
    try {
      await this.refreshCredential(id)
      await this.refreshStatus(id)
      await this.record(account, '保活', 'ok', '')
    } catch (error: unknown) {
      await this.record(account, '保活', 'failed', truncate(messageOf(error), 300))
      throw error
    }
  }

  async test(id: string, model: string): Promise<AccountTestResult> {
    const account = this.store.account(id)
    if (account === undefined) throw new Error('账号不存在')
    const session = this.sessionFor(account)
    const started = Date.now()
    try {
      const response = await this.client.inference('chat/completions', session, {
        model,
        messages: [{ role: 'user', content: `ping-${Date.now().toString(36)}` }],
        max_tokens: 1,
        stream: false,
      }, AbortSignal.timeout(PROBE_TIMEOUT_MS))
      const text = await response.text().catch(() => '')
      const latencyMs = Date.now() - started
      if (!response.ok) {
        return { ok: false, model, status: response.status, latencyMs, message: truncate(text, 300) || `HTTP ${response.status}` }
      }
      this.store.updateAccount(id, { successes: account.successes + 1, lastUsedAt: Date.now(), lastError: '' })
      return { ok: true, model, status: response.status, latencyMs, message: 'ok' }
    } catch (error: unknown) {
      const latencyMs = Date.now() - started
      this.store.updateAccount(id, { failures: account.failures + 1, lastError: truncate(messageOf(error), 300) })
      return { ok: false, model, status: 0, latencyMs, message: truncate(messageOf(error), 300) }
    }
  }

  async redeem(id: string, code: string): Promise<{ points: number; expireTime: string }> {
    const account = this.store.account(id)
    if (account === undefined) throw new Error('账号不存在')
    const session = this.sessionFor(account)
    try {
      const result = await this.client.redeemCode(session, code.trim())
      await this.record(account, '兑换码', 'ok', `+${result.points} 积分`)
      await this.refreshStatus(id).catch(() => undefined)
      return result
    } catch (error: unknown) {
      await this.record(account, '兑换码', 'failed', truncate(messageOf(error), 200))
      throw error
    }
  }

  async record(account: StoredAccount, action: string, result: 'ok' | 'failed' | 'skipped', detail: string): Promise<void> {
    await this.benefits.append({
      time: Date.now(),
      accountId: account.id,
      accountName: account.nickname || account.name || account.accountId,
      action,
      result,
      detail: truncate(detail, 400),
    }).catch(() => undefined)
  }

  markUsed(id: string): void {
    const account = this.store.account(id)
    if (account === undefined) return
    this.store.updateAccount(id, { successes: account.successes + 1, lastUsedAt: Date.now(), lastError: '' })
  }

  markFailed(id: string, message: string, cooldownSeconds: number): void {
    const account = this.store.account(id)
    if (account === undefined) return
    const cooldown = Math.min(Math.max(cooldownSeconds, 20) * (1 + Math.min(account.failures, 4)), 300)
    this.store.updateAccount(id, {
      failures: account.failures + 1,
      lastError: truncate(message, 400),
      cooldownUntil: Date.now() + cooldown * 1000,
    })
  }

}

function popupLabel(componentType: string): string {
  if (componentType === 'DAILY_REWARD_DIALOG') return '每日奖励'
  if (componentType === 'NEW_USER_DIALOG') return '新人奖励'
  if (componentType === 'CLIENT_DOWNLOAD_REWARD_DIALOG') return '下载奖励'
  return `弹窗:${componentType}`
}

function isAlreadyClaimed(error: unknown): boolean {
  if (!(error instanceof AstronError)) return false
  if (error.code === '11003002' || error.code === '11003001') return true
  const message = error.message.toLowerCase()
  return message.includes('already') || message.includes('已领') || message.includes('重复')
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
