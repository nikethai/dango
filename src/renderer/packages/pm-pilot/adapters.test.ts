import { ASANA_POLL_MS, type ClientQuestion, GMAIL_POLL_MS, type SourceRecord, type SyncCursor } from '@shared/pm-pilot'
import type { ConnectedSource } from '@shared/types/sources'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const interpolate = (key: string, values?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values?.[name] ?? ''))
  type Listener = (next: { loaded: boolean; sources: unknown[] }, prev: { loaded: boolean; sources: unknown[] }) => void
  return {
    interpolate,
    sources: [] as ConnectedSource[],
    records: [] as SourceRecord[],
    cursors: [] as SyncCursor[],
    questions: [] as ClientQuestion[],
    calls: [] as string[],
    listeners: [] as Listener[],
    model: null as null | { cloud: boolean },
  }
})

vi.mock('@/i18n', () => ({ default: { t: h.interpolate } }))

vi.mock('./bridge', async () => {
  const { NeedsUserError } = await import('@/packages/background/errors')
  const { JOB_FIX_LABELS } = await import('@shared/types/background')
  return {
    NeedsUserError,
    JOB_FIX_LABELS,
    asanaConfig: (s: { config: Record<string, unknown> }) => ({
      accountId: String(s.config.accountId ?? ''),
      ...(s.config.projectGid ? { projectGid: String(s.config.projectGid) } : {}),
    }),
    addReviewEntry: vi.fn(async (input: Record<string, unknown>) => ({ ...input, state: 'open' })),
    getScope: vi.fn(async (id: string) => (id === 'acme' ? { id, name: 'Acme Co', kind: 'client' } : undefined)),
    isRemovalPending: (s: { removalPendingAt?: number }) => s.removalPendingAt !== undefined,
    listSources: (filter?: { kind?: string; includePending?: boolean }) =>
      h.sources.filter(
        (s) => (!filter?.kind || s.kind === filter.kind) && (filter?.includePending || s.removalPendingAt === undefined)
      ),
    loadSources: vi.fn(async () => undefined),
    registerSourceAdapter: vi.fn(),
    sourcesStore: {
      getState: () => ({ loaded: true, sources: h.sources }),
      subscribe: (listener: (typeof h.listeners)[number]) => {
        h.listeners.push(listener)
        return () => {
          h.listeners = h.listeners.filter((l) => l !== listener)
        }
      },
    },
  }
})

vi.mock('./store', () => ({
  pmStore: {
    upsertRecords: vi.fn((records: SourceRecord[]) => {
      h.calls.push('upsert')
      h.records.push(...records)
      return Promise.resolve()
    }),
    getRecords: vi.fn(async (scopeId: string) => h.records.filter((r) => r.scopeId === scopeId)),
    deleteRecords: vi.fn((sourceId: string, kind: string, ids: string[]) => {
      h.calls.push('delete')
      h.records = h.records.filter(
        (r) => !(r.sourceId === sourceId && r.sourceKind === kind && ids.includes(r.externalId))
      )
      return Promise.resolve()
    }),
    deleteRecordsByThread: vi.fn((sourceId: string, ids: string[]) => {
      h.calls.push('deleteThread')
      h.records = h.records.filter((r) => !(r.sourceId === sourceId && ids.includes(r.threadOrTaskId)))
      return Promise.resolve()
    }),
    removeSourceRecords: vi.fn(async () => undefined),
    removeCursors: vi.fn((remove: (c: SyncCursor) => boolean) => {
      h.cursors = h.cursors.filter((c) => !remove(c))
      return Promise.resolve()
    }),
    pruneRecords: vi.fn(async () => undefined),
    getCursor: vi.fn(async (accountId: string, kind: string, scope: string) =>
      h.cursors.find((c) => c.accountId === accountId && c.sourceKind === kind && c.scope === scope)
    ),
    setCursor: vi.fn((c: SyncCursor) => {
      h.calls.push('cursor')
      h.cursors.push(c)
      return Promise.resolve()
    }),
    saveQuestion: vi.fn((q: ClientQuestion) => {
      h.questions = [...h.questions.filter((x) => x.id !== q.id), q]
      return Promise.resolve()
    }),
    findOpenQuestion: vi.fn(async (by: { kind: string; sourceId: string }) =>
      h.questions.find((q) => q.state === 'open' && q.kind === by.kind && q.sourceId === by.sourceId)
    ),
  },
}))

