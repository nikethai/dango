import { recordId, type SourceRecord } from '@shared/pm-pilot'
import type { Scope } from '@shared/types/scope'
import type { ConnectedSource } from '@shared/types/sources'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { state, getRecords, reloadRecords, getSourceHealth, getWindowRole, calls } = vi.hoisted(() => {
  const calls: string[] = []
  return {
    calls,
    state: { scopes: [] as Scope[], sources: [] as ConnectedSource[] },
    getRecords: vi.fn(async (_scopeId: string): Promise<SourceRecord[]> => []),
    reloadRecords: vi.fn(() => {
      calls.push('reload')
      return Promise.resolve()
    }),
    getSourceHealth: vi.fn((_id: string): { ok: true } | { ok: false; message: string } => ({ ok: true })),
    getWindowRole: vi.fn(async (): Promise<'jobs' | 'quick' | 'other'> => 'quick'),
  }
})

vi.mock('./bridge', () => ({
  listClientScopes: async () => state.scopes.filter((s) => s.kind === 'client'),
  loadSources: async () => undefined,
  listSources: () => state.sources,
}))
vi.mock('./store', () => ({
  pmStore: {
    getRecords: (scopeId: string) => {
      calls.push(`get:${scopeId}`)
      return getRecords(scopeId)
    },
    reloadRecords: () => reloadRecords(),
  },
}))
vi.mock('./pipeline', () => ({ getSourceHealth: (id: string) => getSourceHealth(id) }))
vi.mock('@/platform/windowRole', () => ({ getWindowRole: () => getWindowRole() }))

import { RECALL_RECORD_TEXT_CHARS, RECALL_TOTAL_CHARS, recallClient, resolveClientScope } from './recall'

const scope = (id: string, name: string, kind: 'client' | 'project' = 'client') => ({ id, name, kind }) as Scope

function source(over: Partial<ConnectedSource> & { id: string; scopeId: string }): ConnectedSource {
  return {
    kind: 'gmail',
    label: 'jo@agency.com',
    backgroundReview: false,
    localOnly: false,
    config: {},
    connectedAt: 0,
    ...over,
  }
}

function rec(over: Partial<SourceRecord> & { externalId: string }): SourceRecord {
  return {
    id: recordId(over.sourceKind ?? 'gmail', over.externalId),
    sourceKind: 'gmail',
    sourceId: 'g-acme',
    accountId: 'acc1',
    threadOrTaskId: `t-${over.externalId}`,
    scopeId: 'acme',
    author: 'jo@acme.com',
    authorName: 'Jo Bloggs',
    participants: ['jo@acme.com'],
    occurredAt: Date.UTC(2026, 8, 12, 12),
    title: 'Launch',
    text: 'The launch is on 12 Sep.',
    sentByMe: false,
    noise: false,
    link: { label: 'Gmail thread', url: 'https://mail.google.com/mail/#all/x' },
    ...over,
  }
}

beforeEach(() => {
  calls.length = 0
  state.scopes = [scope('acme', 'Acme'), scope('globex', 'Globex'), scope('site', 'Website', 'project')]
  state.sources = [
    source({ id: 'g-acme', scopeId: 'acme' }),
    source({ id: 'g-globex', scopeId: 'globex' }),
    source({ id: 'a-acme', scopeId: 'acme', kind: 'asana', label: 'Asana' }),
  ]
  getRecords.mockReset().mockResolvedValue([])
  reloadRecords.mockClear()
  getSourceHealth.mockReset().mockReturnValue({ ok: true })
  getWindowRole.mockReset().mockResolvedValue('quick')
})

