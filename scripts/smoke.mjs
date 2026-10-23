#!/usr/bin/env node
/**
 * Real-upstream smoke test.
 *
 * Usage:
 *   MYAPI_API_KEY=sk-myapi-... node scripts/smoke.mjs
 *   BASE_URL=http://127.0.0.1:8787 MODEL=GLM-5.2 node scripts/smoke.mjs
 */
const base = (process.env.BASE_URL ?? 'http://127.0.0.1:8787').replace(/\/+$/u, '')
const key = process.env.MYAPI_API_KEY ?? ''
const preferred = process.env.MODEL ?? ''

if (key === '') {
  console.error('MYAPI_API_KEY is required (create one in the console)')
  process.exit(2)
}

const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
let failures = 0

function report(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === '' ? '' : `  ${detail}`}`)
  if (!ok) failures += 1
}

async function getJson(path) {
  const response = await fetch(`${base}${path}`, { headers })
  const text = await response.text()
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { response, body }
}

const health = await fetch(`${base}/healthz`)
report('healthz', health.ok, `HTTP ${health.status}`)

const models = await getJson('/v1/models')
const list = models.body?.data ?? []
report('models', models.response.ok && Array.isArray(list), `${list.length} models`)
const model = preferred !== '' ? preferred : (list.find(item => item.astron?.available)?.id ?? list[0]?.id)
if (model === undefined) {
  console.error('No model available; add an account and refresh the catalog first.')
  process.exit(1)
}
console.log(`Using model: ${model}`)

const chat = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ model, messages: [{ role: 'user', content: 'Reply with the single word: pong' }], max_tokens: 16 }),
})
const chatText = await chat.text()
report('chat non-stream', chat.ok, `HTTP ${chat.status} ${chatText.slice(0, 120)}`)

const stream = await fetch(`${base}/v1/chat/completions`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ model, stream: true, messages: [{ role: 'user', content: 'Say hi in one short sentence.' }], max_tokens: 32 }),
})
const streamText = await stream.text()
report('chat stream', stream.ok && (streamText.includes('[DONE]') || streamText.includes('data:')), `HTTP ${stream.status} ${streamText.length} bytes`)

const responses = await fetch(`${base}/v1/responses`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ model, input: 'Say hi in one short sentence.', max_output_tokens: 32 }),
})
const responsesText = await responses.text()
report('responses', responses.ok, `HTTP ${responses.status} ${responsesText.slice(0, 120)}`)

const messages = await fetch(`${base}/v1/messages`, {
  method: 'POST',
  headers,
  body: JSON.stringify({ model, max_tokens: 32, messages: [{ role: 'user', content: 'Say hi in one short sentence.' }] }),
})
const messagesText = await messages.text()
report('anthropic messages', messages.ok && messagesText.includes('"type":"message"'), `HTTP ${messages.status} ${messagesText.slice(0, 120)}`)

process.exit(failures === 0 ? 0 : 1)
