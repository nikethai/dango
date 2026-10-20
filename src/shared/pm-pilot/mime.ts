import { parseAddresses } from './gmail-normalize'

// Slice 10: the RFC 2822 reply Dango writes into a Gmail thread as a draft. Building a message here sends nothing.

export type ReplyMimeInput = {
  /** The mailbox's own address; `''` leaves From out and Gmail fills it in. */
  from: string
  to: string
  cc?: string
  subject: string
  /** The `Message-ID` of the message replied to. */
  inReplyTo?: string
  body: string
}

/** Every header value comes from mail data, so none may carry a line break (header injection) or other control. */
function oneLine(value: string): string {
  let out = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    out += code < 0x20 || code === 0x7f ? ' ' : ch
  }
  return out.replace(/\s+/g, ' ').trim()
}

const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+$/
/** A message id is printable ASCII between angle brackets. */
const MESSAGE_ID = /^<[!-;=?-~]+>$/

/** A bare ASCII address with nothing a header could misread; the only kind of recipient Dango writes. */
export function isPlainAddress(value: string): boolean {
  return ADDRESS.test(value)
}

/** Bare addresses only: display names from mail are dropped, so nothing but an address reaches the header. */
function addressList(value: string | undefined): string {
  return parseAddresses(oneLine(value ?? ''))
    .filter(isPlainAddress)
    .join(', ')
}

function messageId(value: string | undefined): string | undefined {
  const line = oneLine(value ?? '')
  const id = /<[^<>\s]+>/.exec(line)?.[0] ?? (/^[^<>\s]+@[^<>\s]+$/.test(line) ? `<${line}>` : undefined)
  return id && MESSAGE_ID.test(id) ? id : undefined
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}

function utf8Base64(text: string): string {
  return bytesToBase64(new TextEncoder().encode(text))
}

/** UTF-8 bytes per encoded word: 39 bytes is 52 base64 characters, so `Subject: ` plus one word stays under 78. */
const WORD_BYTES = 39

/** RFC 2047 `=?UTF-8?B?…?=` words, split on character boundaries and folded one per line. */
function encodeWords(text: string): string {
  const encoder = new TextEncoder()
  const words: string[] = []
  let chunk = ''
  let size = 0
  for (const ch of text) {
    const n = encoder.encode(ch).length
    if (size + n > WORD_BYTES && chunk) {
      words.push(chunk)
      chunk = ''
      size = 0
    }
    chunk += ch
    size += n
  }
  if (chunk) words.push(chunk)
  return words.map((w) => `=?UTF-8?B?${utf8Base64(w)}?=`).join('\r\n ')
}

/** Longer plain subjects are encoded and folded too, so no header line nears the 998-character limit. */
const MAX_PLAIN_SUBJECT = 900

function replySubject(subject: string): string {
  const clean = oneLine(subject)
  const prefixed = /^re:/i.test(clean) ? clean : `Re: ${clean}`
  return /^[\x20-\x7e]*$/.test(prefixed) && prefixed.length <= MAX_PLAIN_SUBJECT ? prefixed : encodeWords(prefixed)
}

function wrap(text: string, width: number): string {
  const lines: string[] = []
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width))
  return lines.join('\r\n')
}

function toBase64Url(base64: string): string {
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/**
 * The reply as a base64url RFC 2822 message, ready for Gmail's `drafts.create` `raw`: plain UTF-8 text in base64,
 * subject prefixed `Re: ` unless it already has it (case-insensitive) and RFC 2047 encoded when not ASCII,
 * `In-Reply-To` and `References` when `inReplyTo` is a message id. Header values lose line breaks and display
 * names, so mail data cannot add headers. Throws when `to` holds no address.
 */
export function buildReplyMime(input: ReplyMimeInput): string {
  const to = addressList(input.to)
  if (!to) throw new Error('The reply has no recipient address')
  const from = addressList(input.from).split(', ')[0]
  const cc = addressList(input.cc)
  const inReplyTo = messageId(input.inReplyTo)

  const headers: string[] = []
  if (from) headers.push(`From: ${from}`)
  headers.push(`To: ${to}`)
  if (cc) headers.push(`Cc: ${cc}`)
  headers.push(`Subject: ${replySubject(input.subject)}`)
  if (inReplyTo) headers.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`)
  headers.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64')

  const body = wrap(utf8Base64(input.body.replace(/\r\n|\r|\n/g, '\r\n')), 76)
  return toBase64Url(utf8Base64(`${headers.join('\r\n')}\r\n\r\n${body}\r\n`))
}
