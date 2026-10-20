import { describe, expect, it } from 'vitest'
import { buildReplyMime, isPlainAddress } from './mime'

function fromB64url(raw: string): string {
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

/** Headers (unfolded) and the decoded body of a raw message from `buildReplyMime`. */
function parse(raw: string): { head: string; headers: Record<string, string[]>; body: string } {
  const text = fromB64url(raw)
  const split = text.indexOf('\r\n\r\n')
  const head = text.slice(0, split)
  const headers: Record<string, string[]> = {}
  for (const line of head.replace(/\r\n[ \t]/g, ' ').split('\r\n')) {
    const i = line.indexOf(':')
    const name = line.slice(0, i).toLowerCase()
    headers[name] = [...(headers[name] ?? []), line.slice(i + 1).trim()]
  }
  const body = Buffer.from(text.slice(split + 4).replace(/\r\n/g, ''), 'base64').toString('utf8')
  return { head, headers, body }
}

/** RFC 2047 decode (B encoding, UTF-8); whitespace between adjacent encoded words is dropped. */
function decodeWords(value: string): string {
  return value
    .replace(/(\?=)\s+(=\?)/g, '$1$2')
    .replace(/=\?UTF-8\?B\?([^?]*)\?=/gi, (_, b64: string) => Buffer.from(b64, 'base64').toString('utf8'))
}

const base = { from: 'pm@agency.example', to: 'jo@acme.example', subject: 'Báo giá', body: 'Xin chào' }

describe('buildReplyMime', () => {
  it('encodes a Vietnamese subject', () => {
    const raw = buildReplyMime(base)
    expect(raw).not.toMatch(/[+/=]/)
    const { head, headers } = parse(raw)
    expect(head).toContain('Subject: =?UTF-8?B?')
    expect(decodeWords(headers.subject[0])).toBe('Re: Báo giá')
    expect(head).toContain('Content-Type: text/plain; charset="UTF-8"')
    expect(head).toContain('Content-Transfer-Encoding: base64')
    expect(head).toContain('MIME-Version: 1.0')
    expect(headers.from).toEqual(['pm@agency.example'])
    expect(headers.to).toEqual(['jo@acme.example'])
  })

  it('folds a long non-ASCII subject into encoded words that decode intact', () => {
    const subject = 'Báo giá cho dự án xây dựng nhà máy điện mặt trời ở Đồng Nai, giai đoạn hai'
    const raw = buildReplyMime({ ...base, subject })
    const text = fromB64url(raw)
    for (const line of text.split('\r\n\r\n')[0].split('\r\n')) expect(line.length).toBeLessThanOrEqual(78)
    expect(decodeWords(parse(raw).headers.subject[0])).toBe(`Re: ${subject}`)
  })

  it('leaves an ASCII subject plain', () => {
    expect(parse(buildReplyMime({ ...base, subject: 'Quote for May' })).headers.subject).toEqual(['Re: Quote for May'])
  })

  it('folds a very long ASCII subject so no header line passes 998', () => {
    const subject = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ')
    const raw = buildReplyMime({ ...base, subject })
    const head = fromB64url(raw).split('\r\n\r\n')[0]
    for (const line of head.split('\r\n')) expect(line.length).toBeLessThanOrEqual(998)
    expect(decodeWords(parse(raw).headers.subject[0])).toBe(`Re: ${subject}`)
  })

  it('isPlainAddress accepts only plain ASCII addresses', () => {
    expect(isPlainAddress('jo@acme.example')).toBe(true)
    expect(isPlainAddress("o'neil+x@acme.example")).toBe(true)
    for (const bad of ['joé@acme.example', 'jo@acme.example\r\n', 'jo acme@x', 'jo', '', '<jo@acme.example>']) {
      expect(isPlainAddress(bad)).toBe(false)
    }
  })

  it('does not double the Re: prefix', () => {
    expect(parse(buildReplyMime({ ...base, subject: 'Re: Quote' })).headers.subject).toEqual(['Re: Quote'])
    expect(parse(buildReplyMime({ ...base, subject: 'RE: Quote' })).headers.subject).toEqual(['RE: Quote'])
    expect(parse(buildReplyMime({ ...base, subject: 're:Quote' })).headers.subject).toEqual(['re:Quote'])
    expect(decodeWords(parse(buildReplyMime({ ...base, subject: 'Re: Báo giá' })).headers.subject[0])).toBe(
      'Re: Báo giá'
    )
  })

  it('sets In-Reply-To and References', () => {
    const { headers } = parse(buildReplyMime({ ...base, inReplyTo: '<m1@acme.example>' }))
    expect(headers['in-reply-to']).toEqual(['<m1@acme.example>'])
    expect(headers.references).toEqual(['<m1@acme.example>'])
    const none = parse(buildReplyMime(base)).headers
    expect(none['in-reply-to']).toBeUndefined()
    expect(none.references).toBeUndefined()
  })

  it('body round-trips UTF-8', () => {
    const body = 'Chào anh Jo,\n\nGiá là 12.000.000 ₫, giao ngày 12 Sep.\nCảm ơn 🙏'
    expect(parse(buildReplyMime({ ...base, body })).body).toBe(body.replace(/\n/g, '\r\n'))
  })

  it('strips CR/LF so a hostile subject, To, Cc or In-Reply-To cannot add headers', () => {
    const raw = buildReplyMime({
      from: 'pm@agency.example\r\nBcc: spy@evil.example',
      to: 'jo@acme.example\r\nBcc: spy@evil.example',
      cc: 'an@acme.example\nX-Injected: 1',
      subject: 'Quote\r\nBcc: spy@evil.example\r\n\r\nInjected body',
      inReplyTo: '<m1@acme.example>\r\nBcc: spy@evil.example',
      body: 'Hello',
    })
    const { head, headers, body } = parse(raw)
    expect(headers.bcc).toBeUndefined()
    expect(headers['x-injected']).toBeUndefined()
    expect(head.split('\r\n').every((line) => /^[A-Za-z-]+: |^[ \t]/.test(line))).toBe(true)
    expect(Object.keys(headers).sort()).toEqual(
      [
        'cc',
        'content-transfer-encoding',
        'content-type',
        'from',
        'in-reply-to',
        'mime-version',
        'references',
        'subject',
        'to',
      ].sort()
    )
    expect(headers.to).toEqual(['jo@acme.example'])
    expect(headers.cc).toEqual(['an@acme.example'])
    expect(headers['in-reply-to']).toEqual(['<m1@acme.example>'])
    expect(headers.subject[0]).not.toMatch(/[\r\n]/)
    expect(body).toBe('Hello')
  })

  it('keeps only addresses in To and refuses a To with none', () => {
    const { headers } = parse(buildReplyMime({ ...base, to: '"Jo, Tran" <Jo@Acme.example>, an@acme.example' }))
    expect(headers.to).toEqual(['jo@acme.example, an@acme.example'])
    expect(() => buildReplyMime({ ...base, to: 'not an address' })).toThrow()
  })

  it('omits From when the own address is unknown', () => {
    expect(parse(buildReplyMime({ ...base, from: '' })).headers.from).toBeUndefined()
  })
})