describe('resolveClientScope', () => {
  const scopes = [scope('acme', 'Acme'), scope('acme-labs', 'Acme Labs'), scope('globex', 'Globex Corp')]

  it("uses the session's client scope when no name is given", () => {
    expect(resolveClientScope(undefined, 'globex', scopes)).toEqual({ ok: true, scope: scopes[2] })
    expect(resolveClientScope('  ', 'globex', scopes)).toEqual({ ok: true, scope: scopes[2] })
  })

  it('asks for a client when none is given and the session is not in a client scope', () => {
    const out = resolveClientScope(undefined, 'site', scopes)
    expect(out).toEqual({
      ok: false,
      code: 'no_client_given',
      candidates: scopes.map(({ id, name }) => ({ id, name })),
    })
  })

  it('matches by id or case-insensitive name, preferring an exact name', () => {
    expect(resolveClientScope('globex', undefined, scopes)).toMatchObject({ ok: true, scope: { id: 'globex' } })
    expect(resolveClientScope('GLOBEX', undefined, scopes)).toMatchObject({ ok: true, scope: { id: 'globex' } })
    expect(resolveClientScope('acme', undefined, scopes)).toMatchObject({ ok: true, scope: { id: 'acme' } })
    expect(resolveClientScope('Globex Corporation Ltd', undefined, scopes)).toMatchObject({
      ok: true,
      scope: { id: 'globex' },
    })
  })

  it('returns ambiguous_client with candidates when two names match', () => {
    const two = [scope('a1', 'Acme North'), scope('a2', 'Acme South'), scope('g', 'Globex')]
    expect(resolveClientScope('acme', 'g', two)).toEqual({
      ok: false,
      code: 'ambiguous_client',
      candidates: [
        { id: 'a1', name: 'Acme North' },
        { id: 'a2', name: 'Acme South' },
      ],
    })
  })

  it('returns unknown_client for a name that matches no client', () => {
    expect(resolveClientScope('Initech', 'acme', scopes)).toMatchObject({ ok: false, code: 'unknown_client' })
  })

  it('matches whole words only, with accents folded', () => {
    const few = [scope('ab', 'AB'), scope('viet', 'Việt Foods')]
    expect(resolveClientScope('lab report', undefined, few)).toMatchObject({ ok: false, code: 'unknown_client' })
    expect(resolveClientScope('AB team', undefined, few)).toMatchObject({ ok: true, scope: { id: 'ab' } })
    expect(resolveClientScope('viet foods', undefined, few)).toMatchObject({ ok: true, scope: { id: 'viet' } })
    expect(resolveClientScope('Viet', undefined, few)).toMatchObject({ ok: true, scope: { id: 'viet' } })
  })
})