vi.mock('./tokens', () => ({ getFreshToken: vi.fn(async () => ({ ok: true, token: 'tok' })) }))
vi.mock('./background-model', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./background-model')>()
  return { errorClassName: orig.errorClassName, resolveBackgroundModel: vi.fn(async () => h.model) }
})
vi.mock('./asana-adapter', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./asana-adapter')>()
  return { ...orig, listAsanaProjects: vi.fn(), syncAsanaProject: vi.fn() }
})
vi.mock('./pipeline', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./pipeline')>()
  return { ...orig, runGmailPipeline: vi.fn() }
})

import { NeedsUserError } from '@/packages/background/errors'
import {
  _resetAdaptersForTests,
  READ_MAX_ITEMS,
  readSourceItems,
  registerPmAdapters,
  syncAsanaSource,
} from './adapters'
import {
  AsanaAuthError,
  AsanaForbiddenError,
  AsanaRateLimitedError,
  listAsanaProjects,
  syncAsanaProject,
} from './asana-adapter'
import { addReviewEntry, loadSources, registerSourceAdapter } from './bridge'
import { _resetPipelineForTests, getSourceHealth, runGmailPipeline } from './pipeline'
import { pmStore } from './store'
import { getFreshToken } from './tokens'

function asanaSource(over: Partial<ConnectedSource> = {}): ConnectedSource {
  return {
    id: 'a1',
    kind: 'asana',
    scopeId: 'acme',
    label: 'Asana',
    backgroundReview: true,
    localOnly: false,
    config: { accountId: 'acc-asana', projectGid: 'p1' },
    connectedAt: 1,
    ...over,
  }
}

function rec(over: Partial<SourceRecord> & { externalId: string }): SourceRecord {
  return {
    id: `asana:${over.externalId}`,
    sourceKind: 'asana',
    sourceId: 'a1',
    accountId: 'acc-asana',
    threadOrTaskId: over.externalId,
    scopeId: 'acme',
    author: 'Jo',
    participants: [],
    occurredAt: 100,
    title: 'Homepage launch',
    text: 'Launch is 4 Nov',
    sentByMe: false,
    noise: false,
    link: { label: 'Asana', url: 'https://app.asana.com/0/1/2' },
    ...over,
  }
}

const ctx = () => ({ signal: new AbortController().signal, progress: vi.fn() })
const cursorOf = (value: string): SyncCursor => ({
  accountId: 'acc-asana',
  sourceKind: 'asana',
  scope: 'p1',
  value,
  updatedAt: 1,
})

beforeEach(() => {
  vi.clearAllMocks()
  _resetAdaptersForTests()
  _resetPipelineForTests()
  h.sources = [asanaSource()]
  h.records = []
  h.cursors = []
  h.questions = []
  h.calls = []
  h.listeners = []
  h.model = { cloud: true }
  vi.mocked(getFreshToken).mockResolvedValue({ ok: true, token: 'tok' })
})

