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

function decodeBase64Url(data: string): string {
  const b64 = data.replace(/-/g, '+').replace(/_/g, '/')
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder('utf-8').decode(bytes)
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

/** Plain text from an HTML body: drops styles, scripts and Gmail/Outlook quote blocks, keeps line breaks. */
export function htmlToText(html: string): string {
  let s = html.replace(/<(style|script|head|title)\b[\s\S]*?<\/\1\s*>/gi, '').replace(/<!--[\s\S]*?-->/g, '')
  // Gmail wraps quoted history in a gmail_quote div or blockquote; anything after it is history.
  const quote = /<(div|blockquote)\b[^>]*class="[^"]*\b(gmail_quote|gmail_attr|yahoo_quoted)\b[^"]*"[^>]*>/i.exec(s)
  if (quote) s = s.slice(0, quote.index)
  s = s.replace(/<blockquote\b[\s\S]*?<\/blockquote\s*>/gi, '')
  s = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h[1-6]|blockquote|pre|table)\s*>/gi, '\n')
  let text: string
  if (typeof DOMParser !== 'undefined') {
    text = new DOMParser().parseFromString(s, 'text/html').body.textContent ?? ''
  } else {
    text = decodeEntities(s.replace(/<[^>]*>/g, ''))
  }
  return text
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

const QUOTE_HEADERS = [/^On .+ wrote:$/, /^Vào .+ đã viết:$/]
const QUOTE_HEADER_STARTS = [/^On /, /^Vào /]
const QUOTE_HEADER_ENDS = [/wrote:$/, /đã viết:$/]

/**
 * The new text of a reply: everything before the first quote header (`On … wrote:`, `Vào … đã viết:`,
 * including headers Gmail wraps onto two lines), the first `>` line, or an Outlook "Original Message" line.
 */
export function extractNewText(body: string): string {
  const lines = body.normalize('NFC').replace(/\r\n?/g, '\n').split('\n')
  let cut = lines.length
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    const next = (lines[i + 1] ?? '').trim()
    if (
      line.startsWith('>') ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(line) ||
      QUOTE_HEADERS.some((re) => re.test(line)) ||
      QUOTE_HEADER_STARTS.some((re, k) => re.test(line) && QUOTE_HEADER_ENDS[k].test(next))
    ) {
      cut = i
      break
    }
  }
  return lines.slice(0, cut).join('\n').trim()
}

function messageBody(payload: GmailMessagePart | undefined): string {
  const plain = findPart(payload, 'text/plain')
  if (plain?.body?.data) return decodeBase64Url(plain.body.data)
  const html = findPart(payload, 'text/html')
  if (html?.body?.data) return htmlToText(decodeBase64Url(html.body.data))
  return ''
}

function isNoise(labels: string[], headers: GmailHeader[] | undefined, from: string | undefined): boolean {
  if (labels.some((l) => NOISE_LABELS.has(l))) return true
  if (header(headers, 'List-Unsubscribe') !== undefined) return true
  if (header(headers, 'Precedence')?.trim().toLowerCase() === 'bulk') return true
  const local = from?.split('@')[0] ?? ''
  return local.startsWith('no-reply') || local.startsWith('noreply')
}

/** One record per message, unrouted (`scopeId` and `sourceId` null). */
export function normalizeGmailThread(thread: GmailThread, accountId: string, ownAddress: string): SourceRecord[] {
  const own = ownAddress.trim().toLowerCase()
  return thread.messages.map((m) => {
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
      text: extractNewText(messageBody(m.payload)),
      sentByMe: labels.includes('SENT') || (!!own && from === own),
      noise: isNoise(labels, headers, from),
      link: { label: `Gmail thread "${title}"`, url: `https://mail.google.com/mail/#all/${threadId}` },
    }
    if (authorName) record.authorName = authorName
    if (rfcMessageId) record.rfcMessageId = rfcMessageId
    return record
  })
}