describe('recallClient', () => {
  it("uses the chat's client scope when no name is given", async () => {
    getRecords.mockResolvedValue([rec({ externalId: 'm1' })])
    const out = await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: false })
    expect(out).toMatchObject({ ok: true, scope: { id: 'acme', name: 'Acme' } })
    expect(getRecords).toHaveBeenCalledWith('acme')
    if (!out.ok) throw new Error('expected ok')
    expect(out.records).toHaveLength(1)
    expect(out.records[0]).toMatchObject({
      title: 'Launch',
      text: 'The launch is on 12 Sep.',
      link: { label: 'Gmail thread', url: 'https://mail.google.com/mail/#all/x' },
      occurredAt: Date.UTC(2026, 8, 12, 12),
    })
  })

  it('returns ambiguous_client with candidates when two names match', async () => {
    state.scopes = [scope('a1', 'Acme North'), scope('a2', 'Acme South')]
    const out = await recallClient({ client: 'acme', query: 'launch', cloudModel: false })
    expect(out).toEqual({
      ok: false,
      code: 'ambiguous_client',
      candidates: [
        { id: 'a1', name: 'Acme North' },
        { id: 'a2', name: 'Acme South' },
      ],
    })
    expect(getRecords).not.toHaveBeenCalled()
  })

  it("never returns another scope's records", async () => {
    getRecords.mockResolvedValue([
      rec({ externalId: 'mine', text: 'Acme launch' }),
      rec({ externalId: 'theirs', scopeId: 'globex', sourceId: 'g-globex', text: 'Globex launch secret' }),
      rec({ externalId: 'nowhere', scopeId: null, text: 'unscoped launch' }),
    ])
    const out = await recallClient({
      client: 'Acme',
      query: 'launch',
      sessionScopeId: 'globex',
      userMessage: 'What did Acme say about the launch?',
      cloudModel: false,
    })
    if (!out.ok) throw new Error('expected ok')
    expect(out.records.map((r) => r.text)).toEqual(['Acme launch'])
    expect(getRecords.mock.calls.map(([id]) => id)).toEqual(['acme'])

    // A project scope is never searched, by session or by id.
    expect(await recallClient({ query: 'launch', sessionScopeId: 'site', cloudModel: false })).toMatchObject({
      ok: false,
      code: 'no_client_given',
    })
    expect(await recallClient({ client: 'site', query: 'launch', cloudModel: false })).toMatchObject({
      ok: false,
      code: 'unknown_client',
    })
    expect(getRecords.mock.calls.map(([id]) => id)).toEqual(['acme'])
  })

  it('reloads records from storage before reading them outside the jobs window', async () => {
    await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: false })
    expect(calls).toEqual(['reload', 'get:acme'])
  })

  it('reads the cached records in the jobs window, which holds the newest copy', async () => {
    getWindowRole.mockResolvedValue('jobs')
    await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: false })
    expect(reloadRecords).not.toHaveBeenCalled()
    expect(calls).toEqual(['get:acme'])
  })

  it('lists a failing source as a gap', async () => {
    getRecords.mockResolvedValue([rec({ externalId: 'm1' })])
    getSourceHealth.mockImplementation((id) =>
      id === 'g-acme' ? { ok: false, message: 'sign in again' } : { ok: true }
    )
    const out = await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: true })
    if (!out.ok) throw new Error('expected ok')
    expect(out.gaps).toEqual(['Gmail: sign in again — results may be out of date'])
    expect(out.records).toHaveLength(1)
    // Another scope's failing source is not this client's gap.
    getSourceHealth.mockImplementation((id) =>
      id === 'g-globex' ? { ok: false, message: 'sign in again' } : { ok: true }
    )
    const other = await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: true })
    expect(other.ok && other.gaps).toEqual([])
  })

  it('skips local-only records on a cloud model and says so', async () => {
    state.sources = [
      source({ id: 'g-acme', scopeId: 'acme', localOnly: true }),
      source({ id: 'a-acme', scopeId: 'acme', kind: 'asana', label: 'Asana' }),
    ]
    getRecords.mockResolvedValue([
      rec({ externalId: 'mail', text: 'Private launch mail' }),
      rec({ externalId: 'task', sourceKind: 'asana', sourceId: 'a-acme', text: 'Launch task' }),
      rec({ externalId: 'orphan', sourceId: null, text: 'Launch with no source' }),
      rec({ externalId: 'removed', sourceId: 'gone', text: 'Launch from a removed source' }),
    ])
    const cloud = await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: true })
    if (!cloud.ok) throw new Error('expected ok')
    expect(cloud.records.map((r) => r.text)).toEqual(['Launch task'])
    expect(cloud.gaps).toEqual([
      'Gmail stays on this device, so it was not searched',
      'Some email or tasks from a removed source were not searched',
    ])

    const local = await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: false })
    if (!local.ok) throw new Error('expected ok')
    expect(local.records).toHaveLength(4)
    expect(local.gaps).toEqual([])
  })

  it("in a client's chat, recalls another client only when the user named it", async () => {
    getRecords.mockResolvedValue([rec({ externalId: 'm1', scopeId: 'globex', sourceId: 'g-globex' })])
    // The model asks for Globex, but the user never mentioned it (the name may come from mail in Acme's records).
    const refused = await recallClient({
      client: 'Globex',
      query: 'price',
      sessionScopeId: 'acme',
      userMessage: 'What did the lab report say?',
      cloudModel: false,
    })
    expect(refused).toEqual({
      ok: false,
      code: 'ambiguous_client',
      candidates: [
        { id: 'acme', name: 'Acme' },
        { id: 'globex', name: 'Globex' },
      ],
    })
    expect(
      await recallClient({ client: 'Globex', query: 'price', sessionScopeId: 'acme', cloudModel: false })
    ).toMatchObject({ ok: false, code: 'ambiguous_client' })
    expect(getRecords).not.toHaveBeenCalled()

    const asked = await recallClient({
      client: 'Globex',
      query: 'price',
      sessionScopeId: 'acme',
      userMessage: 'and what did globex say about the price?',
      cloudModel: false,
    })
    expect(asked).toMatchObject({ ok: true, scope: { id: 'globex' } })
    // Outside a client chat, a name alone is enough.
    expect(
      await recallClient({ client: 'Globex', query: 'price', sessionScopeId: 'site', cloudModel: false })
    ).toMatchObject({ ok: true, scope: { id: 'globex' } })
  })

  it('marks a result that holds local-only or unknown-source records (local model only)', async () => {
    state.sources = [
      source({ id: 'g-acme', scopeId: 'acme', localOnly: true }),
      source({ id: 'a-acme', scopeId: 'acme', kind: 'asana', label: 'Asana' }),
    ]
    getRecords.mockResolvedValue([rec({ externalId: 'mail', text: 'Private launch mail' })])
    const local = await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: false })
    expect(local).toMatchObject({ ok: true, localOnly: true })

    getRecords.mockResolvedValue([rec({ externalId: 'orphan', sourceId: null, text: 'Launch' })])
    expect(await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: false })).toMatchObject({
      localOnly: true,
    })

    getRecords.mockResolvedValue([rec({ externalId: 'task', sourceKind: 'asana', sourceId: 'a-acme', text: 'Launch' })])
    const shared = await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: false })
    expect(shared.ok && 'localOnly' in shared).toBe(false)

    getRecords.mockResolvedValue([
      rec({ externalId: 'mail', text: 'Private launch mail' }),
      rec({ externalId: 'task', sourceKind: 'asana', sourceId: 'a-acme', text: 'Launch' }),
    ])
    const cloud = await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: true })
    expect(cloud.ok && 'localOnly' in cloud).toBe(false)
  })

  it('does not fail on a record with an out-of-range date', async () => {
    getRecords.mockResolvedValue([rec({ externalId: 'bad', occurredAt: 9e15 })])
    const out = await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: false })
    expect(out.ok && out.records[0].date).toBe('')
  })

  it('says when nothing is synced yet', async () => {
    const out = await recallClient({ query: 'launch', sessionScopeId: 'acme', cloudModel: false })
    expect(out).toEqual({
      ok: true,
      scope: { id: 'acme', name: 'Acme' },
      records: [],
      gaps: ['No email or tasks synced yet'],
    })
  })

  it('ranks by shared words then date, skips noise, and honours the limit (default 8)', async () => {
    const day = 24 * 60 * 60 * 1000
    getRecords.mockResolvedValue([
      ...Array.from({ length: 10 }, (_, i) =>
        rec({ externalId: `old${i}`, text: `Lunch menu ${i}`, occurredAt: i * day })
      ),
      rec({ externalId: 'match', text: 'Invoice for the homepage', occurredAt: 0 }),
      rec({ externalId: 'noise', text: 'Invoice newsletter', noise: true, occurredAt: 20 * day }),
    ])
    const out = await recallClient({ query: 'homepage invoice', sessionScopeId: 'acme', cloudModel: false })
    if (!out.ok) throw new Error('expected ok')
    expect(out.records).toHaveLength(8)
    expect(out.records[0].text).toBe('Invoice for the homepage')
    expect(out.records[1].text).toBe('Lunch menu 9')
    expect(out.records.some((r) => r.text.includes('newsletter'))).toBe(false)
    const two = await recallClient({ query: 'x', sessionScopeId: 'acme', cloudModel: false, limit: 2 })
    expect(two.ok && two.records).toHaveLength(2)
  })

  it('caps text per record and in total, and keeps only http(s) links', async () => {
    getRecords.mockResolvedValue([
      rec({ externalId: 'big', text: 'a'.repeat(50_000), title: 't'.repeat(5_000) }),
      ...Array.from({ length: 19 }, (_, i) => rec({ externalId: `b${i}`, text: 'b'.repeat(RECALL_RECORD_TEXT_CHARS) })),
      rec({ externalId: 'js', text: 'click', link: { label: 'x', url: 'javascript:alert(1)' }, occurredAt: 9e12 }),
    ])
    const out = await recallClient({ query: 'click', sessionScopeId: 'acme', cloudModel: false, limit: 50 })
    if (!out.ok) throw new Error('expected ok')
    for (const r of out.records) expect(r.text.length).toBeLessThanOrEqual(RECALL_RECORD_TEXT_CHARS + 1)
    const total = out.records.reduce((n, r) => n + r.text.length + r.title.length, 0)
    expect(total).toBeLessThanOrEqual(RECALL_TOTAL_CHARS)
    expect(out.records[0].text).toBe('click')
    expect(out.records[0].link).toBeUndefined()
    expect(out.records.every((r) => !r.link || /^https?:\/\//.test(r.link.url))).toBe(true)
  })
})
