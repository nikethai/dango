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
 *   slow-<n>    waits n seconds before the first word, then streams slowly (time to press Stop)
 *   drip-<ms>   streams at once, one 16-character piece every <ms> (a long run that never goes quiet)
 *   empty       finishes without any text
 *   drop        streams half the answer, then closes the connection without finishing
 * Without a mode (http://127.0.0.1:<port>/v1) it behaves as `ok`. In every answering mode, Dango's fact-extraction
 * and contradiction-check calls get structured replies (see `replyText`).
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function systemText(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  return messages
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => textOf(m.content))
    .join('\n')
}

/**
 * Answers Dango's own background calls so knowledge flows can be driven without a real model:
 * - fact extraction: every `REMEMBER: <fact>` line in the excerpt becomes a fact;
 * - contradiction check: a saved statement contradicts the new one when they match once digits are ignored.
 * Anything else gets the echo. A multi-line message is echoed on its own lines, so a list stays a list.
 */
function replyText(body) {
  const system = systemText(body)
  const user = lastUserText(body)
  if (system.startsWith('You extract durable long-term memories')) {
    // The echo repeats the line in the assistant's turn, so each fact once.
    const texts = new Set([...user.matchAll(/REMEMBER:\s*(.+)/g)].map((m) => m[1].trim()))
    const facts = [...texts].map((content) => ({ content, tags: [], scope: 'global' }))
    return JSON.stringify({ facts })
  }
  if (system.startsWith('You compare a new statement')) {
    const saved = JSON.parse(user.match(/Saved statements:\n(.*)\n\nNew statement:/s)?.[1] ?? '[]')
    const next = JSON.parse(user.split('New statement:\n')[1] ?? '""')
    const shape = (s) => s.replace(/\d+/g, '#').trim().toLowerCase()
    return JSON.stringify({ contradicts: saved.filter((s) => s.text !== next && shape(s.text) === shape(next)).map((s) => s.id) })
  }
  return user.includes('\n') ? `Echo:\n${user}` : `Echo: ${user}`
}

async function answer(res, body, { delayMs = 0, pieceDelayMs = 0, empty = false, drop = false } = {}) {
  const text = empty ? '' : replyText(body)
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
  if (delayMs) await sleep(delayMs)
  const pieces = text.match(/.{1,16}/gs) ?? []
  for (const [i, piece] of pieces.entries()) {
    if (res.destroyed) return
    if (drop && i >= Math.ceil(pieces.length / 2)) {
      res.destroy()
      return
    }
    res.write(chunk(id, { content: piece }))
    if (pieceDelayMs) await sleep(pieceDelayMs)
  }
  if (res.destroyed) return
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
  const slow = mode.match(/^slow-(\d+)$/)
  if (slow) return answer(res, body, { delayMs: Number(slow[1]) * 1000, pieceDelayMs: 300 })
  const drip = mode.match(/^drip-(\d+)$/)
  if (drip) return answer(res, body, { delayMs: 1000, pieceDelayMs: Number(drip[1]) })
  if (mode === 'empty') return answer(res, body, { empty: true })
  if (mode === 'drop') return answer(res, body, { drop: true })
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
    // Text parts per user message ("s" = a plain string), to see how merged turns arrive.
    const userParts = (Array.isArray(body.messages) ? body.messages : [])
      .filter((m) => m.role === 'user')
      .map((m) => (Array.isArray(m.content) ? m.content.length : 's'))
      .join(',')
    console.log(`${new Date().toISOString()} ${mode} POST chat stream=${Boolean(body.stream)} user=[${userParts}]${markers}`)
    handleCompletion(res, mode, body)
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`fake provider on http://127.0.0.1:${PORT}/v1 (modes: ok, 401, 402, 429-<n>, 400-context, slow-<n>, drip-<ms>, empty, drop)`)
})
