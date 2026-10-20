import htmlOnlyJson from '../../../test/fixtures/pm-pilot/gmail/html-only.json'
import newsletterJson from '../../../test/fixtures/pm-pilot/gmail/newsletter.json'
import plainJson from '../../../test/fixtures/pm-pilot/gmail/plain.json'
import quotedReplyJson from '../../../test/fixtures/pm-pilot/gmail/quoted-reply.json'
import sentReplyJson from '../../../test/fixtures/pm-pilot/gmail/sent-reply.json'
import vietnameseJson from '../../../test/fixtures/pm-pilot/gmail/vietnamese.json'
import { extractNewText, type GmailThread, normalizeGmailThread } from './gmail-normalize'
import { ClientQuestionSchema, recordId, SourceRecordSchema } from './types'

const plain = plainJson as GmailThread
const htmlOnly = htmlOnlyJson as GmailThread
const quotedReply = quotedReplyJson as GmailThread
const vietnamese = vietnameseJson as GmailThread
const newsletter = newsletterJson as GmailThread
const sentReply = sentReplyJson as GmailThread

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64url')
function oneMessage(headers: Record<string, string>, labelIds: string[] = ['INBOX'], body = 'Hello'): GmailThread {
  return {
    id: 't1',
    messages: [
      {
        id: 'm1',
        threadId: 't1',
        labelIds,
        internalDate: '1788566400000',
        payload: {
          mimeType: 'text/plain',
          headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
          body: { data: b64(body) },
        },
      },
    ],
  }
}

