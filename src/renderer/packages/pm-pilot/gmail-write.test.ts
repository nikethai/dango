import { type ClientDraft, DRAFT_LABEL } from '@shared/pm-pilot'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { GmailAuthError, GmailRateLimitError, GmailRequestError, gmailRequest } from './gmail-http'
import { ensureLabel, GmailRecipientError, undoDraft, writeDraft } from './gmail-write'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

type Seen = { method: string; path: string; body: unknown; auth: string | null }
let seen: Seen[] = []
let tokenN = 0
/** A fresh token per test, so the per-token label cache never leaks between tests. */
let token = ''

function fromB64url(raw: string): string {
  return Buffer.from(raw.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
}

beforeEach(() => {
  seen = []
  tokenN += 1
  token = `tok-${tokenN}`
  server.events.removeAllListeners()
  server.events.on('request:start', async ({ request }) => {
    const text = request.method === 'GET' || request.method === 'DELETE' ? '' : await request.clone().text()
    seen.push({
      method: request.method,
      path: new URL(request.url).pathname.replace('/gmail/v1/users/me/', ''),
      body: text ? JSON.parse(text) : undefined,
      auth: request.headers.get('authorization'),
    })
  })
})

const draft: ClientDraft = {
  id: 'draft-1',
  scopeId: 'scope-acme',
  accountId: 'acc-1',
  threadId: 't1',
  inboundMessageId: 'm1',
  to: 'jo@acme.example',
  subject: 'Báo giá',
  inReplyTo: '<m1@acme.example>',
  text: 'Giá là 12.000.000 ₫.',
  answer: '12.000.000 ₫',
  evidence: [],
  state: 'proposed',
  createdAt: 1,
}
const written: ClientDraft = { ...draft, gmailDraftId: 'd1', gmailMessageId: 'm9', state: 'written' }

/** The thread as Gmail holds it: Jo wrote to the PM, cc'ing An. */
function threadHandler() {
  return http.get(`${API}/threads/:id`, ({ params, request }) => {
    const query = new URL(request.url).searchParams
    expect(query.get('format')).toBe('metadata')
    expect(query.getAll('metadataHeaders')).toEqual(['From', 'To', 'Cc'])
    return params.id === 't1'
      ? HttpResponse.json({
          id: 't1',
          messages: [
            {
              id: 'm1',
              threadId: 't1',
              payload: {
                headers: [
                  { name: 'From', value: 'Jo Tran <Jo@Acme.example>' },
                  { name: 'To', value: 'pm@agency.example' },
                  { name: 'Cc', value: 'an@acme.example' },
                ],
              },
            },
          ],
        })
      : new HttpResponse(null, { status: 404 })
  })
}

function labelsHandler(labels: Array<{ id: string; name: string }>) {
  return http.get(`${API}/labels`, () => HttpResponse.json({ labels }))
}

const writeHandlers = () => [
  threadHandler(),
  labelsHandler([
    { id: 'INBOX', name: 'INBOX' },
    { id: 'Label_9', name: DRAFT_LABEL },
  ]),
  http.post(`${API}/drafts`, () => HttpResponse.json({ id: 'd1', message: { id: 'm9', threadId: 't1' } })),
  http.post(`${API}/threads/:id/modify`, () => HttpResponse.json({ id: 't1' })),
]

const undoHandlers = (messageId = 'm9') => [
  http.get(`${API}/drafts/:id`, () => HttpResponse.json({ id: 'd1', message: { id: messageId, threadId: 't1' } })),
  http.delete(`${API}/drafts/:id`, () => new HttpResponse(null, { status: 204 })),
  labelsHandler([{ id: 'Label_9', name: DRAFT_LABEL }]),
  http.post(`${API}/threads/:id/modify`, () => HttpResponse.json({ id: 't1' })),
]

describe('writeDraft', () => {
  it('writes a draft into the thread and labels it', async () => {
    server.use(...writeHandlers())
    await expect(writeDraft(token, draft, 'pm@agency.example')).resolves.toEqual({
      gmailDraftId: 'd1',
      gmailMessageId: 'm9',
    })
    const post = seen.find((s) => s.method === 'POST' && s.path === 'drafts')
    const body = post?.body as { message: { raw: string; threadId: string } }
    expect(body.message.threadId).toBe('t1')
    const mime = fromB64url(body.message.raw)
    expect(mime).toContain('To: jo@acme.example\r\n')
    expect(mime).toContain('In-Reply-To: <m1@acme.example>\r\n')
    expect(mime).toContain('Subject: =?UTF-8?B?')
    const modify = seen.find((s) => s.path === 'threads/t1/modify')
    expect(modify?.body).toEqual({ addLabelIds: ['Label_9'] })
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET threads/t1',
      'POST drafts',
      'GET labels',
      'POST threads/t1/modify',
    ])
    expect(seen.every((s) => s.auth === `Bearer ${token}`)).toBe(true)
  })

  it('creates the label once', async () => {
    const created: unknown[] = []
    server.use(
      threadHandler(),
      labelsHandler([{ id: 'INBOX', name: 'INBOX' }]),
      http.post(`${API}/labels`, async ({ request }) => {
        created.push(await request.json())
        return HttpResponse.json({ id: 'Label_new', name: DRAFT_LABEL })
      }),
      http.post(`${API}/drafts`, () => HttpResponse.json({ id: 'd1', message: { id: 'm9', threadId: 't1' } })),
      http.post(`${API}/threads/:id/modify`, () => HttpResponse.json({ id: 't1' }))
    )
    const [a, b] = await Promise.all([ensureLabel(token, DRAFT_LABEL), ensureLabel(token, DRAFT_LABEL)])
    expect([a, b]).toEqual(['Label_new', 'Label_new'])
    await writeDraft(token, draft, 'pm@agency.example')
    await writeDraft(token, draft, 'pm@agency.example')
    expect(created).toHaveLength(1)
    expect(created[0]).toMatchObject({ name: DRAFT_LABEL })
    expect(seen.filter((s) => s.method === 'GET' && s.path === 'labels')).toHaveLength(1)
    expect(seen.filter((s) => s.path === 'threads/t1/modify').map((s) => s.body)).toEqual([
      { addLabelIds: ['Label_new'] },
      { addLabelIds: ['Label_new'] },
    ])
  })

  it('reuses a label that already exists when its create races', async () => {
    let lists = 0
    server.use(
      http.get(`${API}/labels`, () => {
        lists += 1
        return HttpResponse.json({ labels: lists === 1 ? [] : [{ id: 'Label_7', name: DRAFT_LABEL }] })
      }),
      http.post(`${API}/labels`, () =>
        HttpResponse.json({ error: { code: 409, errors: [{ reason: 'duplicate' }] } }, { status: 409 })
      )
    )
    await expect(ensureLabel(token, DRAFT_LABEL)).resolves.toBe('Label_7')
  })

  it('accepts any participant of the thread as the recipient, case-insensitively', async () => {
    server.use(...writeHandlers())
    await writeDraft(token, { ...draft, to: 'AN@acme.example' }, 'pm@agency.example')
    const body = seen.find((s) => s.path === 'drafts')?.body as { message: { raw: string } }
    expect(fromB64url(body.message.raw)).toContain('To: an@acme.example\r\n')
  })

  it('refuses a recipient who is not in the thread, and writes nothing', async () => {
    server.use(...writeHandlers())
    for (const to of [
      'attacker@evil.example',
      'jo@acme.example, attacker@evil.example',
      'jo@acme.example; attacker@evil.example',
      '',
      'Jo',
      // The mailbox owner alone is not a recipient.
      'pm@agency.example',
    ]) {
      await expect(writeDraft(token, { ...draft, to }, 'pm@agency.example')).rejects.toBeInstanceOf(GmailRecipientError)
    }
    expect(seen.filter((s) => s.method !== 'GET')).toEqual([])
  })

  it('refuses a recipient that is not a plain address, even when Gmail lists it on the thread', async () => {
    server.use(
      http.get(`${API}/threads/:id`, () =>
        HttpResponse.json({
          id: 't1',
          messages: [
            { id: 'm1', threadId: 't1', payload: { headers: [{ name: 'From', value: '<jo\u00e9@acme.example>' }] } },
          ],
        })
      )
    )
    await expect(writeDraft(token, { ...draft, to: 'joé@acme.example' }, 'pm@agency.example')).rejects.toBeInstanceOf(
      GmailRecipientError
    )
    expect(seen.filter((s) => s.method !== 'GET')).toEqual([])
  })

  it("leaves the mailbox owner's own address out of the recipients", async () => {
    server.use(...writeHandlers())
    await writeDraft(token, { ...draft, to: 'PM@agency.example, jo@acme.example' }, 'pm@agency.example')
    const body = seen.find((s) => s.path === 'drafts')?.body as { message: { raw: string } }
    expect(fromB64url(body.message.raw)).toContain('To: jo@acme.example\r\n')
  })

  it('keeps the draft id when Gmail returns no message id', async () => {
    // Overrides go first: within one `server.use` call the first matching handler wins.
    server.use(
      http.post(`${API}/drafts`, () => HttpResponse.json({ id: 'd1' })),
      ...writeHandlers()
    )
    const result = await writeDraft(token, draft, 'pm@agency.example')
    expect(result).toEqual({ gmailDraftId: 'd1' })
    expect(seen.some((s) => s.path === 'threads/t1/modify')).toBe(true)
  })

  it('refuses a thread Gmail no longer has', async () => {
    server.use(...writeHandlers())
    await expect(writeDraft(token, { ...draft, threadId: 'gone' }, 'pm')).rejects.toBeInstanceOf(GmailRequestError)
    expect(seen.filter((s) => s.method !== 'GET')).toEqual([])
  })

  it('keeps the draft when only the label fails', async () => {
    server.use(
      http.post(`${API}/threads/:id/modify`, () => new HttpResponse(null, { status: 500 })),
      ...writeHandlers()
    )
    await expect(writeDraft(token, draft, 'pm@agency.example')).resolves.toEqual({
      gmailDraftId: 'd1',
      gmailMessageId: 'm9',
    })
    expect(seen.some((s) => s.method === 'DELETE')).toBe(false)
    expect(seen.some((s) => s.path === 'threads/t1/modify')).toBe(true)
  })

  it('maps Gmail errors like the sync does, without the URL or a cause', async () => {
    const cases: Array<[number, Record<string, unknown>, new (...args: never[]) => Error]> = [
      [401, {}, GmailAuthError],
      [403, { error: { errors: [{ reason: 'insufficientPermissions' }] } }, GmailAuthError],
      [403, { error: { errors: [{ reason: 'userRateLimitExceeded' }] } }, GmailRateLimitError],
      [429, {}, GmailRateLimitError],
      [500, {}, GmailRequestError],
    ]
    for (const [status, body, type] of cases) {
      server.use(
        threadHandler(),
        http.post(`${API}/drafts`, () => HttpResponse.json(body, { status }))
      )
      const error = await writeDraft(token, draft, 'pm@agency.example').catch((e: unknown) => e)
      expect(error).toBeInstanceOf(type)
      expect((error as Error).message).not.toContain('googleapis')
      expect((error as Error).message).not.toContain('acme')
      expect((error as Error).cause).toBeUndefined()
    }
  })
})

