import type { FastifyReply, FastifyRequest } from 'fastify'
import { CSRF_HEADER, PANEL_COOKIE } from '../../shared/constants.js'
import type { AuthService } from '../auth.js'

export function jsonError(reply: FastifyReply, status: number, message: string, code = 'invalid_request_error'): FastifyReply {
  return reply.code(status).type('application/json; charset=utf-8').send({
    error: { message, type: status >= 500 ? 'api_error' : 'invalid_request_error', code },
  })
}

export function clientIp(request: FastifyRequest): string {
  return request.ip || request.socket.remoteAddress || 'unknown'
}

/** Panel route guard: valid signed session cookie with the current auth version. */
export function requirePanel(auth: AuthService) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = request.cookies[PANEL_COOKIE]
    if (!auth.verifyPanel(token)) {
      jsonError(reply, 401, '面板登录已失效，请重新登录', 'panel_auth_required')
    }
  }
}

/** State-changing panel calls must be same-origin JSON with the CSRF marker. */
export function guardMutation(request: FastifyRequest, reply: FastifyReply): boolean {
  const method = request.method.toUpperCase()
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return true
  const origin = request.headers.origin
  if (origin !== undefined && origin !== '') {
    const host = request.headers.host
    try {
      if (new URL(origin).host !== host) {
        jsonError(reply, 403, '跨站请求被拒绝', 'origin_not_allowed')
        return false
      }
    } catch {
      jsonError(reply, 403, 'Origin 非法', 'origin_not_allowed')
      return false
    }
  }
  if (request.headers[CSRF_HEADER] !== '1') {
    jsonError(reply, 403, '缺少 CSRF 标记', 'csrf_required')
    return false
  }
  return true
}

export function maskToken(token: string): string {
  if (token.length <= 8) return '***'
  return `${token.slice(0, 4)}…${token.slice(-4)}`
}

export function parsePositiveInt(value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(Math.max(Math.floor(parsed), min), max)
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map(item => item.trim())
}
