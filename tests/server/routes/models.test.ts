import { describe, expect, it } from 'vitest'
import { cookieHeader, createHarness } from '../../helpers/harness.js'
import { json } from '../../helpers/fake-astron.js'

async function setup(options: { modelsDevFetch?: typeof fetch } = {}) {
  const h = await createHarness(options)
  const cookie = await h.login()
  const accountId = await h.addAccount()
  await h.services.catalog.refresh()
  return { h, cookie, accountId }
}

function chat(content: string): Response {
  return json({
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: { prompt_tokens: 3, completion_tokens: 2, total_tokens: 5 },
  })
}

describe('model catalog, probing and official metadata routes', () => {
  it('returns merged multipliers and the models.dev reference', async () => {
    const { h, cookie } = await setup()
    try {
      const response = await h.app.inject({ method: 'GET', url: '/api/models', headers: cookieHeader(cookie) })
      expect(response.statusCode).toBe(200)
      const body = response.json() as {
        modelsDev: { models: number; enabled: boolean }
        models: Array<{ slug: string; pointMultiplier: string; pointMultipliers: unknown[]; official: { key: string } | null; capabilities: { context: { official: number } } }>
      }
      expect(body.modelsDev.enabled).toBe(true)
      expect(body.modelsDev.models).toBeGreaterThan(0)
      const glm = body.models.find(model => model.slug === 'xopglm52')
      expect(glm?.pointMultiplier).toBe('1')
      expect(glm?.pointMultipliers).toHaveLength(1)
      expect(glm?.official?.key).toBe('zhipuai/glm-5.2')
      expect(glm?.capabilities.context.official).toBe(1_000_000)
    } finally {
      await h.close()
    }
  })

  it('probes with the default hi message and the catalog default effort', async () => {
    const { h, cookie } = await setup()
    try {
      h.fake.chatHandler = () => chat('hello from probe')
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/models/xopglm52/probe',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: {},
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { results: Array<{ content: string; state: string; effort: string; usage: { totalTokens: number } }>; probe: { latest?: { state: string } } }
      expect(body.results).toHaveLength(1)
      expect(body.results[0]).toMatchObject({ content: 'hello from probe', state: 'ok', effort: 'high' })
      expect(body.results[0]?.usage.totalTokens).toBe(5)
      expect(body.probe.latest?.state).toBe('ok')

      const sent = h.fake.inferenceCalls[0]?.body as Record<string, unknown>
      expect(sent['messages']).toEqual([{ role: 'user', content: 'hi' }])
      expect(sent['max_tokens']).toBe(512)
      expect(sent['reasoning_effort']).toBe('high')
      expect(sent['stream']).toBe(false)
    } finally {
      await h.close()
    }
  })

  it('accepts a custom message, effort, max tokens and account', async () => {
    const { h, cookie, accountId } = await setup()
    try {
      h.fake.chatHandler = () => chat('ok')
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/models/xopglm52/probe',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { message: '你好', effort: 'max', maxTokens: 128, accountId },
      })
      expect(response.statusCode).toBe(200)
      const sent = h.fake.inferenceCalls[0]?.body as Record<string, unknown>
      expect(sent['messages']).toEqual([{ role: 'user', content: '你好' }])
      expect(sent['max_tokens']).toBe(128)
      expect(sent['reasoning_effort']).toBe('max')
    } finally {
      await h.close()
    }
  })

  it('records rejected efforts and upstream failures separately', async () => {
    const { h, cookie } = await setup()
    try {
      h.fake.chatHandler = () => json({ error: { code: 'invalid_parameter_value', message: 'reasoning_effort is not supported' } }, 400)
      const rejected = await h.app.inject({
        method: 'POST',
        url: '/api/models/xopglm52/probe',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { effort: 'xhigh' },
      })
      expect(rejected.statusCode).toBe(200)
      const rejectedBody = rejected.json() as { results: Array<{ state: string; validation: string; reason: string }> }
      expect(rejectedBody.results[0]).toMatchObject({ state: 'rejected', validation: 'non-validating' })
      expect(rejectedBody.results[0]?.reason).toContain('reasoning_effort')

      h.fake.chatHandler = () => json({ error: { message: 'boom' } }, 500)
      const failed = await h.app.inject({
        method: 'POST',
        url: '/api/models/xopglm52/probe',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: {},
      })
      const failedBody = failed.json() as { results: Array<{ state: string; httpStatus: number }> }
      expect(failedBody.results[0]).toMatchObject({ state: 'failed', httpStatus: 500 })
    } finally {
      await h.close()
    }
  })

  it('sends an image content array when the platform declares image input', async () => {
    const { h, cookie } = await setup()
    try {
      const catalog = h.fake.catalog[0]
      if (catalog !== undefined) catalog.inputModalities = ['text', 'image']
      await h.services.catalog.refresh()
      h.fake.chatHandler = () => chat('red')
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/models/xopglm52/probe',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { image: true, message: '这张图是什么颜色？' },
      })
      expect(response.statusCode).toBe(200)
      const sent = h.fake.inferenceCalls[0]?.body as { messages: Array<{ content: unknown }> }
      const content = sent.messages[0]?.content as Array<Record<string, unknown>>
      expect(Array.isArray(content)).toBe(true)
      expect(content[1]).toMatchObject({ type: 'image_url' })
    } finally {
      await h.close()
    }
  })

  it('binds and clears a manual models.dev reference', async () => {
    const { h, cookie } = await setup()
    try {
      const bound = await h.app.inject({
        method: 'PUT',
        url: '/api/models/xopglm52/reference',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { key: 'openrouter/z-ai/glm-5.2' },
      })
      expect(bound.statusCode).toBe(200)
      expect((bound.json() as { official: { key: string; confidence: string } }).official).toMatchObject({
        key: 'openrouter/z-ai/glm-5.2',
        confidence: 'manual',
      })

      const cleared = await h.app.inject({
        method: 'PUT',
        url: '/api/models/xopglm52/reference',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { key: null },
      })
      expect(cleared.statusCode).toBe(200)
      expect((cleared.json() as { official: { key: string } }).official.key).toBe('zhipuai/glm-5.2')

      const bad = await h.app.inject({
        method: 'PUT',
        url: '/api/models/xopglm52/reference',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { key: 'missing/model' },
      })
      expect(bad.statusCode).toBe(400)
    } finally {
      await h.close()
    }
  })

  it('serves models.dev status and search, and refreshes with a fake fetch', async () => {
    const fetched = {
      test: {
        id: 'test',
        name: 'Test Provider',
        models: {
          'model-x': {
            id: 'model-x',
            name: 'Model X',
            modalities: { input: ['text'], output: ['text'] },
            limit: { context: 1000, output: 100 },
          },
        },
      },
    }
    const { h, cookie } = await setup({
      modelsDevFetch: async () => new Response(JSON.stringify(fetched), { status: 200, headers: { 'content-type': 'application/json' } }),
    })
    try {
      const status = await h.app.inject({ method: 'GET', url: '/api/models-dev', headers: cookieHeader(cookie) })
      expect(status.statusCode).toBe(200)
      expect((status.json() as { status: { models: number } }).status.models).toBeGreaterThan(0)

      const search = await h.app.inject({ method: 'GET', url: '/api/models-dev/search?q=glm', headers: cookieHeader(cookie) })
      expect(search.statusCode).toBe(200)
      expect((search.json() as { models: Array<{ key: string }> }).models.some(model => model.key === 'zhipuai/glm-5.2')).toBe(true)

      const refreshed = await h.app.inject({
        method: 'POST',
        url: '/api/models-dev/refresh',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: {},
      })
      expect(refreshed.statusCode).toBe(200)
      expect((refreshed.json() as { status: { models: number; source: string } }).status).toMatchObject({ models: 1, source: 'live' })
    } finally {
      await h.close()
    }
  })

  it('validates the new settings and hides official data when disabled', async () => {
    const { h, cookie } = await setup()
    try {
      const saved = await h.app.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { modelsDevEnabled: false, modelsDevUrl: 'https://example.com/api.json', modelsDevRefreshHours: 12 },
      })
      expect(saved.statusCode).toBe(200)
      const settings = (saved.json() as { settings: { modelsDevEnabled: boolean; modelsDevUrl: string; modelsDevRefreshHours: number } }).settings
      expect(settings).toMatchObject({ modelsDevEnabled: false, modelsDevUrl: 'https://example.com/api.json', modelsDevRefreshHours: 12 })

      const models = await h.app.inject({ method: 'GET', url: '/api/models', headers: cookieHeader(cookie) })
      const body = models.json() as { modelsDev: { enabled: boolean }; models: Array<{ official: unknown }> }
      expect(body.modelsDev.enabled).toBe(false)
      expect(body.models.every(model => model.official === null)).toBe(true)

      const invalid = await h.app.inject({
        method: 'PUT',
        url: '/api/settings',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: { modelsDevUrl: 'not-a-url' },
      })
      expect(invalid.statusCode).toBe(400)
    } finally {
      await h.close()
    }
  })

  it('returns a clear error when no account can be probed', async () => {
    const h = await createHarness()
    try {
      const cookie = await h.login()
      const accountId = await h.addAccount()
      await h.services.catalog.refresh()
      h.services.store.updateAccount(accountId, { enabled: false })
      const response = await h.app.inject({
        method: 'POST',
        url: '/api/models/xopglm52/probe',
        headers: { ...cookieHeader(cookie), 'content-type': 'application/json' },
        payload: {},
      })
      expect(response.statusCode).toBe(400)
      expect((response.json() as { error: { code: string } }).error.code).toBe('probe_invalid')
    } finally {
      await h.close()
    }
  })
})