describe('undoDraft', () => {
  it('undo deletes an untouched draft and removes the label', async () => {
    server.use(...undoHandlers())
    await expect(undoDraft(token, written)).resolves.toBe('removed')
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([
      'GET drafts/d1',
      'DELETE drafts/d1',
      'GET labels',
      'POST threads/t1/modify',
    ])
    expect(seen.find((s) => s.path === 'threads/t1/modify')?.body).toEqual({ removeLabelIds: ['Label_9'] })
  })

  it('undo keeps the thread label when asked (another Dango draft is still in the thread)', async () => {
    server.use(...undoHandlers())
    await expect(undoDraft(token, written, { keepLabel: true })).resolves.toBe('removed')
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET drafts/d1', 'DELETE drafts/d1'])
  })

  it('undo keeps a draft the user edited', async () => {
    server.use(...undoHandlers('m10'))
    await expect(undoDraft(token, written)).resolves.toBe('kept-edited')
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET drafts/d1'])
  })

  it('undo keeps a draft whose written message id was never recorded', async () => {
    server.use(...undoHandlers())
    await expect(undoDraft(token, { ...written, gmailMessageId: undefined })).resolves.toBe('kept-edited')
    expect(seen.some((s) => s.method === 'DELETE')).toBe(false)
  })

  it('undo reports a draft that is already gone', async () => {
    server.use(http.get(`${API}/drafts/:id`, () => new HttpResponse(null, { status: 404 })))
    await expect(undoDraft(token, written)).resolves.toBe('already-gone')
    await expect(undoDraft(token, { ...written, gmailDraftId: undefined })).resolves.toBe('already-gone')
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET drafts/d1'])
  })

  it('undo throws on other failures and deletes nothing', async () => {
    server.use(http.get(`${API}/drafts/:id`, () => new HttpResponse(null, { status: 401 })))
    await expect(undoDraft(token, written)).rejects.toBeInstanceOf(GmailAuthError)
    expect(seen.some((s) => s.method === 'DELETE')).toBe(false)
  })
})

