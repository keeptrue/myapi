import { logger as rootLogger } from './logger.js'
import { localDayKey } from './util.js'
import { checkinAllAccounts, keepaliveAllAccounts } from './account-ops.js'
import type { Services } from './services.js'

const TICK_MS = 60_000

/** Daily check-in, keepalive and catalog refresh, all driven by persisted settings. */
export class Scheduler {
  private readonly log = rootLogger.child({ module: 'scheduler' })
  private timer: NodeJS.Timeout | undefined
  private running = false
  private checkingIn = false
  private keepingAlive = false
  private cataloging = false

  constructor(private readonly services: Services) {}

  start(): void {
    if (this.timer !== undefined) return
    this.timer = setInterval(() => void this.tick(), TICK_MS)
    this.timer.unref?.()
    void this.tick()
  }

  stop(): void {
    if (this.timer !== undefined) clearInterval(this.timer)
    this.timer = undefined
  }

  async tick(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const settings = this.services.store.settings
      const now = Date.now()
      const catalogAge = now - this.services.astudioCatalog.current.fetchedAt
      if (this.services.astudioCatalog.current.fetchedAt === 0 || catalogAge >= settings.catalogRefreshMinutes * 60_000) {
        if (!this.cataloging) {
          this.cataloging = true
          void this.services.astudioCatalog.refresh()
            .catch(error => this.log.warn('catalog refresh failed', error))
            .finally(() => { this.cataloging = false })
        }
      }
      this.services.modelsDev.refreshIfStale()
      if (settings.keepaliveMinutes > 0) {
        const last = this.services.store.scheduler.lastKeepaliveAt ?? 0
        if (now - last >= settings.keepaliveMinutes * 60_000 && !this.keepingAlive) {
          this.keepingAlive = true
          void this.keepaliveAll()
            .catch(error => this.log.warn('keepalive failed', error))
            .finally(() => { this.keepingAlive = false })
        }
      }
      if (settings.autoCheckin && !this.checkingIn) {
        const day = localDayKey(now)
        const hour = new Date(now).getHours()
        if (hour >= settings.checkinHour && this.services.store.scheduler.lastCheckinDay !== day) {
          this.checkingIn = true
          void checkinAllAccounts(this.services)
            .catch(error => this.log.warn('check-in failed', error))
            .finally(() => {
              this.checkingIn = false
              this.services.store.setScheduler({ lastCheckinDay: day })
            })
        }
      }
    } finally {
      this.running = false
    }
  }

  async keepaliveAll(): Promise<void> {
    await keepaliveAllAccounts(this.services)
    this.services.store.setScheduler({ lastKeepaliveAt: Date.now() })
  }
}
