import type { StoredApiKey } from './store/schema.js'

declare module 'fastify' {
  interface FastifyRequest {
    apiKey?: StoredApiKey
    requestId?: string
  }
}

export {}
