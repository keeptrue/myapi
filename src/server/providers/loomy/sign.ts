import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { LoomyConfig } from './endpoints.js'

/**
 * HMAC-SHA1 request signing for the Loomy account plane (CAccount), mirroring the
 * desktop client's `generateSignature`.
 *
 * The string-to-sign is nine `\n`-joined segments:
 *
 * ```text
 *   METHOD
 *   ESCAPED_PATH          RFC3986 §3.3 per-segment, then `!'()*` escaped
 *   ESCAPED_QUERY         always empty — no account endpoint takes a query
 *   CONTENT_MD5           base64(md5(body bytes)); empty string without a body
 *   CONTENT_TYPE          "application/json"
 *   DATE                  `Tue, 07 Oct 2026 08:00:00 GMT` (JS toUTCString shape)
 *   NONCE                 UUID v4, hyphens kept (client uses randomUUID verbatim)
 *   SIGNED_HEADERS        always empty — the client signs no `x-` headers
 *   CANONICALIZED_HEADERS always empty
 * ```
 *
 * Two easy-to-get-wrong details: the path keeps its leading slash and never ends in
 * one, and the last two segments are empty, so the joined string ends with `\n\n`.
 * Building it from an array join makes the segment count impossible to get wrong.
 *
 * The MD5 segment must cover exactly the bytes sent on the wire, so callers pass the
 * same compact-serialized body string to both this module and the HTTP layer.
 *
 * This HMAC is client fingerprinting, not a security boundary — the key ships inside
 * the installer.
 */

const CONTENT_TYPE = 'application/json'

/** RFC3986-escape one path segment (JS `encodeURIComponent` plus `!'()*`). */
function escapePathSegment(segment: string): string {
  let out = ''
  for (const byte of Buffer.from(segment, 'utf8')) {
    const ch = String.fromCharCode(byte)
    if (/[A-Za-z0-9\-_.~]/u.test(ch)) {
      out += ch
    } else {
      out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`
    }
  }
  return out
}

/** Build ESCAPED_PATH: per-segment escape, joined by `/`, no trailing slash. */
export function buildEscapedPath(path: string): string {
  const clean = path.startsWith('/') ? path : `/${path}`
  const trimmed = clean.length > 1 && clean.endsWith('/') ? clean.slice(0, -1) : clean
  return trimmed.split('/').map(escapePathSegment).join('/')
}

/** base64(md5(bytes)); empty input yields an empty string (client `contentMD5('')`). */
export function contentMd5(body: string): string {
  if (body === '') return ''
  return createHash('md5').update(body, 'utf8').digest('base64')
}

/** The nine-segment string-to-sign. Exported for test vectors. */
export function stringToSign(method: string, path: string, md5: string, date: string, nonce: string): string {
  return [
    method.toUpperCase(),
    buildEscapedPath(path),
    '',
    md5,
    CONTENT_TYPE,
    date,
    nonce,
    '',
    '',
  ].join('\n')
}

/** Headers for one signed CAccount request: `Authorization` / `Date` / `Nonce` (+ `Content-MD5`). */
export function signedHeaders(
  config: LoomyConfig,
  method: string,
  path: string,
  bodyString: string,
  now = new Date(),
): Record<string, string> {
  const md5 = contentMd5(bodyString)
  const date = now.toUTCString()
  const nonce = randomUUID()
  const mac = createHmac('sha1', config.accessKeySecret)
  mac.update(stringToSign(method, path, md5, date, nonce), 'utf8')
  const signature = mac.digest('base64')
  const headers: Record<string, string> = {
    Authorization: `account ${config.accessKeyId}:${signature}`,
    Date: date,
    Nonce: nonce,
  }
  if (md5 !== '') headers['Content-MD5'] = md5
  return headers
}
