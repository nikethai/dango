import { recordId, type SourceRecord } from './types'

// The subset of the Gmail API (`users.threads.get?format=full`) that slice 10 reads.
export type GmailHeader = { name: string; value: string }
export type GmailMessagePart = {
  partId?: string
  mimeType?: string
  filename?: string
  headers?: GmailHeader[]
  body?: { size?: number; data?: string; attachmentId?: string }
  parts?: GmailMessagePart[]
}
export type GmailMessage = {
  id: string
  threadId: string
  labelIds?: string[]
  internalDate?: string
  payload?: GmailMessagePart
}
export type GmailThread = { id: string; historyId?: string; messages: GmailMessage[] }

const NOISE_LABELS = new Set(['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'CATEGORY_UPDATES'])

function header(headers: GmailHeader[] | undefined, name: string): string | undefined {
  const lower = name.toLowerCase()
  return headers?.find((h) => h.name.toLowerCase() === lower)?.value
}

/** Every address in an address-list header, lower-cased, in order. Quoted display names may hold commas. */
export function parseAddresses(value: string | undefined): string[] {
  if (!value) return []
  const unquoted = value.replace(/"(?:[^"\\]|\\.)*"/g, '""')
  const out: string[] = []
  for (const part of unquoted.split(',')) {
    const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(part)
    const bare = angle ? null : /[^\s<>"',;:()]+@[^\s<>"',;:()]+/.exec(part)
    const address = (angle?.[1] ?? bare?.[0])?.toLowerCase()
    if (address) out.push(address)
  }
  return out
}

/** The display name of a single-address header, without quotes, or undefined. */
function displayName(value: string | undefined): string | undefined {
  if (!value) return undefined
  const i = value.lastIndexOf('<')
  if (i <= 0) return undefined
  const name = value
    .slice(0, i)
    .trim()
    .replace(/^"(.*)"$/, '$1')
    .replace(/\\(.)/g, '$1')
    .trim()
  return name || undefined
}

/** Hostile-input bounds: cut decoded bodies before any regex runs, and cap the stored text. */
export const MAX_HTML_CHARS = 200_000
export const MAX_PLAIN_CHARS = 50_000
export const MAX_TEXT_CHARS = 20_000

function decodeBytes(bytes: Uint8Array, charset: string | undefined): string {
  if (charset) {
    try {
      return new TextDecoder(charset).decode(bytes)
    } catch {
      // Unknown label: fall back to UTF-8.
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

function decodeBase64Url(data: string, charset: string | undefined): string {
  try {
    const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return decodeBytes(bytes, charset)
  } catch {
    return ''
  }
}

function partCharset(part: GmailMessagePart): string | undefined {
  const type = header(part.headers, 'Content-Type')
  return type ? /charset\s*=\s*"?([^";\s]+)/i.exec(type)?.[1] : undefined
}

/** The first inline (non-attachment) part of the given type, depth first. */
function findPart(part: GmailMessagePart | undefined, mimeType: string): GmailMessagePart | undefined {
  if (!part) return undefined
  if (part.mimeType?.toLowerCase() === mimeType && !part.filename && part.body?.data) return part
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType)
    if (found) return found
  }
  return undefined
}

const ENTITIES: Record<string, string> = { nbsp: ' ', lt: '<', gt: '>', quot: '"', apos: "'", amp: '&' }
function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? Number.parseInt(e.slice(2), 16) : Number.parseInt(e.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m
    }
    return ENTITIES[e.toLowerCase()] ?? m
  })
}

/**
 * Removes every span from an opener match to its closer, or to the end of the text when unclosed.
 * Linear: each search starts where the last one ended, and an unclosed opener ends the scan.
 */
function removeSpans(s: string, opener: RegExp, closer: (open: RegExpExecArray) => RegExp): string {
  const open = new RegExp(opener.source, 'gi')
  let out = ''
  let pos = 0
  for (;;) {
    open.lastIndex = pos
    const o = open.exec(s)
    if (!o) return out + s.slice(pos)
    out += s.slice(pos, o.index)
    const close = closer(o)
    close.lastIndex = o.index + o[0].length
    const c = close.exec(s)
    if (!c) return out
    pos = c.index + c[0].length
  }
}

const DROPPED_ELEMENTS = /<(style|script|head|title|noscript|template|textarea)\b/
const QUOTE_CLASS = /\b(gmail_quote|gmail_attr|yahoo_quoted)\b/i

/** The index of the first Gmail/Yahoo quote container (`<div|blockquote class="gmail_quote">`), or -1. */
function quoteStart(s: string): number {
  const open = /<(div|blockquote)\b/gi
  for (let o = open.exec(s); o; o = open.exec(s)) {
    const end = s.indexOf('>', o.index)
    if (end < 0) return -1
    if (QUOTE_CLASS.test(s.slice(o.index, end))) return o.index
    open.lastIndex = end + 1
  }
  return -1
}

/** Drops every tag; an unclosed `<` drops the rest. Linear. */
function stripTags(s: string): string {
  let out = ''
  let pos = 0
  for (;;) {
    const lt = s.indexOf('<', pos)
    if (lt < 0) return out + s.slice(pos)
    out += s.slice(pos, lt)
    const gt = s.indexOf('>', lt + 1)
    if (gt < 0) return out
    pos = gt + 1
  }
}

