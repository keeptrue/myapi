import { describe, expect, it } from 'vitest'
import { createHarness } from '../../helpers/harness.js'

describe('account selection', () => {
  it('rotates, skips cooling accounts and honours a bound key', async () => {
    const h = await createHarness()
    try {
      const first = await h.addAccount({ accountId: 'acc-1' })
      const second = await h.addAccount({ accountId: 'acc-2' })
      await h.services.catalog.refresh()
      const key = h.createKey()
      const record = h.services.store.apiKeys.find(item => item.prefix === key.slice(0, 14))
      expect(record).toBeDefined()
      if (record === undefined) return

      const picked = await h.services.selector.pick({ key: record, model: 'xopglm52' })
      expect([first, second]).toContain(picked.id)

      h.services.accounts.markFailed(first, 'boom', 60)
      for (let index = 0; index < 3; index += 1) {
        const next = await h.services.selector.pick({ key: record, model: 'xopglm52' })
        expect(next.id).toBe(second)
      }

      const bound = h.createKey({ boundAccountId: second })
      const boundRecord = h.services.store.apiKeys.find(item => item.prefix === bound.slice(0, 14))
      expect(boundRecord).toBeDefined()
      if (boundRecord === undefined) return
      const only = await h.services.selector.pick({ key: boundRecord, model: 'xopglm52' })
      expect(only.id).toBe(second)
    } finally {
      await h.close()
    }
  })

  it('refuses when every account is disabled', async () => {
    const h = await createHarness()
    try {
      const id = await h.addAccount()
      h.services.store.updateAccount(id, { enabled: false })
      const key = h.createKey()
      const record = h.services.store.apiKeys[0]
      if (record === undefined) throw new Error('missing key')
      await expect(h.services.selector.pick({ key: record, model: 'xopglm52' })).rejects.toMatchObject({ status: 503 })
    } finally {
      await h.close()
    }
  })
})
