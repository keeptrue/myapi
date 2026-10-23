import type { LoomyConfig } from './endpoints.js'
import { signedHeaders } from './sign.js'

/**
 * Thin wrappers around Loomy's two outbound request shapes: signed POSTs to the account
 * plane and token-authenticated calls to the integration gateway. Both share one timeout
 * and one "business code → human words" vocabulary so the failure semantics cannot drift
 * between callers.
 *
 * Both planes answer HTTP 200 with `{code, desc, data}`: `000000` is success;
 * `020002` / `100002` mean the login session is dead (two planes, two codes); everything
 * else is a business failure with `desc` as the upstream wording.
 */

const SUCCESS_CODE = '000000'
const AUTH_ERROR_CODES = new Set(['020002', '100002'])

export function businessCode(payload: unknown): string {
  return typeof payload === 'object' && payload !== null
    ? String((payload as Record<string, unknown>)['code'] ?? '').trim()
    : ''
}

export function isAuthError(code: string): boolean {
  return AUTH_ERROR_CODES.has(code)
}

export function upstreamMessage(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return ''
  const record = payload as Record<string, unknown>
  const desc = record['desc'] ?? record['message']
  return typeof desc === 'string' ? desc.trim() : ''
}

export class LoomyHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'LoomyHttpError'
  }
}

async function readPayload(response: Response, what: string): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new LoomyHttpError(response.status, `${what}返回了非 JSON 响应（HTTP ${response.status}）`)
  }
}

/** One signed POST to the account plane (login chain; no account context yet). */
export async function signedPost(
  config: LoomyConfig,
  path: string,
  body: Record<string, unknown>,
  what: string,
): Promise<unknown> {
  const bodyString = JSON.stringify(body)
  const headers = signedHeaders(config, 'POST', path, bodyString)
  let response: Response
  try {
    response = await fetch(`${config.xfyunBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: bodyString,
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new LoomyHttpError(504, `${what}超时，请稍后重试`)
    }
    throw new LoomyHttpError(502, `${what}失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    throw new LoomyHttpError(response.status, `${what}返回 HTTP ${response.status}（上游地址 ${config.xfyunBaseUrl}）`)
  }
  return readPayload(response, what)
}

/** One request to the integration gateway carrying `token: <session>` (+ Bearer twin).
 *  Business-code interpretation is left to the caller — success codes differ per endpoint
 *  (the model list endpoint does not return a `code` at all). */
export async function tokenRequest(
  config: LoomyConfig,
  method: 'GET' | 'POST',
  path: string,
  session: string,
  body: Record<string, unknown> | undefined,
  what: string,
): Promise<unknown> {
  if (session.trim() === '') {
    throw new LoomyHttpError(401, 'Loomy 账号缺少 session')
  }
  const headers: Record<string, string> = {
    token: session,
    Authorization: `Bearer ${session}`,
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(`${config.integrationBaseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(config.requestTimeoutMs),
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') {
      throw new LoomyHttpError(504, `${what}超时，请稍后重试`)
    }
    throw new LoomyHttpError(502, `${what}失败：${error instanceof Error ? error.message : String(error)}`)
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new LoomyHttpError(401, `${what}：Loomy 登录态已失效，请重新登录（HTTP ${response.status}）`)
    }
    throw new LoomyHttpError(response.status, `${what}返回 HTTP ${response.status}`)
  }
  return readPayload(response, what)
}

/** One streaming inference call against the OpenAI-compatible model gateway. The response
 *  is returned raw — the gateway owns streaming, retries and usage extraction. */
export async function inference(
  config: LoomyConfig,
  path: string,
  session: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  if (session.trim() === '') {
    throw new LoomyHttpError(401, 'Loomy 账号缺少 session，无法转发（请重新登录）')
  }
  const headers: Record<string, string> = {
    token: session,
    Authorization: `Bearer ${session}`,
    Accept: 'text/event-stream',
    'Content-Type': 'application/json',
  }
  try {
    return await fetch(`${config.integrationBaseUrl}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal,
    })
  } catch (error) {
    throw new LoomyHttpError(502, `推理请求失败：${error instanceof Error ? error.message : String(error)}`)
  }
}

export { SUCCESS_CODE }