/** Plain text from an HTML body: drops styles, scripts and Gmail/Outlook quote blocks, keeps line breaks. */
export function htmlToText(html: string): string {
  let s = removeSpans(html, /<!--/, () => /-->/g)
  s = removeSpans(s, DROPPED_ELEMENTS, (o) => new RegExp(`</${o[1]}\\s*>`, 'gi'))
  // Gmail wraps quoted history in a gmail_quote div or blockquote; anything after it is history.
  const quote = quoteStart(s)
  if (quote >= 0) s = s.slice(0, quote)
  s = removeSpans(s, /<blockquote\b/, () => /<\/blockquote\s*>/gi)
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6]|pre|table)\s*>/gi, '\n')
  let text: string
  if (typeof DOMParser !== 'undefined') {
    text = new DOMParser().parseFromString(s, 'text/html').body.textContent ?? ''
  } else {
    text = decodeEntities(stripTags(s))
  }
  return text
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const QUOTE_HEADERS = [/^On .+ wrote:$/, /^Vào .+ đã viết:$/]
const QUOTE_HEADER_STARTS = [/^On /, /^Vào /]
const QUOTE_HEADER_ENDS = [/wrote:$/, /đã viết:$/]
/** A real quote header names an address, a year or a time; prose rarely does. */
const HEADER_DETAIL = /<[^<>]*>|\S@\S|\b\d{4}\b|\b\d{1,2}:\d{2}\b/

/** True when the first non-blank line from `from` on is `>`-quoted, or there is none. */
function quotedOrEnd(lines: string[], from: number): boolean {
  for (let i = from; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line) return line.startsWith('>')
  }
  return true
}

/** The number of lines (1 or 2) of a quote header starting at line `i`, or 0. */
function quoteHeaderAt(lines: string[], i: number): number {
  const line = lines[i].trim()
  let size = 0
  let joined = line
  if (QUOTE_HEADERS.some((re) => re.test(line))) size = 1
  else {
    const next = (lines[i + 1] ?? '').trim()
    if (QUOTE_HEADER_STARTS.some((re, k) => re.test(line) && QUOTE_HEADER_ENDS[k].test(next))) {
      size = 2
      joined = `${line} ${next}`
    }
  }
  if (!size || !HEADER_DETAIL.test(joined) || !quotedOrEnd(lines, i + size)) return 0
  return size
}

/**
 * The new text of a reply: everything before the first quote header (`On … wrote:`, `Vào … đã viết:`,
 * including headers Gmail wraps onto two lines, when they name an address, year or time and are followed by
 * `>` lines or nothing), the first `>` line, or an Outlook "Original Message" line.
 */
export function extractNewText(body: string): string {
  const lines = body.normalize('NFC').replace(/\r\n?/g, '\n').split('\n')
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line.startsWith('>') || /^-{2,}\s*Original Message\s*-{2,}$/i.test(line) || quoteHeaderAt(lines, i)) {
      cut = i
      break
    }
  }
  return lines.slice(0, cut).join('\n').trim()
}

function messageBody(payload: GmailMessagePart | undefined): string {
  const plain = findPart(payload, 'text/plain')
  if (plain?.body?.data) return decodeBase64Url(plain.body.data, partCharset(plain)).slice(0, MAX_PLAIN_CHARS)
  const html = findPart(payload, 'text/html')
  if (html?.body?.data) return htmlToText(decodeBase64Url(html.body.data, partCharset(html)).slice(0, MAX_HTML_CHARS))
  return ''
}

function isNoise(labels: string[], headers: GmailHeader[] | undefined, from: string | undefined): boolean {
  if (labels.some((l) => NOISE_LABELS.has(l))) return true
  if (header(headers, 'List-Unsubscribe') !== undefined) return true
  if (header(headers, 'Precedence')?.trim().toLowerCase() === 'bulk') return true
  const local = from?.split('@')[0] ?? ''
  return local.startsWith('no-reply') || local.startsWith('noreply')
}

/**
 * One record per message, unrouted (`scopeId` and `sourceId` null). `sentByMe` trusts only Gmail's `SENT` label:
 * a From header can be spoofed. `ownAddress` is kept for routing callers.
 */
export function normalizeGmailThread(thread: GmailThread, accountId: string, _ownAddress: string): SourceRecord[] {
  return (thread.messages ?? []).map((m) => {
    const headers = m.payload?.headers
    const labels = m.labelIds ?? []
    const fromHeader = header(headers, 'From')
    const from = parseAddresses(fromHeader)[0]
    const participants = [
      ...new Set([
        ...parseAddresses(fromHeader),
        ...parseAddresses(header(headers, 'To')),
        ...parseAddresses(header(headers, 'Cc')),
      ]),
    ]
    const title = (header(headers, 'Subject') ?? '').normalize('NFC')
    const threadId = m.threadId || thread.id
    const authorName = displayName(fromHeader)?.normalize('NFC')
    const rfcMessageId = header(headers, 'Message-ID')?.trim()
    const record: SourceRecord = {
      id: recordId('gmail', m.id),
      sourceKind: 'gmail',
      sourceId: null,
      accountId,
      externalId: m.id,
      threadOrTaskId: threadId,
      scopeId: null,
      author: from ?? '',
      participants,
      occurredAt: Number(m.internalDate ?? 0) || 0,
      title,
      text: extractNewText(messageBody(m.payload)).slice(0, MAX_TEXT_CHARS),
      sentByMe: labels.includes('SENT'),
      noise: isNoise(labels, headers, from),
      link: { label: `Gmail thread "${title}"`, url: `https://mail.google.com/mail/#all/${threadId}` },
    }
    if (authorName) record.authorName = authorName
    if (rfcMessageId) record.rfcMessageId = rfcMessageId
    return record
  })
}