describe('normalizeGmailThread', () => {
  it('keeps Vietnamese diacritics', () =>
    expect(normalizeGmailThread(vietnamese, 'a1', 'pm@agency.vn')[0].text).toContain('Chúng tôi đã cập nhật thiết kế'))

  it('extracts text from HTML-only bodies', () => {
    const [r] = normalizeGmailThread(htmlOnly, 'a1', 'pm@agency.vn')
    expect(r.text).toContain('Can you confirm the launch date?')
    expect(r.text).not.toContain('<')
  })

  it('drops quoted earlier messages in English and Vietnamese', () => {
    const rs = normalizeGmailThread(quotedReply, 'a1', 'pm@agency.vn')
    expect(rs[1].text).not.toMatch(/^>/m)
    expect(rs[1].text).not.toContain('On Mon, 1 Sep 2026')
    expect(extractNewText('Ok\n\nVào 2 thg 9, 2026 Lan đã viết:\n> cũ')).toBe('Ok')
  })

  it('marks newsletters as noise and sent mail as sentByMe', () => {
    expect(normalizeGmailThread(newsletter, 'a1', 'pm@agency.vn')[0].noise).toBe(true)
    expect(normalizeGmailThread(sentReply, 'a1', 'pm@agency.vn').at(-1)?.sentByMe).toBe(true)
  })

  it('builds ids and links from Gmail ids', () => {
    const [r] = normalizeGmailThread(plain, 'a1', 'pm@agency.vn')
    expect(r.id).toBe(`gmail:${plain.messages[0].id}`)
    expect(r.link.url).toBe(`https://mail.google.com/mail/#all/${plain.id}`)
  })

  it('fills the record fields from headers and labels', () => {
    const [r] = normalizeGmailThread(plain, 'a1', 'pm@agency.vn')
    expect(r).toMatchObject({
      sourceKind: 'gmail',
      sourceId: null,
      scopeId: null,
      accountId: 'a1',
      externalId: plain.messages[0].id,
      threadOrTaskId: plain.id,
      author: 'jo@acme.example',
      authorName: 'Jo Tran',
      title: 'Homepage copy',
      occurredAt: 1788566400000,
      sentByMe: false,
      noise: false,
      rfcMessageId: '<CAplain001@mail.acme.example>',
    })
    expect(r.participants).toEqual(['jo@acme.example', 'pm@agency.vn', 'kim@acme.example'])
    expect(r.text).toContain('The homepage copy is approved.')
    expect(SourceRecordSchema.safeParse(r).success).toBe(true)
  })

  it('reads a quoted display name with a comma and a lower-case Message-Id header', () => {
    const [r] = normalizeGmailThread(htmlOnly, 'a1', 'pm@agency.vn')
    expect(r.author).toBe('jo@acme.example')
    expect(r.authorName).toBe('Tran, Jo')
    expect(r.rfcMessageId).toBe('<CAhtml001@mail.acme.example>')
    expect(r.text).toContain('Thanks & regards')
    expect(r.text).not.toContain('Old text')
    expect(r.text).not.toContain('color:red')
  })

  it('drops a quote header that Gmail wrapped over two lines', () => {
    expect(normalizeGmailThread(quotedReply, 'a1', 'pm@agency.vn')[1].text).toBe('Also, Friday works for the demo.')
    const rs = normalizeGmailThread(sentReply, 'a1', 'pm@agency.vn')
    expect(rs[1].text).toBe('It goes out on 15 Sep.')
    expect(rs[0].sentByMe).toBe(false)
  })

  it('drops the Vietnamese quote from a real message', () => {
    const [r] = normalizeGmailThread(vietnamese, 'a1', 'pm@agency.vn')
    expect(r.text).not.toContain('đã viết')
    expect(r.text).not.toContain('Chị gửi lại')
    expect(r.title).toBe('Re: Báo giá thiết kế')
    expect(r.authorName).toBe('Nguyễn Thị Lan')
  })

  it.each([
    ['a CATEGORY_UPDATES label', oneMessage({ From: 'a@b.example' }, ['INBOX', 'CATEGORY_UPDATES'])],
    ['a CATEGORY_SOCIAL label', oneMessage({ From: 'a@b.example' }, ['CATEGORY_SOCIAL'])],
    ['a CATEGORY_FORUMS label', oneMessage({ From: 'a@b.example' }, ['CATEGORY_FORUMS'])],
    ['Precedence: bulk', oneMessage({ From: 'a@b.example', Precedence: 'Bulk' })],
    ['a noreply sender', oneMessage({ From: 'Billing <noreply@b.example>' })],
    ['a no-reply sender', oneMessage({ From: 'no-reply.alerts@b.example' })],
  ])('marks %s as noise', (_label, thread) => {
    expect(normalizeGmailThread(thread, 'a1', 'pm@agency.vn')[0].noise).toBe(true)
  })

  it('does not mark ordinary client mail as noise', () => {
    expect(normalizeGmailThread(oneMessage({ From: 'Jo <jo@b.example>' }), 'a1', 'pm@agency.vn')[0].noise).toBe(false)
  })

  it('treats mail from the own address as sent by me', () => {
    const [r] = normalizeGmailThread(oneMessage({ From: 'PM <PM@agency.vn>' }), 'a1', 'pm@agency.vn')
    expect(r.sentByMe).toBe(true)
  })

  it('skips attachments and falls back to an empty subject title', () => {
    const thread: GmailThread = {
      id: 't2',
      messages: [
        {
          id: 'm2',
          threadId: 't2',
          internalDate: '1',
          payload: {
            mimeType: 'multipart/mixed',
            headers: [{ name: 'From', value: 'a@b.example' }],
            parts: [
              { mimeType: 'text/plain', filename: 'notes.txt', body: { attachmentId: 'x' } },
              { mimeType: 'text/plain', filename: '', body: { data: b64('Body text') } },
            ],
          },
        },
      ],
    }
    const [r] = normalizeGmailThread(thread, 'a1', 'pm@agency.vn')
    expect(r.text).toBe('Body text')
    expect(r.title).toBe('')
  })
})

describe('extractNewText', () => {
  it('cuts at an English quote header and at a run of > lines', () => {
    expect(extractNewText('New\r\n\r\nOn Tue, 2 Sep 2026, Jo wrote:\r\n> old')).toBe('New')
    expect(extractNewText('New\n> old\n> older')).toBe('New')
  })

  it('keeps a message with no quote', () => expect(extractNewText('  Just this.\n')).toBe('Just this.'))
})

describe('types', () => {
  it('builds record ids from kind and external id', () => expect(recordId('asana', '123')).toBe('asana:123'))

  it('accepts the choose-model question kind', () => {
    const q = {
      id: 'q1',
      kind: 'choose-model',
      scopeId: 's1',
      accountId: 'a1',
      threadId: '',
      subject: '',
      from: '',
      summary: '',
      candidates: [],
      state: 'open',
      createdAt: 1,
    }
    expect(ClientQuestionSchema.safeParse(q).success).toBe(true)
  })
})
