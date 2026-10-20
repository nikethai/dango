import { GMAIL_BACKFILL_DAYS, type GmailMessage, type GmailThread, type SyncCursor } from '@shared/pm-pilot'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { buildMatcherQuery, GmailAuthError, syncGmailMailbox } from './gmail-sync'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function b64url(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function message(id: string, threadId: string, body = `Body of ${id}`, labelIds = ['INBOX']): GmailMessage {
  return {
    id,
    threadId,
    labelIds,
    internalDate: String(NOW - 60_000),
    payload: {
      mimeType: 'text/plain',
      headers: [
        { name: 'From', value: 'Jo Tran <jo@acme.example>' },
        { name: 'To', value: 'pm@agency.example' },
        { name: 'Subject', value: `Subject ${threadId}` },
        { name: 'Message-ID', value: `<${id}@acme.example>` },
      ],
      body: { data: b64url(body) },
    },
  }
}

function thread(id: string, messages: GmailMessage[] = [message(`${id}-m1`, id)]): GmailThread {
  return { id, historyId: '100', messages }
}

/** Serves `threads/{id}` from the map and counts each fetch. */
function threadHandler(threads: Record<string, GmailThread>, fetched: string[] = []) {
  return http.get(`${API}/threads/:id`, ({ params, request }) => {
    const id = String(params.id)
    fetched.push(id)
    expect(new URL(request.url).searchParams.get('format')).toBe('full')
    const t = threads[id]
    return t ? HttpResponse.json(t) : new HttpResponse(null, { status: 404 })
  })
}

function profileHandler(calls: { n: number } = { n: 0 }, historyId = '500') {
  return http.get(`${API}/profile`, () => {
    calls.n += 1
    return HttpResponse.json({ emailAddress: 'PM@Agency.example', historyId, messagesTotal: 10 })
  })
}

const cursor: SyncCursor = {
  accountId: 'acc-1',
  sourceKind: 'gmail',
  scope: 'mailbox',
  value: '400',
  updatedAt: NOW - 60_000,
  ownAddress: 'pm@agency.example',
}

describe('buildMatcherQuery', () => {
  it("buildMatcherQuery returns '' for none and the OR form for two", () => {
    expect(buildMatcherQuery([])).toBe('')
    expect(buildMatcherQuery(['@a.com', 'x@b.com'])).toBe('from:(@a.com OR x@b.com) OR to:(@a.com OR x@b.com)')
  })

  it('drops blanks and characters that would break the query', () => {
    expect(buildMatcherQuery(['  ', ' @A.com ', 'x"@b.com)'])).toBe(
      'from:(@a.com OR x@b.com) OR to:(@a.com OR x@b.com)'
    )
  })
})

describe('syncGmailMailbox', () => {
  it('backfills when there is no cursor', async () => {
    const queries: string[] = []
    const fetched: string[] = []
    server.use(
      profileHandler(),
      http.get(`${API}/messages`, ({ request }) => {
        const params = new URL(request.url).searchParams
        queries.push(params.get('q') ?? '')
        if (params.get('pageToken') === 'p2') {
          return HttpResponse.json({ messages: [{ id: 't2-m1', threadId: 't2' }] })
        }
        return HttpResponse.json({
          messages: [
            { id: 't1-m1', threadId: 't1' },
            { id: 't1-m2', threadId: 't1' },
          ],
          nextPageToken: 'p2',
        })
      }),
      threadHandler({ t1: thread('t1', [message('t1-m1', 't1'), message('t1-m2', 't1')]), t2: thread('t2') }, fetched)
    )

    const result = await syncGmailMailbox({
      accountId: 'acc-1',
      accessToken: 'tok',
      cursor: null,
      backfillQuery: buildMatcherQuery(['@acme.example']),
      now: NOW,
    })

    const after = Math.floor((NOW - GMAIL_BACKFILL_DAYS * 86_400_000) / 1000)
    expect(queries).toHaveLength(2)
    expect(queries[0]).toContain(`after:${after}`)
    expect(queries[0]).toContain('(from:(@acme.example) OR to:(@acme.example))')
    expect(fetched.sort()).toEqual(['t1', 't2'])
    expect(result.records.map((r) => r.externalId).sort()).toEqual(['t1-m1', 't1-m2', 't2-m1'])
    expect(result.records.every((r) => r.accountId === 'acc-1' && r.scopeId === null)).toBe(true)
    expect(result.backfilled).toBe(true)
    expect(result.cursor).toMatchObject({ accountId: 'acc-1', sourceKind: 'gmail', value: '500', updatedAt: NOW })
    // Preflight R12: the own address comes from Gmail's profile and is cached on the cursor.
    expect(result.ownAddress).toBe('pm@agency.example')
    expect(result.cursor.ownAddress).toBe('pm@agency.example')
  })

  it('syncs incrementally from history', async () => {
    const profile = { n: 0 }
    const fetched: string[] = []
    server.use(
      profileHandler(profile),
      http.get(`${API}/history`, ({ request }) => {
        const params = new URL(request.url).searchParams
        expect(params.get('startHistoryId')).toBe('400')
        expect(params.get('historyTypes')).toBe('messageAdded')
        return HttpResponse.json({
          history: [{ id: '420', messagesAdded: [{ message: { id: 't9-m1', threadId: 't9' } }] }],
          historyId: '450',
        })
      }),
      threadHandler({ t9: thread('t9'), t8: thread('t8') }, fetched)
    )

    const result = await syncGmailMailbox({
      accountId: 'acc-1',
      accessToken: 'tok',
      cursor,
      backfillQuery: 'x',
      now: NOW,
    })

    expect(fetched).toEqual(['t9'])
    expect(result.records.map((r) => r.externalId)).toEqual(['t9-m1'])
    expect(result.backfilled).toBe(false)
    expect(result.cursor.value).toBe('450')
    expect(result.ownAddress).toBe('pm@agency.example')
    expect(profile.n).toBe(0)
  })

  it('pages through history and reads the own address when the cursor has none', async () => {
    const profile = { n: 0 }
    server.use(
      profileHandler(profile),
      http.get(`${API}/history`, ({ request }) => {
        const token = new URL(request.url).searchParams.get('pageToken')
        if (token === 'h2') {
          return HttpResponse.json({
            history: [{ id: '430', messagesAdded: [{ message: { id: 't2-m1', threadId: 't2' } }] }],
            historyId: '460',
          })
        }
        return HttpResponse.json({
          history: [{ id: '420', messagesAdded: [{ message: { id: 't1-m1', threadId: 't1' } }] }],
          historyId: '460',
          nextPageToken: 'h2',
        })
      }),
      threadHandler({ t1: thread('t1'), t2: thread('t2') })
    )
    const { ownAddress: _drop, ...bare } = cursor

    const result = await syncGmailMailbox({ accountId: 'acc-1', accessToken: 'tok', cursor: bare, backfillQuery: '' })

    expect(result.records.map((r) => r.externalId).sort()).toEqual(['t1-m1', 't2-m1'])
    expect(result.cursor.value).toBe('460')
    expect(result.ownAddress).toBe('pm@agency.example')
    expect(profile.n).toBe(1)
  })

  it('falls back to backfill when the history id has expired', async () => {
    let listed = 0
    server.use(
      profileHandler(undefined, '900'),
      http.get(`${API}/history`, () => new HttpResponse(null, { status: 404 })),
      http.get(`${API}/messages`, () => {
        listed += 1
        return HttpResponse.json({ messages: [{ id: 't3-m1', threadId: 't3' }] })
      }),
      threadHandler({ t3: thread('t3') })
    )

    const result = await syncGmailMailbox({
      accountId: 'acc-1',
      accessToken: 'tok',
      cursor,
      backfillQuery: buildMatcherQuery(['@acme.example']),
      now: NOW,
    })

    expect(listed).toBe(1)
    expect(result.backfilled).toBe(true)
    expect(result.cursor.value).toBe('900')
    expect(result.records.map((r) => r.externalId)).toEqual(['t3-m1'])
  })

  it('does not backfill when no source has matchers', async () => {
    let listed = 0
    server.use(
      profileHandler(undefined, '777'),
      http.get(`${API}/messages`, () => {
        listed += 1
        return HttpResponse.json({ messages: [] })
      })
    )

    const result = await syncGmailMailbox({ accountId: 'acc-1', accessToken: 'tok', cursor: null, backfillQuery: '' })

    expect(listed).toBe(0)
    expect(result.records).toEqual([])
    expect(result.cursor.value).toBe('777')
    expect(result.backfilled).toBe(true)
  })

  it('throws GmailAuthError on 401', async () => {
    server.use(http.get(`${API}/profile`, () => new HttpResponse(null, { status: 401 })))

    await expect(
      syncGmailMailbox({ accountId: 'acc-1', accessToken: 'bad', cursor: null, backfillQuery: '' })
    ).rejects.toBeInstanceOf(GmailAuthError)
  })

  it('throws GmailAuthError on 403 from history', async () => {
    server.use(http.get(`${API}/history`, () => new HttpResponse(null, { status: 403 })))

    await expect(
      syncGmailMailbox({ accountId: 'acc-1', accessToken: 'bad', cursor, backfillQuery: '' })
    ).rejects.toBeInstanceOf(GmailAuthError)
  })

  it('sends the bearer token', async () => {
    const auth: string[] = []
    server.use(
      http.get(`${API}/profile`, ({ request }) => {
        auth.push(request.headers.get('authorization') ?? '')
        return HttpResponse.json({ emailAddress: 'pm@agency.example', historyId: '1' })
      })
    )

    await syncGmailMailbox({ accountId: 'acc-1', accessToken: 'tok-123', cursor: null, backfillQuery: '' })

    expect(auth).toEqual(['Bearer tok-123'])
  })

  // T2 carry: one message that cannot be normalised costs only that message, never the thread or the sync.
  it("keeps a thread's other messages when one fails to normalise", async () => {
    const broken = { ...message('t5-bad', 't5'), payload: { headers: 42 } } as unknown as GmailMessage
    server.use(
      http.get(`${API}/history`, () =>
        HttpResponse.json({
          history: [{ id: '420', messagesAdded: [{ message: { id: 't5-bad', threadId: 't5' } }] }],
          historyId: '450',
        })
      ),
      threadHandler({ t5: thread('t5', [message('t5-m1', 't5'), broken, message('t5-m3', 't5')]) })
    )

    const result = await syncGmailMailbox({ accountId: 'acc-1', accessToken: 'tok', cursor, backfillQuery: '' })

    expect(result.records.map((r) => r.externalId)).toEqual(['t5-m1', 't5-m3'])
    expect(result.cursor.value).toBe('450')
  })

  it('leaves out drafts, spam and trash', async () => {
    server.use(
      http.get(`${API}/history`, () =>
        HttpResponse.json({
          history: [{ id: '420', messagesAdded: [{ message: { id: 't6-d', threadId: 't6' } }] }],
          historyId: '450',
        })
      ),
      threadHandler({
        t6: thread('t6', [
          message('t6-m1', 't6'),
          message('t6-d', 't6', 'Dango draft', ['DRAFT']),
          message('t6-s', 't6', 'Spam', ['SPAM']),
          message('t6-t', 't6', 'Trash', ['TRASH']),
        ]),
      })
    )

    const result = await syncGmailMailbox({ accountId: 'acc-1', accessToken: 'tok', cursor, backfillQuery: '' })

    expect(result.records.map((r) => r.externalId)).toEqual(['t6-m1'])
  })

  it('skips a thread that is gone and fetches at most five threads at a time', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `t${i}`)
    let inFlight = 0
    let peak = 0
    server.use(
      http.get(`${API}/history`, () =>
        HttpResponse.json({
          history: ids.map((id, i) => ({
            id: String(500 + i),
            messagesAdded: [{ message: { id: `${id}-m1`, threadId: id } }],
          })),
          historyId: '600',
        })
      ),
      http.get(`${API}/threads/:id`, async ({ params }) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight -= 1
        const id = String(params.id)
        return id === 't3' ? new HttpResponse(null, { status: 404 }) : HttpResponse.json(thread(id))
      })
    )

    const result = await syncGmailMailbox({ accountId: 'acc-1', accessToken: 'tok', cursor, backfillQuery: '' })

    expect(peak).toBeLessThanOrEqual(5)
    expect(peak).toBeGreaterThan(1)
    expect(result.records).toHaveLength(11)
    expect(result.records.some((r) => r.threadOrTaskId === 't3')).toBe(false)
  })

  it('fails the sync, leaving the cursor to the caller, when a thread cannot be read', async () => {
    server.use(
      http.get(`${API}/history`, () =>
        HttpResponse.json({
          history: [{ id: '420', messagesAdded: [{ message: { id: 't7-m1', threadId: 't7' } }] }],
          historyId: '450',
        })
      ),
      http.get(`${API}/threads/:id`, () => new HttpResponse(null, { status: 500 }))
    )

    await expect(
      syncGmailMailbox({ accountId: 'acc-1', accessToken: 'tok', cursor, backfillQuery: '' })
    ).rejects.toThrow()
  })

  it('never calls a send endpoint', async () => {
    const sends: string[] = []
    server.use(
      profileHandler(),
      http.all(`${API}/messages/send`, ({ request }) => {
        sends.push(request.url)
        return new HttpResponse(null, { status: 500 })
      }),
      http.all(`${API}/drafts/send`, ({ request }) => {
        sends.push(request.url)
        return new HttpResponse(null, { status: 500 })
      }),
      http.all(`${API}/messages/import`, ({ request }) => {
        sends.push(request.url)
        return new HttpResponse(null, { status: 500 })
      }),
      http.get(`${API}/messages`, () => HttpResponse.json({ messages: [{ id: 't1-m1', threadId: 't1' }] })),
      threadHandler({ t1: thread('t1') })
    )

    await syncGmailMailbox({ accountId: 'acc-1', accessToken: 'tok', cursor: null, backfillQuery: 'from:(@a.com)' })

    expect(sends).toEqual([])
    expect(Object.keys(await import('./gmail-sync')).filter((name) => /send/i.test(name))).toEqual([])
  })
})
