#!/usr/bin/env node
/**
 * Loopback fake OpenAI-compatible provider for manual and Claude-driven test runs
 * (docs/specs/2026-10-31-desktop-testing-after-codex-walk.md).
 *
 * Base URL: http://127.0.0.1:<port>/<mode>/v1, where <mode> picks the answer:
 *   ok          streams "Echo: <last user message>"
 *   401         invalid API key
 *   402         insufficient_quota
 *   429-<n>     rate limited with Retry-After: <n>
 *   400-context context_length_exceeded
 * Without a mode (http://127.0.0.1:<port>/v1) it behaves as `ok`.
 *
 * Logs one line per request with booleans only: whether each marker string (MARKERS, comma separated)
 * appears in a system message or anywhere in the request. Message bodies are never logged.
 *
 * Usage: PORT=8787 MARKERS=UNIQUE-MARKER node scripts/fake-provider.mjs
 */
import { createServer } from 'node:http'

const PORT = Number(process.env.PORT || 8787)
const MARKERS = (process.env.MARKERS || '')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean)
const MODEL = 'fake-model'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Expose-Headers': 'Retry-After',
}

function sendJson(res, status, body, headers = {}) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

function sendError(res, status, type, code, message, headers) {
  sendJson(res, status, { error: { message, type, code } }, headers)
}

function textOf(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
  return ''
}

function markerReport(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const system = messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => textOf(m.content))
    .join('\n')
  const all = JSON.stringify(body ?? {})
  return MARKERS.map((m) => `${m}: system=${system.includes(m)} any=${all.includes(m)}`).join(' ')
}

function lastUserText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  const user = [...messages].reverse().find((m) => m.role === 'user')
  return user ? textOf(user.content) : ''
}

function chunk(id, delta, finishReason = null) {
  return `data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`
}

function answer(res, body) {
  const text = `Echo: ${lastUserText(body)}`
  const id = `chatcmpl-fake-${Date.now()}`
  const usage = { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 }
  if (!body?.stream) {
    sendJson(res, 200, {
      id,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: MODEL,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }],
      usage,
    })
    return
  }
  res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
  res.write(chunk(id, { role: 'assistant', content: '' }))
  for (const piece of text.match(/.{1,16}/gs) ?? []) res.write(chunk(id, { content: piece }))
  res.write(chunk(id, {}, 'stop'))
  res.write(
    `data: ${JSON.stringify({ id, object: 'chat.completion.chunk', model: MODEL, choices: [], usage })}\n\n`
  )
  res.end('data: [DONE]\n\n')
}

function handleCompletion(res, mode, body) {
  if (mode === '401') return sendError(res, 401, 'invalid_request_error', 'invalid_api_key', 'Incorrect API key provided.')
  if (mode === '402') {
    return sendError(res, 402, 'insufficient_quota', 'insufficient_quota', 'You exceeded your current quota.')
  }
  const rateLimit = mode.match(/^429-(\d+)$/)
  if (rateLimit) {
    return sendError(res, 429, 'rate_limit_error', 'rate_limit_exceeded', 'Rate limit reached.', {
      'Retry-After': rateLimit[1],
    })
  }
  if (mode === '400-context') {
    return sendError(
      res,
      400,
      'invalid_request_error',
      'context_length_exceeded',
      "This model's maximum context length was exceeded."
    )
  }
  return answer(res, body)
}

const server = createServer((req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS)
    res.end()
    return
  }
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)
  const match = url.pathname.match(/^(?:\/([^/]+))?\/v1\/(models|chat\/completions)$/)
  if (!match) return sendError(res, 404, 'not_found', 'not_found', `No route for ${url.pathname}`)
  const mode = match[1] ?? 'ok'

  if (match[2] === 'models') {
    console.log(`${new Date().toISOString()} ${mode} GET models`)
    return sendJson(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'fake' }] })
  }

  let raw = ''
  req.on('data', (data) => {
    raw += data
  })
  req.on('end', () => {
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      return sendError(res, 400, 'invalid_request_error', 'invalid_json', 'Body is not JSON.')
    }
    const markers = MARKERS.length ? ` ${markerReport(body)}` : ''
    console.log(`${new Date().toISOString()} ${mode} POST chat stream=${Boolean(body.stream)}${markers}`)
    handleCompletion(res, mode, body)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake provider on http://127.0.0.1:${PORT}/v1 (modes: ok, 401, 402, 429-<n>, 400-context)`)
})
