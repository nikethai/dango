import { recordId, SourceRecordSchema, type SyncCursor } from '@shared/pm-pilot'
import { HttpResponse, http } from 'msw'
import { setupServer } from 'msw/node'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  ASANA_EVENT_MAX_PAGES,
  ASANA_MAX_TASKS,
  AsanaAuthError,
  AsanaRateLimitedError,
  AsanaRequestError,
  listAsanaProjects,
  syncAsanaProject,
} from './asana-adapter'

const API = 'https://app.asana.com/api/1.0'
const NOW = Date.UTC(2026, 9, 20, 12, 0, 0)
const TOKEN = 'secret-token-123'
const PROJECT = 'p1'

const server = setupServer()
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => {
  server.resetHandlers()
  vi.useRealTimers()
})
afterAll(() => server.close())

type Task = {
  gid: string
  name: string
  notes: string
  completed: boolean
  permalink_url: string
  created_at: string
  modified_at: string
  created_by?: { gid: string; name?: string } | null
  memberships: Array<{ project: { gid: string }; section?: { gid: string; name: string } | null }>
}

function task(gid: string, extra: Partial<Task> = {}): Task {
  return {
    gid,
    name: `Task ${gid}`,
    notes: `Notes of ${gid}`,
    completed: false,
    permalink_url: `https://app.asana.com/0/${PROJECT}/${gid}`,
    created_at: '2026-10-01T09:00:00.000Z',
    modified_at: '2026-10-19T09:00:00.000Z',
    created_by: { gid: 'u1', name: 'Lan Nguyen' },
    memberships: [{ project: { gid: PROJECT }, section: { gid: 's1', name: 'In progress' } }],
    ...extra,
  }
}

type Story = { gid: string; resource_subtype: string; text: string; created_at: string; created_by?: { name?: string } }

function comment(gid: string, text: string): Story {
  return {
    gid,
    resource_subtype: 'comment_added',
    text,
    created_at: '2026-10-18T10:00:00.000Z',
    created_by: { name: 'Jo Tran' },
  }
}

function authOk(request: Request) {
  expect(request.headers.get('authorization')).toBe(`Bearer ${TOKEN}`)
}

/** Serves the project's tasks, single tasks and their stories from the maps. */
function projectHandlers(
  tasks: Record<string, Task>,
  stories: Record<string, Story[]> = {},
  calls: { list: number; get: string[]; stories: string[] } = { list: 0, get: [], stories: [] }
) {
  return [
    http.get(`${API}/tasks`, ({ request }) => {
      authOk(request)
      expect(new URL(request.url).searchParams.get('project')).toBe(PROJECT)
      calls.list += 1
      return HttpResponse.json({ data: Object.values(tasks), next_page: null })
    }),
    http.get(`${API}/tasks/:gid`, ({ params, request }) => {
      authOk(request)
      const gid = String(params.gid)
      calls.get.push(gid)
      const t = tasks[gid]
      return t
        ? HttpResponse.json({ data: t })
        : HttpResponse.json({ errors: [{ message: 'Not found' }] }, { status: 404 })
    }),
    http.get(`${API}/tasks/:gid/stories`, ({ params }) => {
      const gid = String(params.gid)
      calls.stories.push(gid)
      return HttpResponse.json({ data: stories[gid] ?? [], next_page: null })
    }),
  ]
}

function eventsHandler(respond: (sync: string | null) => Response) {
  return http.get(`${API}/events`, ({ request }) => {
    const url = new URL(request.url)
    expect(url.searchParams.get('resource')).toBe(PROJECT)
    return respond(url.searchParams.get('sync'))
  })
}

const expired412 = (sync: string) =>
  HttpResponse.json({ sync, errors: [{ message: 'Sync token invalid or too old.' }] }, { status: 412 })

const baseInput = { accountId: 'acc-1', sourceId: 'src-1', accessToken: TOKEN, projectGid: PROJECT, scopeId: 'scope-1' }

const cursor: SyncCursor = {
  accountId: 'acc-1',
  sourceKind: 'asana',
  scope: PROJECT,
  value: 'tok-1',
  updatedAt: NOW - 1,
}