describe('registerPmAdapters', () => {
  it('registers gmail and asana adapters with their poll intervals', () => {
    registerPmAdapters()
    expect(registerSourceAdapter).toHaveBeenCalledWith('gmail', {
      pollMs: GMAIL_POLL_MS,
      sync: runGmailPipeline,
      read: readSourceItems,
    })
    expect(registerSourceAdapter).toHaveBeenCalledWith('asana', {
      pollMs: ASANA_POLL_MS,
      sync: syncAsanaSource,
      read: readSourceItems,
    })
  })

  it('removes the records of a Gmail or Asana source when it is removed', () => {
    registerPmAdapters()
    expect(h.listeners).toHaveLength(1)
    const gmail = { ...asanaSource({ id: 'g1', kind: 'gmail' }) }
    const folder = { ...asanaSource({ id: 'f1', kind: 'folder' }) }
    h.listeners[0](
      { loaded: true, sources: [asanaSource()] },
      { loaded: true, sources: [asanaSource(), gmail, folder] }
    )
    expect(pmStore.removeSourceRecords).toHaveBeenCalledTimes(1)
    expect(pmStore.removeSourceRecords).toHaveBeenCalledWith('g1')
    // Not before the store is loaded: an empty list then means "not read yet".
    h.listeners[0]({ loaded: true, sources: [] }, { loaded: false, sources: [gmail] })
    expect(pmStore.removeSourceRecords).toHaveBeenCalledTimes(1)
  })

  it('removes the cursors of a removed source; a mailbox cursor only when no source uses the account', async () => {
    registerPmAdapters()
    const gmail = (id: string) => asanaSource({ id, kind: 'gmail', config: { accountId: 'acc-mail' } })
    h.cursors = [
      { ...cursorOf('s'), scope: 'a1:p1' },
      { ...cursorOf('s'), scope: 'a9:p1' },
      { accountId: 'acc-mail', sourceKind: 'gmail', scope: 'mailbox', value: 'h', updatedAt: 1 },
    ]
    h.listeners[0](
      { loaded: true, sources: [gmail('g2')] },
      { loaded: true, sources: [asanaSource(), gmail('g1'), gmail('g2')] }
    )
    await vi.waitFor(() => expect(h.cursors.map((c) => c.scope)).toEqual(['a9:p1', 'mailbox']))
    h.listeners[0]({ loaded: true, sources: [] }, { loaded: true, sources: [gmail('g2')] })
    await vi.waitFor(() => expect(h.cursors.map((c) => c.scope)).toEqual(['a9:p1']))
  })
})

