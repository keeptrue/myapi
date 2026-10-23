import { describe, expect, it } from 'vitest'
import { fetchModelsDev } from '../../../src/server/modelsdev/client.js'

const raw = {
  alpha: {
    id: 'alpha',
    name: 'Alpha',
    models: {
      'model-1': {
        id: 'model-1',
        name: 'Model One',
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1000, output: 100 },
      },
    },
  },
}

describe('models.dev client', () => {
  it('returns notModified for 304 and keeps the new ETag', async () => {
    const result = await fetchModelsDev('https://models.test/api.json', 'old', async () =>
      new Response(null, { status: 304, headers: { etag: 'new-etag' } }))
    expect(result).toEqual({ notModified: true, etag: 'new-etag' })
  })

  it('normalizes a successful payload', async () => {
    const result = await fetchModelsDev('https://models.test/api.json', '', async () =>
      new Response(JSON.stringify(raw), {
        status: 200,
        headers: { 'content-type': 'application/json', etag: 'etag-1' },
      }))
    expect(result.notModified).toBe(false)
    expect(result.etag).toBe('etag-1')
    expect(result.snapshot?.models).toHaveLength(1)
    expect(result.snapshot?.models[0]?.key).toBe('alpha/model-1')
  })

  it('surfaces HTTP and JSON failures without a snapshot', async () => {
    await expect(fetchModelsDev('https://models.test/api.json', '', async () =>
      new Response('upstream down', { status: 502 }))).rejects.toThrow('HTTP 502')
    await expect(fetchModelsDev('https://models.test/api.json', '', async () =>
      new Response('not-json', { status: 200 }))).rejects.toThrow('解析失败')
  })
})
