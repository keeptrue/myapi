import { describe, expect, it } from 'vitest'
import { createHarness } from '../../helpers/harness.js'
import { json, sse } from '../../helpers/fake-astron.js'

function auth(key: string): Record<string, string> {
  return { authorization: `Bearer ${key}`, 'content-type': 'application/json' }
}

describe('v1 gateway', () => {
  it('rejects requests without a key and exposes the catalog with one', async () => {
    const h = await createHarness()
    try {
      const unauth = await h.app.inject({ method: 'GET', url: '/v1/models' })
      expect(unauth.statusCode).toBe(401)
      expect(unauth.json()).toMatchObject({ error: { code: 'auth_required' } })

      await h.addAccount()
      await h.services.astudioCatalog.refresh()
      const key = h.createKey()
      const models = await h.app.inject({ method: 'GET', url: '/v1/models', headers: auth(key) })
      expect(models.statusCode).toBe(200)
      const payload = models.json() as { data: Array<{ id: string; providers: Array<{ available: boolean }> }> }
      expect(payload.data.map(item => item.id).sort()).toEqual(['glm-5.2', 'spark-x2.5'])
      expect(payload.data.find(item => item.id === 'glm-5.2')?.providers[0]?.available).toBe(true)
    } finally {
      await h.close()
    }
  })

  it('proxies a non-streaming chat completion and rewrites the model', async () => {
    const h = await createHarness()
    try {
      await h.addAccount()
      await h.services.astudioCatalog.refresh()
      const key = h.createKey()
      const response = await h.app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: auth(key),
        payload: { model: 'GLM-5.2', messages: [{ role: 'user', content: 'hi' }] },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { model: string; choices: Array<{ message: { content: string } }> }
      expect(body.model).toBe('GLM-5.2')
      expect(body.choices[0]?.message.content).toBe('hello from fake')
      expect(h.fake.inferenceCalls[0]?.body).toMatchObject({ model: 'xopglm52' })
      expect(h.services.usage.stats.total.requests).toBe(1)
    } finally {
      await h.close()
    }
  })

  it('relays a streaming chat completion and records usage', async () => {
    const h = await createHarness()
    try {
      await h.addAccount()
      await h.services.astudioCatalog.refresh()
      const key = h.createKey()
      h.fake.chatHandler = () => sse([
        'data: {"id":"c1","object":"chat.completion.chunk","model":"xopglm52","choices":[{"index":0,"delta":{"content":"he"}}]}\n\n',
        'data: {"id":"c1","object":"chat.completion.chunk","model":"xopglm52","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ])
      const response = await h.app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: auth(key),
        payload: { model: 'GLM-5.2', stream: true, messages: [{ role: 'user', content: 'hi' }] },
      })
      expect(response.statusCode).toBe(200)
      expect(response.headers['content-type']).toContain('text/event-stream')
      expect(response.body).toContain('"model":"GLM-5.2"')
      expect(response.body).toContain('[DONE]')
      expect(h.services.usage.stats.total.requests).toBe(1)
      expect(h.services.usage.stats.total.completionTokens).toBe(2)
    } finally {
      await h.close()
    }
  })

  it('translates Anthropic messages in both directions', async () => {
    const h = await createHarness()
    try {
      await h.addAccount()
      await h.services.astudioCatalog.refresh()
      const key = h.createKey()

      const response = await h.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        payload: {
          model: 'GLM-5.2',
          max_tokens: 32,
          system: 'be brief',
          messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { type: string; content: Array<{ type: string; text: string }>; usage: { input_tokens: number } }
      expect(body.type).toBe('message')
      expect(body.content[0]?.text).toBe('hello from fake')
      expect(body.usage.input_tokens).toBe(10)
      expect(h.fake.inferenceCalls[0]?.body).toMatchObject({ model: 'xopglm52' })
    } finally {
      await h.close()
    }
  })

  it('streams Anthropic events from chat chunks', async () => {
    const h = await createHarness()
    try {
      await h.addAccount()
      await h.services.astudioCatalog.refresh()
      const key = h.createKey()
      h.fake.chatHandler = () => sse([
        'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"hel"}}]}\n\n',
        'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":5,"completion_tokens":2}}\n\n',
        'data: [DONE]\n\n',
      ])
      const response = await h.app.inject({
        method: 'POST',
        url: '/v1/messages',
        headers: { 'x-api-key': key, 'content-type': 'application/json' },
        payload: { model: 'GLM-5.2', max_tokens: 16, stream: true, messages: [{ role: 'user', content: 'hi' }] },
      })
      expect(response.statusCode).toBe(200)
      expect(response.body).toContain('event: message_start')
      expect(response.body).toContain('text_delta')
      expect(response.body).toContain('event: message_stop')
    } finally {
      await h.close()
    }
  })

  it('passes through Responses payloads', async () => {
    const h = await createHarness()
    try {
      await h.addAccount()
      await h.services.astudioCatalog.refresh()
      const key = h.createKey()
      h.fake.chatHandler = (body) => json({
        id: 'resp_1',
        object: 'response',
        model: (body as { model: string }).model,
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }],
        usage: { input_tokens: 4, output_tokens: 2 },
      })
      const response = await h.app.inject({
        method: 'POST',
        url: '/v1/responses',
        headers: auth(key),
        payload: { model: 'GLM-5.2', input: 'hi' },
      })
      expect(response.statusCode).toBe(200)
      const body = response.json() as { model: string; object: string }
      expect(body.object).toBe('response')
      expect(body.model).toBe('GLM-5.2')
      expect(h.services.usage.stats.total.completionTokens).toBe(2)
    } finally {
      await h.close()
    }
  })

  it('enforces model allowlists', async () => {
    const h = await createHarness()
    try {
      await h.addAccount()
      await h.services.astudioCatalog.refresh()
      const key = h.createKey({ allowedModels: ['spark-x2.5'] })
      const response = await h.app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: auth(key),
        payload: { model: 'GLM-5.2', messages: [{ role: 'user', content: 'hi' }] },
      })
      expect(response.statusCode).toBe(403)
      expect(response.json()).toMatchObject({ error: { code: 'model_not_allowed' } })
    } finally {
      await h.close()
    }
  })

  it('fails over to another account on 429', async () => {
    const h = await createHarness()
    try {
      const first = await h.addAccount({ accountId: 'acc-1' })
      const second = await h.addAccount({ accountId: 'acc-2' })
      await h.services.astudioCatalog.refresh()
      const key = h.createKey()
      let calls = 0
      h.fake.chatHandler = () => {
        calls += 1
        if (calls === 1) return json({ error: { message: 'rate limited' } }, 429)
        return json({
          id: 'ok',
          model: 'xopglm52',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      }
      const response = await h.app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: auth(key),
        payload: { model: 'GLM-5.2', messages: [{ role: 'user', content: 'hi' }] },
      })
      expect(response.statusCode).toBe(200)
      expect(h.fake.inferenceCalls.length).toBeGreaterThanOrEqual(2)
      const failed = h.services.store.account(first)
      expect(failed?.cooldownUntil).toBeGreaterThan(Date.now())
      expect(h.services.store.account(second)?.successes).toBeGreaterThan(0)
    } finally {
      await h.close()
    }
  })

  it('refreshes a credential on 401 and retries once', async () => {
    const h = await createHarness()
    try {
      await h.addAccount()
      await h.services.astudioCatalog.refresh()
      const key = h.createKey()
      let calls = 0
      const refreshBefore = h.fake.refreshCalls
      h.fake.chatHandler = () => {
        calls += 1
        if (calls === 1) return json({ error: { message: 'expired' } }, 401)
        return json({
          id: 'ok',
          model: 'xopglm52',
          choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        })
      }
      const response = await h.app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: auth(key),
        payload: { model: 'GLM-5.2', messages: [{ role: 'user', content: 'hi' }] },
      })
      expect(response.statusCode).toBe(200)
      expect(h.fake.refreshCalls).toBeGreaterThan(refreshBefore)
      expect(h.fake.inferenceCalls.length).toBe(2)
    } finally {
      await h.close()
    }
  })
})