describe('syncAsanaSource', () => {
  it("another Asana source's sync does not prune the records of one pending removal (S11)", async () => {
    h.sources = [asanaSource(), asanaSource({ id: 'a2', removalPendingAt: 1 })]
    vi.mocked(syncAsanaProject).mockResolvedValue({ records: [], cursor: null } as never)
    await syncAsanaSource(h.sources[0], ctx()).catch(() => undefined)
    expect(pmStore.pruneRecords).toHaveBeenCalledWith('asana', new Set(['a1', 'a2']))
  })

  it('Asana without a project asks which project once', async () => {
    h.sources = [asanaSource({ config: { accountId: 'acc-asana' } })]
    vi.mocked(listAsanaProjects).mockResolvedValue([
      { id: 'p1', name: 'Website' },
      { id: 'p2', name: 'Website' },
    ])
    const first = await syncAsanaSource(h.sources[0], ctx())
    expect(first).toEqual({ summary: 'Waiting for you to pick an Asana project', quiet: false })
    expect(h.questions).toEqual([
      expect.objectContaining({
        kind: 'which-project',
        sourceId: 'a1',
        scopeId: 'acme',
        candidates: [
          expect.objectContaining({ value: 'Website', projectGid: 'p1' }),
          expect.objectContaining({ value: 'Website', projectGid: 'p2' }),
        ],
      }),
    ])
    expect(vi.mocked(addReviewEntry).mock.calls[0][0]).toMatchObject({
      kind: 'needs-you',
      text: 'Which Asana project is Acme Co?',
      // Project gids, so two projects with one name stay apart.
      options: [
        { id: 'p1', text: 'Website' },
        { id: 'p2', text: 'Website' },
      ],
    })

    const second = await syncAsanaSource(h.sources[0], ctx())
    expect(second).toEqual({ summary: 'Waiting for you to pick an Asana project', quiet: true })
    expect(listAsanaProjects).toHaveBeenCalledTimes(1)
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
    expect(syncAsanaProject).not.toHaveBeenCalled()
  })

  it('reads a project picked in another window instead of asking again', async () => {
    // The runner's copy of the source has no project; storage has the one the user picked in a chat elsewhere.
    const stale = asanaSource({ config: { accountId: 'acc-asana' } })
    h.sources = [stale]
    vi.mocked(loadSources).mockImplementationOnce(() => {
      h.sources = [asanaSource({ config: { accountId: 'acc-asana', projectGid: 'p2' } })]
      return Promise.resolve()
    })
    vi.mocked(syncAsanaProject).mockResolvedValueOnce({
      records: [],
      cursor: cursorOf('sync-1'),
      deletedExternalIds: [],
    })
    await syncAsanaSource(stale, ctx())
    expect(listAsanaProjects).not.toHaveBeenCalled()
    expect(h.questions).toHaveLength(0)
    expect(vi.mocked(syncAsanaProject).mock.calls[0][0]).toMatchObject({ projectGid: 'p2' })
    expect(pmStore.setCursor).toHaveBeenCalledWith(expect.objectContaining({ scope: 'a1:p2' }))
  })

  it('stores tasks and comments, then saves the cursor per source and project', async () => {
    vi.mocked(syncAsanaProject).mockResolvedValueOnce({
      records: [rec({ externalId: 't1' }), rec({ externalId: 's1', threadOrTaskId: 't1' })],
      cursor: cursorOf('sync-2'),
      deletedExternalIds: [],
    })
    const out = await syncAsanaSource(asanaSource(), ctx())
    expect(out).toEqual({ summary: 'Synced 2 tasks and comments', quiet: false })
    expect(vi.mocked(syncAsanaProject).mock.calls[0][0]).toMatchObject({
      sourceId: 'a1',
      scopeId: 'acme',
      projectGid: 'p1',
      accessToken: 'tok',
      cursor: null,
    })
    expect(pmStore.setCursor).toHaveBeenCalledWith(expect.objectContaining({ value: 'sync-2', scope: 'a1:p1' }))
    expect(h.calls.indexOf('upsert')).toBeLessThan(h.calls.indexOf('cursor'))
    expect(getSourceHealth('a1')).toMatchObject({ ok: true })
  })

  it('a deleted task drops its comments, for this source only', async () => {
    h.cursors = [{ ...cursorOf('sync-1'), scope: 'a1:p1' }]
    h.records = [
      rec({ externalId: 't1' }),
      rec({ externalId: 's1', threadOrTaskId: 't1' }),
      rec({ externalId: 't1', sourceId: 'a2', id: 'asana:t1' }),
      rec({ externalId: 't2' }),
    ]
    vi.mocked(syncAsanaProject).mockResolvedValueOnce({
      records: [],
      cursor: cursorOf('sync-2'),
      deletedExternalIds: ['t1'],
    })
    const out = await syncAsanaSource(asanaSource(), ctx())
    expect(vi.mocked(syncAsanaProject).mock.calls[0][0].cursor).toMatchObject({ value: 'sync-1' })
    expect(h.records.map((r) => `${r.sourceId}/${r.externalId}`)).toEqual(['a2/t1', 'a1/t2'])
    expect(out.quiet).toBe(false)
  })

  it('a first full read drops this source records it did not return', async () => {
    h.records = [rec({ externalId: 'old-project-task' })]
    vi.mocked(syncAsanaProject).mockResolvedValueOnce({
      records: [rec({ externalId: 't9' })],
      cursor: cursorOf('sync-1'),
      deletedExternalIds: [],
    })
    await syncAsanaSource(asanaSource(), ctx())
    expect(h.records.map((r) => r.externalId)).toEqual(['t9'])
  })

  it('a poll with nothing new is quiet', async () => {
    h.cursors = [{ ...cursorOf('sync-1'), scope: 'a1:p1' }]
    vi.mocked(syncAsanaProject).mockResolvedValueOnce({ records: [], cursor: cursorOf('s2'), deletedExternalIds: [] })
    expect(await syncAsanaSource(asanaSource(), ctx())).toEqual({ summary: 'Synced 0 tasks and comments', quiet: true })
  })

  it('401 asks to sign in again; 403 says access was lost, not sign in again', async () => {
    vi.mocked(syncAsanaProject).mockRejectedValueOnce(new AsanaAuthError(401))
    await expect(syncAsanaSource(asanaSource(), ctx())).rejects.toMatchObject({
      reason: 'sign in again',
      fix: { action: 'reconnect' },
    })
    vi.mocked(syncAsanaProject).mockRejectedValueOnce(new AsanaForbiddenError())
    const forbidden = syncAsanaSource(asanaSource(), ctx())
    await expect(forbidden).rejects.toBeInstanceOf(NeedsUserError)
    await expect(forbidden).rejects.toMatchObject({
      reason: 'access to the Asana project was lost',
      fix: { action: 'try-again' },
    })
    expect(getSourceHealth('a1')).toEqual({ ok: false, message: 'access to the Asana project was lost' })
    vi.mocked(getFreshToken).mockResolvedValueOnce({ ok: false, message: 'expired' })
    await expect(syncAsanaSource(asanaSource(), ctx())).rejects.toMatchObject({ fix: { action: 'reconnect' } })
    expect(pmStore.setCursor).not.toHaveBeenCalled()
  })

  it('a rate limit is retried with translated copy and keeps the old cursor', async () => {
    vi.mocked(syncAsanaProject).mockRejectedValueOnce(new AsanaRateLimitedError(429, 10))
    const run = syncAsanaSource(asanaSource(), ctx())
    await expect(run).rejects.toThrow('Asana is busy')
    await expect(run).rejects.not.toBeInstanceOf(NeedsUserError)
    expect(pmStore.setCursor).not.toHaveBeenCalled()
  })
})