describe('syncAsanaProject', () => {
  it('maps tasks and comments to records with permalinks', async () => {
    const t1 = task('t1')
    const t2 = task('t2', { completed: true, name: 'Ship <b>v2</b>', notes: '<script>x</script>' })
    server.use(
      ...projectHandlers(
        { t1, t2 },
        {
          t1: [
            comment('c1', 'Launch moves to 6 Nov.'),
            {
              gid: 'sys1',
              resource_subtype: 'assigned',
              text: 'assigned to Jo',
              created_at: '2026-10-18T09:00:00.000Z',
            },
          ],
        }
      ),
      eventsHandler(() => expired412('tok-new'))
    )
    const { records, deletedExternalIds } = await syncAsanaProject({ ...baseInput, cursor: null, now: NOW })
    expect(deletedExternalIds).toEqual([])
    for (const r of records) expect(SourceRecordSchema.safeParse(r).success).toBe(true)

    const r1 = records.find((r) => r.externalId === 't1')
    expect(r1).toMatchObject({
      id: recordId('asana', 't1'),
      sourceKind: 'asana',
      sourceId: 'src-1',
      accountId: 'acc-1',
      scopeId: 'scope-1',
      threadOrTaskId: 't1',
      title: 'Task t1',
      text: 'Notes of t1',
      status: 'In progress',
      author: 'Lan Nguyen',
      occurredAt: Date.parse('2026-10-19T09:00:00.000Z'),
      sentByMe: false,
      noise: false,
      link: { label: 'Asana "Task t1"', url: 'https://app.asana.com/0/p1/t1' },
    })
    const r2 = records.find((r) => r.externalId === 't2')
    expect(r2?.status).toBe('done')
    expect(r2?.title).toBe('Ship <b>v2</b>')
    expect(r2?.text).toBe('<script>x</script>')

    const comments = records.filter((r) => r.threadOrTaskId === 't1' && r.externalId !== 't1')
    expect(comments).toHaveLength(1)
    expect(comments[0]).toMatchObject({
      id: recordId('asana', 'c1'),
      externalId: 'c1',
      title: 'Comment on Task t1',
      text: 'Launch moves to 6 Nov.',
      author: 'Jo Tran',
      occurredAt: Date.parse('2026-10-18T10:00:00.000Z'),
      link: { label: 'Asana "Task t1"', url: 'https://app.asana.com/0/p1/t1' },
    })
  })

  it('obtains a sync token after the first full read', async () => {
    const calls = { list: 0, get: [] as string[], stories: [] as string[] }
    let eventCalls = 0
    server.use(
      ...projectHandlers({ t1: task('t1') }, {}, calls),
      eventsHandler((sync) => {
        eventCalls += 1
        expect(sync).toBeNull()
        return expired412('tok-first')
      })
    )
    const result = await syncAsanaProject({ ...baseInput, cursor: null, now: NOW })
    expect(calls.list).toBe(1)
    expect(eventCalls).toBe(1)
    expect(result.cursor).toEqual({
      accountId: 'acc-1',
      sourceKind: 'asana',
      scope: PROJECT,
      value: 'tok-first',
      updatedAt: NOW,
    })
  })

  it('applies events incrementally and reports deleted tasks', async () => {
    const calls = { list: 0, get: [] as string[], stories: [] as string[] }
    const seen: Array<string | null> = []
    server.use(
      ...projectHandlers({ t1: task('t1', { name: 'Renamed' }), t3: task('t3') }, { t3: [comment('c9', 'Hi')] }, calls),
      eventsHandler((sync) => {
        seen.push(sync)
        if (sync === 'tok-1') {
          return HttpResponse.json({
            data: [
              { action: 'changed', resource: { gid: 't1', resource_type: 'task' }, parent: null },
              { action: 'deleted', resource: { gid: 't2', resource_type: 'task' }, parent: null },
              {
                action: 'added',
                resource: { gid: 'c9', resource_type: 'story', resource_subtype: 'comment_added' },
                parent: { gid: 't3', resource_type: 'task' },
              },
            ],
            sync: 'tok-2',
            has_more: true,
          })
        }
        if (sync === 'tok-2') {
          return HttpResponse.json({
            data: [
              {
                action: 'removed',
                resource: { gid: 't4', resource_type: 'task' },
                parent: { gid: PROJECT, resource_type: 'project' },
              },
              { action: 'changed', resource: { gid: 't5', resource_type: 'task' }, parent: null },
              {
                action: 'deleted',
                resource: { gid: 'c7', resource_type: 'story', resource_subtype: 'comment_added' },
                parent: { gid: 't6', resource_type: 'task' },
              },
            ],
            sync: 'tok-3',
            has_more: false,
          })
        }
        throw new Error(`unexpected sync ${sync}`)
      })
    )
    const result = await syncAsanaProject({ ...baseInput, cursor, now: NOW })
    expect(seen).toEqual(['tok-1', 'tok-2'])
    expect(calls.list).toBe(0)
    expect(calls.get.sort()).toEqual(['t1', 't3', 't5'])
    expect(result.records.map((r) => r.externalId).sort()).toEqual(['c9', 't1', 't3'])
    expect(result.records.find((r) => r.externalId === 't1')?.title).toBe('Renamed')
    // t2 deleted, t4 removed from the project, t5 gone (404), c7 comment deleted.
    expect(result.deletedExternalIds.sort()).toEqual(['c7', 't2', 't4', 't5'])
    expect(result.cursor.value).toBe('tok-3')
  })

  it('treats a task no longer in the project as deleted', async () => {
    server.use(
      ...projectHandlers({ t1: task('t1', { memberships: [{ project: { gid: 'other' } }] }) }),
      eventsHandler(() =>
        HttpResponse.json({
          data: [{ action: 'changed', resource: { gid: 't1', resource_type: 'task' }, parent: null }],
          sync: 'tok-2',
          has_more: false,
        })
      )
    )
    const result = await syncAsanaProject({ ...baseInput, cursor, now: NOW })
    expect(result.records).toEqual([])
    expect(result.deletedExternalIds).toEqual(['t1'])
  })

  it('does a full read when the sync token has expired (412)', async () => {
    const calls = { list: 0, get: [] as string[], stories: [] as string[] }
    server.use(
      ...projectHandlers({ t1: task('t1'), t2: task('t2') }, {}, calls),
      eventsHandler((sync) => {
        expect(sync).toBe('tok-1')
        return expired412('tok-fresh')
      })
    )
    const result = await syncAsanaProject({ ...baseInput, cursor, now: NOW })
    expect(calls.list).toBe(1)
    expect(result.records.map((r) => r.externalId).sort()).toEqual(['t1', 't2'])
    expect(result.cursor.value).toBe('tok-fresh')
    expect(result.deletedExternalIds).toEqual([])
  })

  it('stops event paging at the cap and on a repeated sync token', async () => {
    let n = 0
    server.use(
      ...projectHandlers({}),
      eventsHandler(() => {
        n += 1
        return HttpResponse.json({ data: [], sync: `tok-${n + 1}`, has_more: true })
      })
    )
    const capped = await syncAsanaProject({ ...baseInput, cursor, now: NOW })
    expect(n).toBe(ASANA_EVENT_MAX_PAGES)
    expect(capped.cursor.value).toBe(`tok-${ASANA_EVENT_MAX_PAGES + 1}`)

    let m = 0
    server.use(
      eventsHandler(() => {
        m += 1
        return HttpResponse.json({ data: [], sync: 'tok-same', has_more: true })
      })
    )
    const looped = await syncAsanaProject({ ...baseInput, cursor, now: NOW })
    expect(m).toBe(2)
    expect(looped.cursor.value).toBe('tok-same')
  })

  it('caps the full read and stops on a repeated offset', async () => {
    let pages = 0
    server.use(
      http.get(`${API}/tasks`, () => {
        pages += 1
        return HttpResponse.json({
          data: Array.from({ length: 100 }, (_, i) =>
            task(`p${pages}-${i}`, { modified_at: '2020-01-01T00:00:00.000Z' })
          ),
          next_page: { offset: `off-${pages}` },
        })
      }),
      eventsHandler(() => expired412('tok'))
    )
    const result = await syncAsanaProject({ ...baseInput, cursor: null, now: NOW })
    expect(result.records).toHaveLength(ASANA_MAX_TASKS)
    expect(pages).toBe(Math.ceil(ASANA_MAX_TASKS / 100))

    pages = 0
    server.use(
      http.get(`${API}/tasks`, () => {
        pages += 1
        return HttpResponse.json({
          data: [task(`loop-${pages}`, { modified_at: '2020-01-01T00:00:00.000Z' })],
          next_page: { offset: 'same' },
        })
      })
    )
    await syncAsanaProject({ ...baseInput, cursor: null, now: NOW })
    expect(pages).toBe(2)
  })

  it('retries once after 429 Retry-After, then throws', async () => {
    vi.useFakeTimers()
    let hits = 0
    server.use(
      eventsHandler(() => {
        hits += 1
        return HttpResponse.json(
          { errors: [{ message: 'Rate limit' }] },
          { status: 429, headers: { 'Retry-After': '30' } }
        )
      })
    )
    const promise = syncAsanaProject({ ...baseInput, cursor, now: NOW })
    const settled = promise.catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(29_000)
    expect(hits).toBe(1)
    await vi.advanceTimersByTimeAsync(1_000)
    const error = (await settled) as AsanaRateLimitedError
    expect(hits).toBe(2)
    expect(error).toBeInstanceOf(AsanaRateLimitedError)
    expect(error.retryAfter).toBe(30)
    expect(String(error.message)).not.toContain(TOKEN)
    expect(String(error.message)).not.toContain('app.asana.com')
    expect((error as Error & { cause?: unknown }).cause).toBeUndefined()
  })

  it('succeeds when the retry after 429 works, and clamps Retry-After to 60 s', async () => {
    vi.useFakeTimers()
    let hits = 0
    server.use(
      ...projectHandlers({}),
      eventsHandler(() => {
        hits += 1
        if (hits === 1) return HttpResponse.json({}, { status: 429, headers: { 'Retry-After': '3600' } })
        return HttpResponse.json({ data: [], sync: 'tok-2', has_more: false })
      })
    )
    const promise = syncAsanaProject({ ...baseInput, cursor, now: NOW })
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await promise).cursor.value).toBe('tok-2')
    expect(hits).toBe(2)
  })

  it('waits a safe default when Retry-After is not a number', async () => {
    vi.useFakeTimers()
    let hits = 0
    server.use(
      ...projectHandlers({}),
      eventsHandler(() => {
        hits += 1
        if (hits === 1) return HttpResponse.json({}, { status: 429, headers: { 'Retry-After': 'soon' } })
        return HttpResponse.json({ data: [], sync: 'tok-2', has_more: false })
      })
    )
    const promise = syncAsanaProject({ ...baseInput, cursor, now: NOW })
    await vi.advanceTimersByTimeAsync(60_000)
    expect((await promise).cursor.value).toBe('tok-2')
  })

  it.each([
    [401, { errors: [{ message: 'Not Authorized' }] }, AsanaAuthError],
    [403, { errors: [{ message: 'Forbidden' }] }, AsanaAuthError],
    [403, { errors: [{ message: 'You have exceeded the rate limit' }] }, AsanaRateLimitedError],
    [500, { errors: [{ message: 'Server error' }] }, AsanaRequestError],
  ])('maps %s to the right error without leaking the request', async (status, body, ErrorClass) => {
    server.use(eventsHandler(() => HttpResponse.json(body, { status })))
    const error = await syncAsanaProject({ ...baseInput, cursor, now: NOW }).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ErrorClass)
    const e = error as Error & { cause?: unknown; status?: number }
    expect(e.status).toBe(status)
    expect(e.message).not.toContain(TOKEN)
    expect(e.message).not.toContain('sync=')
    expect(e.message).not.toContain('app.asana.com')
    expect(e.cause).toBeUndefined()
    expect(JSON.stringify(e)).not.toContain(TOKEN)
  })
})

