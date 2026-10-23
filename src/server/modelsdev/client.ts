import { MODELS_DEV_RESPONSE_LIMIT, MODELS_DEV_TIMEOUT_MS } from '../../shared/constants.js'
import { readLimited } from '../http.js'
import { truncate } from '../util.js'
import { normalizeApi } from './normalize.js'
import type { ModelsDevSnapshot } from './types.js'

export class ModelsDevFetchError extends Error {
  constructor(message: string, readonly status = 0) {
    super(message)
    this.name = 'ModelsDevFetchError'
  }
}

export interface ModelsDevFetchResult {
  notModified: boolean
  etag: string
  snapshot?: ModelsDevSnapshot
}

/** Fetch and normalize models.dev; callers keep the previous snapshot on failure. */
export async function fetchModelsDev(
  url: string,
  etag: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelsDevFetchResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': 'myapi/0.1.0',
  }
  if (etag !== '') headers['If-None-Match'] = etag

  let response: Response
  try {
    response = await fetchImpl(url, {
      headers,
      redirect: 'follow',
      signal: AbortSignal.timeout(MODELS_DEV_TIMEOUT_MS),
    })
  } catch (error: unknown) {
    if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
      throw new ModelsDevFetchError(`models.dev 请求超时（${Math.round(MODELS_DEV_TIMEOUT_MS / 1000)}s）`)
    }
    throw new ModelsDevFetchError(`models.dev 请求失败：${truncate(error instanceof Error ? error.message : String(error), 300)}`)
  }

  const nextEtag = response.headers.get('etag') ?? etag
  if (response.status === 304) {
    await response.body?.cancel().catch(() => undefined)
    return { notModified: true, etag: nextEtag }
  }
  if (!response.ok) {
    const text = await readLimited(response, 64 * 1024)
    throw new ModelsDevFetchError(`models.dev HTTP ${response.status}：${truncate(text, 300)}`, response.status)
  }

  const text = await readLimited(response, MODELS_DEV_RESPONSE_LIMIT)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ModelsDevFetchError(`models.dev 返回的 JSON 解析失败（${text.length} 字符）`)
  }
  const now = Date.now()
  const snapshot = normalizeApi(parsed, url, now, nextEtag)
  if (snapshot.models.length === 0) {
    throw new ModelsDevFetchError('models.dev 返回的模型列表为空')
  }
  return { notModified: false, etag: nextEtag, snapshot }
}
