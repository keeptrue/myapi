import { createHash, createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildEscapedPath, contentMd5, signedHeaders, stringToSign } from '../../../src/server/providers/loomy/sign.js'
import { loadLoomyConfigFromEnv, modelBaseUrl } from '../../../src/server/providers/loomy/endpoints.js'
import { extractMsgId, mapModelEntry, maskPhone, normalizePhone, splitRateSuffix } from '../../../src/server/providers/loomy/adapter.js'

const CONFIG = {
  xfyunBaseUrl: 'https://account.xfinfr.com',
  integrationBaseUrl: 'https://loomyad.xunfei.cn',
  accessKeyId: 'test-key',
  accessKeySecret: 'test-secret',
  appId: 'GM3LOOMY',
  requestTimeoutMs: 20_000,
}

describe('loomy signing', () => {
  it('escapes path segments per RFC3986 and drops the trailing slash', () => {
    expect(buildEscapedPath('/login/phone/sendMsgCode')).toBe('/login/phone/sendMsgCode')
    expect(buildEscapedPath('login/phone/')).toBe('/login/phone')
    expect(buildEscapedPath('/a b/c!')).toBe('/a%20b/c%21')
  })

  it('keeps the empty-body MD5 as an empty string and base64-encodes md5 otherwise', () => {
    expect(contentMd5('')).toBe('')
    // The wire format is base64(md5(body)); compare against the platform primitive.
    expect(contentMd5('hi')).toBe(createHash('md5').update('hi', 'utf8').digest('base64'))
  })

  it('builds the nine-segment string-to-sign with two trailing newlines', () => {
    const signed = stringToSign('post', '/x', 'MD5BODY', 'Tue, 07 Oct 2026 08:00:00 GMT', 'nonce-1')
    const segments = signed.split('\n')
    expect(segments).toHaveLength(9)
    expect(segments[0]).toBe('POST')
    expect(segments[1]).toBe('/x')
    expect(segments[3]).toBe('MD5BODY')
    expect(segments[5]).toBe('Tue, 07 Oct 2026 08:00:00 GMT')
    expect(segments[6]).toBe('nonce-1')
    expect(signed.endsWith('\n\n')).toBe(true)
  })

  it('produces the full header set with a verifiable HMAC', () => {
    const now = new Date('2026-10-07T08:00:00Z')
    const headers = signedHeaders(CONFIG, 'POST', '/login/phone/checkCode', '{"a":1}', now)
    expect(headers['Date']).toBe('Wed, 07 Oct 2026 08:00:00 GMT')
    expect(headers.Nonce).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u)
    expect(headers.Authorization).toMatch(/^account test-key:[A-Za-z0-9+/=]+$/u)
    expect(headers['Content-MD5']).toBe(contentMd5('{"a":1}'))
    // Recomputing the HMAC from the documented string-to-sign must reproduce Authorization.
    const mac = createHmac('sha1', CONFIG.accessKeySecret)
    mac.update(stringToSign('POST', '/login/phone/checkCode', headers['Content-MD5'] ?? '', headers.Date ?? '', headers.Nonce ?? ''))
    expect(headers.Authorization).toBe(`account test-key:${mac.digest('base64')}`)
  })

  it('omits Content-MD5 when there is no body', () => {
    const headers = signedHeaders(CONFIG, 'POST', '/x', '', new Date('2026-10-07T08:00:00Z'))
    expect(headers['Content-MD5']).toBeUndefined()
  })
})

describe('loomy config', () => {
  it('splices the model gateway onto the integration base', () => {
    expect(modelBaseUrl(CONFIG)).toBe('https://loomyad.xunfei.cn/api/v1')
  })

  it('falls back to the embedded client constants when no env overrides exist', () => {
    const config = loadLoomyConfigFromEnv()
    expect(config.appId).toBe('GM3LOOMY')
    expect(config.integrationBaseUrl).toContain('loomyad.xunfei.cn')
  })
})

describe('loomy adapter helpers', () => {
  it('normalizes mainland mobile numbers with tolerant prefixes', () => {
    expect(normalizePhone('138 0013 8000')).toBe('13800138000')
    expect(normalizePhone('+8613800138000')).toBe('13800138000')
    expect(normalizePhone('86-13800138000')).toBe('13800138000')
    expect(() => normalizePhone('12345')).toThrow()
    expect(() => normalizePhone('12300138000')).toThrow()
  })

  it('masks phone numbers by characters, not bytes', () => {
    expect(maskPhone('13800138000')).toBe('138****8000')
    expect(maskPhone('123456')).toBe('123456')
  })

  it('splits only x-number rate suffixes off display names', () => {
    expect(splitRateSuffix('DeepSeek V4 Flash 0731 (x3.0)')).toEqual({ name: 'DeepSeek V4 Flash 0731', rate: 'x3.0' })
    expect(splitRateSuffix('GLM 5.3 Flash（x0.8）')).toEqual({ name: 'GLM 5.3 Flash', rate: 'x0.8' })
    expect(splitRateSuffix('Spark X2.5 (限时免费)')).toEqual({ name: 'Spark X2.5 (限时免费)', rate: undefined })
    expect(splitRateSuffix('Spark X2.5 (x0.1)')).toEqual({ name: 'Spark X2.5', rate: 'x0.1' })
  })

  it('extracts the msgid across the upstream field-name and depth variants', () => {
    expect(extractMsgId({ data: { msgid: 'm1' } })).toBe('m1')
    expect(extractMsgId({ data: { msgId: 'm2' } })).toBe('m2')
    expect(extractMsgId({ data: { data: { msgid: 'm3' } } })).toBe('m3')
    expect(extractMsgId({ data: {} })).toBe('')
  })

  it('maps an OpenAI catalog entry onto a provider-agnostic model record', () => {
    const record = mapModelEntry('loomy', {
      id: 'spark-x',
      name: 'Spark X2.5 (x0.1)',
      capabilities: { reasoning: true, function_calling: true, vision: false, input_modalities: ['text'] },
      context_length: 128000,
      max_output_tokens: 16384,
    })
    expect(record).toMatchObject({
      name: 'spark-x',
      providerId: 'loomy',
      upstreamSlug: 'spark-x',
      displayName: 'Spark X2.5',
      contextWindow: 128000,
      maxOutputTokens: 16384,
      reasoningEfforts: ['low', 'medium', 'high'],
      extra: { multiplier: 'x0.1' },
    })
    expect(record?.inputModalities).toEqual(['text'])
  })

  it('marks vision models through either capability signal and drops rows without ids', () => {
    const vision = mapModelEntry('loomy', { id: 'm1', capabilities: { vision: true } })
    expect(vision?.inputModalities).toEqual(['text', 'image'])
    const modal = mapModelEntry('loomy', { id: 'm2', capabilities: { input_modalities: ['TEXT', 'IMAGE'] } })
    expect(modal?.inputModalities).toEqual(['text', 'image'])
    expect(mapModelEntry('loomy', { name: 'no-id' })).toBeUndefined()
  })
})