describe('listAsanaProjects', () => {
  it('listAsanaProjects returns id and name', async () => {
    server.use(
      http.get(`${API}/projects`, ({ request }) => {
        authOk(request)
        const url = new URL(request.url)
        expect(url.searchParams.get('workspace')).toBe('w1')
        if (url.searchParams.get('offset') === 'o2') {
          return HttpResponse.json({ data: [{ gid: 'p3', name: 'Gamma' }], next_page: null })
        }
        return HttpResponse.json({
          data: [
            { gid: 'p1', name: 'Alpha' },
            { gid: 'p2', name: 'Beta' },
          ],
          next_page: { offset: 'o2' },
        })
      })
    )
    expect(await listAsanaProjects(TOKEN, 'w1')).toEqual([
      { id: 'p1', name: 'Alpha' },
      { id: 'p2', name: 'Beta' },
      { id: 'p3', name: 'Gamma' },
    ])
  })

  it('reads every workspace when none is given', async () => {
    server.use(
      http.get(`${API}/workspaces`, () =>
        HttpResponse.json({
          data: [
            { gid: 'w1', name: 'Agency' },
            { gid: 'w2', name: 'Personal' },
          ],
          next_page: null,
        })
      ),
      http.get(`${API}/projects`, ({ request }) => {
        const ws = new URL(request.url).searchParams.get('workspace')
        return HttpResponse.json({ data: [{ gid: `${ws}-p`, name: `Project in ${ws}` }], next_page: null })
      })
    )
    expect(await listAsanaProjects(TOKEN)).toEqual([
      { id: 'w1-p', name: 'Project in w1' },
      { id: 'w2-p', name: 'Project in w2' },
    ])
  })
})
