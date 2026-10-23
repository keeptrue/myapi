import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UnifiedCatalog } from '../../../src/server/providers/catalog.js'
import type { ModelRecord } from '../../../src/shared/providers.js'

function record(providerId: string, name: string, priority: number, extra: Partial<ModelRecord> = {}): ModelRecord {
  return {
    name,
    providerId,
    upstreamSlug: `${providerId}/${name}`,
    displayName: name.toUpperCase(),
    contextWindow: 128_000,
    maxOutputTokens: 8_192,
    reasoningEfforts: ['low', 'high'],
    inputModalities: ['text'],
    canDisableThinking: true,
    available: true,
    priority,
    extra: {},
    ...extra,
  }
}

describe('unified catalog', () => {
  it('merges same-named models from two providers into one entry instead of dropping either', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myapi-catalog-'))
    try {
      const catalog = new UnifiedCatalog(join(dir, 'catalog.json'))
      await catalog.replace([
        record('astudio', 'glm-5.2', 1),
        record('qoder', 'glm-5.2', 2),
      ])

      const merged = catalog.visible()
      expect(merged).toHaveLength(1)
      expect(merged[0]?.name).toBe('glm-5.2')
      expect(merged[0]?.providers).toHaveLength(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('picks the provider by key scope, then priority, then provider id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myapi-catalog-'))
    try {
      const catalog = new UnifiedCatalog(join(dir, 'catalog.json'))
      await catalog.replace([
        record('astudio', 'shared', 5),
        record('qoder', 'shared', 1),
      ])

      // No scope: the higher-priority provider wins.
      expect(catalog.resolveUpstream('shared', [])?.providerId).toBe('qoder')
      // Scope narrows the candidate set before priority is applied.
      expect(catalog.resolveUpstream('shared', ['astudio'])?.providerId).toBe('astudio')
      // A scope that matches nothing resolves to undefined, not to a fallback.
      expect(catalog.resolveUpstream('shared', ['nope'])).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('breaks priority ties on provider id so the choice never depends on input order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myapi-catalog-'))
    try {
      const catalog = new UnifiedCatalog(join(dir, 'catalog.json'))
      await catalog.replace([
        record('qoder', 'tie', 3),
        record('astudio', 'tie', 3),
      ])
      expect(catalog.resolveUpstream('tie', [])?.providerId).toBe('astudio')

      await catalog.replace([
        record('astudio', 'tie', 3),
        record('qoder', 'tie', 3),
      ])
      expect(catalog.resolveUpstream('tie', [])?.providerId).toBe('astudio')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('resolves aliases and normalises names case-insensitively', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myapi-catalog-'))
    try {
      const catalog = new UnifiedCatalog(join(dir, 'catalog.json'))
      catalog.setAliases({ 'glm-5-2': 'glm-5.2' })
      await catalog.replace([record('astudio', 'GLM-5.2', 1)])

      expect(catalog.resolve('glm-5-2')?.name).toBe('glm-5.2')
      // Normalisation covers case and whitespace only; '-' and '_' stay distinct.
      expect(catalog.resolve('GLM-5.2')?.name).toBe('glm-5.2')
      expect(catalog.resolve('glm_5.2')).toBeUndefined()
      expect(catalog.resolve('missing')).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('hides models without removing them from the record set', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myapi-catalog-'))
    try {
      const catalog = new UnifiedCatalog(join(dir, 'catalog.json'))
      await catalog.replace([record('astudio', 'visible', 1), record('astudio', 'hidden-one', 2)])
      catalog.setHidden(['hidden-one'])

      expect(catalog.visible().map(model => model.name)).toEqual(['visible'])
      expect(catalog.all()).toHaveLength(2)
      expect(catalog.resolve('hidden-one')?.hidden).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('keeps the last good snapshot when an upstream returns nothing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myapi-catalog-'))
    try {
      const catalog = new UnifiedCatalog(join(dir, 'catalog.json'))
      await catalog.replace([record('astudio', 'keep-me', 1)])
      await catalog.replace([])

      expect(catalog.source).toBe('saved')
      expect(catalog.error).toContain('保留上次快照')
      expect(catalog.resolve('keep-me')?.name).toBe('keep-me')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reports which providers are actually reachable for a key scope', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myapi-catalog-'))
    try {
      const catalog = new UnifiedCatalog(join(dir, 'catalog.json'))
      await catalog.replace([
        record('astudio', 'a', 1),
        record('qoder', 'q', 1),
        record('qoder', 'b', 1),
      ])

      expect(catalog.providersInScope([]).sort()).toEqual(['astudio', 'qoder'])
      expect(catalog.providersInScope(['qoder'])).toEqual(['qoder'])
      expect(catalog.providerIds()).toEqual(['astudio', 'qoder'])
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reloads a persisted snapshot from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'myapi-catalog-'))
    try {
      const first = new UnifiedCatalog(join(dir, 'catalog.json'))
      await first.replace([record('astudio', 'persisted', 1)])

      const second = new UnifiedCatalog(join(dir, 'catalog.json'))
      await second.load()
      expect(second.resolve('persisted')?.name).toBe('persisted')
      expect(second.source).toBe('live')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
