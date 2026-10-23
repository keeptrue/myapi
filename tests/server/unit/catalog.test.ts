import { describe, expect, it } from 'vitest'
import { createHarness } from '../../helpers/harness.js'

describe('catalog', () => {
  it('merges model-manager and account configs, resolves aliases and hides models', async () => {
    const h = await createHarness()
    try {
      await h.addAccount()
      const snapshot = await h.services.catalog.refresh()
      expect(snapshot.source).toBe('live')
      expect(snapshot.models.map(model => model.slug).sort()).toEqual(['spark-x2.5', 'xopglm52'])

      const glm = h.services.catalog.resolve('GLM-5.2')
      expect(glm?.slug).toBe('xopglm52')
      expect(glm?.contextWindow).toBe(1_000_000)
      expect(glm?.description).toBe('test model')
      expect(glm?.pointMultiplier).toBe('1')
      expect(glm?.pointMultipliers).toHaveLength(1)
      expect(glm?.available).toBe(true)

      const spark = h.services.catalog.resolve('spark-x2.5')
      expect(spark?.available).toBe(false)

      h.services.store.setAliases({ fast: 'xopglm52' })
      expect(h.services.catalog.resolve('fast')?.slug).toBe('xopglm52')
      expect(h.services.catalog.aliasesFor('xopglm52')).toEqual(['fast'])

      h.services.store.setModelHidden('spark-x2.5', true)
      expect(h.services.catalog.visibleModels().map(model => model.slug)).toEqual(['xopglm52'])
      expect(h.services.catalog.hidden()).toEqual(['spark-x2.5'])
    } finally {
      await h.close()
    }
  })

  it('keeps the saved snapshot when upstream fails', async () => {
    const h = await createHarness()
    try {
      await h.addAccount()
      await h.services.catalog.refresh()
      h.fake.fetchCatalog = async () => { throw new Error('network down') }
      h.fake.fetchModelConfigs = async () => { throw new Error('network down') }
      const after = await h.services.catalog.refresh()
      expect(after.models).toHaveLength(2)
      expect(after.error).toContain('network down')
    } finally {
      await h.close()
    }
  })
})