describe('never send', () => {
  it('never calls a send endpoint', async () => {
    const hits: string[] = []
    const fail = ({ request }: { request: Request }) => {
      hits.push(new URL(request.url).pathname)
      return new HttpResponse(null, { status: 500 })
    }
    server.use(
      http.all(`${API}/messages/send`, fail),
      http.all(`${API}/drafts/send`, fail),
      http.all(`${API}/messages/import`, fail),
      http.all('*/send', fail),
      http.all('*/messages/import', fail),
      ...writeHandlers(),
      ...undoHandlers()
    )
    await writeDraft(token, draft, 'pm@agency.example')
    await undoDraft(token, written)
    await undoDraft(token, { ...written, gmailMessageId: 'other' })
    expect(hits).toEqual([])
    expect(seen.some((s) => /send|import/i.test(s.path))).toBe(false)

    // The request helper itself refuses send and import paths, and any path Dango does not use, before any request.
    const seenBefore = seen.length
    const bypasses = [
      'messages/send',
      'drafts/send',
      'messages/import',
      'drafts/send?x=1',
      'messages/import/',
      'drafts/send#x',
      'drafts/send\t',
      'drafts/send ',
      'drafts/sen%64',
      'drafts/%73end',
      'messages/send.',
      'drafts/send;x',
      'DRAFTS/SEND',
      'drafts/x/../send',
      '../me/drafts/send',
      'drafts/./send',
      'messages/x/send',
      'threads/t1/modify/../../../drafts/send',
      'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send',
      '//evil.example/drafts/send',
      'settings/sendAs',
      'messages/m1/modify',
      'threads/t1/trash',
      '',
    ]
    for (const path of bypasses) {
      for (const method of ['GET', 'POST', 'DELETE'] as const) {
        await expect(gmailRequest(token, method, path, { body: {} }), path).rejects.toThrow()
      }
    }
    expect(hits).toEqual([])
    expect(seen).toHaveLength(seenBefore)

    // Each path only with the method Dango uses on it (final review M1): messages.insert (POST messages) plants mail.
    const wrongMethods = [
      ['POST', 'messages'],
      ['DELETE', 'messages'],
      ['POST', 'profile'],
      ['POST', 'history'],
      ['DELETE', 'labels'],
      ['GET', 'drafts'],
      ['DELETE', 'drafts'],
      ['POST', 'drafts/d1'],
      ['POST', 'threads/t1'],
      ['DELETE', 'threads/t1'],
      ['GET', 'threads/t1/modify'],
      ['DELETE', 'threads/t1/modify'],
    ] as const
    for (const [method, path] of wrongMethods) {
      await expect(gmailRequest(token, method, path, { body: {} }), `${method} ${path}`).rejects.toThrow(
        'Dango does not make this Gmail request'
      )
    }
    const sneaky = 'PUT' as unknown as 'GET'
    await expect(gmailRequest(token, sneaky, 'drafts/d1', { body: {} })).rejects.toThrow()
    expect(hits).toEqual([])
    expect(seen).toHaveLength(seenBefore)

    for (const mod of [await import('./gmail-write'), await import('./gmail-http'), await import('./gmail-sync')]) {
      expect(Object.keys(mod).filter((name) => /send/i.test(name))).toEqual([])
    }
  })
})