describe('readSourceItems', () => {
  it('returns records newer than the cursor, oldest first, at most 40', async () => {
    h.records = Array.from({ length: 50 }, (_, i) => rec({ externalId: `t${i}`, occurredAt: 1000 + i, title: `T${i}` }))
    h.records.push(rec({ externalId: 'noise', occurredAt: 5000, noise: true }))
    h.records.push(rec({ externalId: 'other', occurredAt: 6000, sourceId: 'a2' }))
    const first = await readSourceItems(asanaSource(), { signal: new AbortController().signal, cursor: null })
    expect(first.items).toHaveLength(READ_MAX_ITEMS)
    expect(first.items[0]).toEqual({ ref: 'asana:t0', label: 'T0', text: 'Launch is 4 Nov', updatedAt: 1000 })
    expect(first.cursor).toBe('1039')
    const second = await readSourceItems(asanaSource(), { signal: new AbortController().signal, cursor: first.cursor })
    expect(second.items.map((i) => i.ref)).toEqual(Array.from({ length: 10 }, (_, i) => `asana:t${40 + i}`))
    const third = await readSourceItems(asanaSource(), { signal: new AbortController().signal, cursor: second.cursor })
    expect(third).toEqual({ items: [], cursor: second.cursor })
  })

  it('read skips local-only sources on a cloud model', async () => {
    h.records = [rec({ externalId: 't1' })]
    const local = asanaSource({ localOnly: true })
    const signal = new AbortController().signal
    expect(await readSourceItems(local, { signal, cursor: '5' })).toEqual({ items: [], cursor: '5' })
    h.model = null
    expect((await readSourceItems(local, { signal, cursor: null })).items).toEqual([])
    h.model = { cloud: false }
    expect((await readSourceItems(local, { signal, cursor: null })).items).toHaveLength(1)
  })
})
