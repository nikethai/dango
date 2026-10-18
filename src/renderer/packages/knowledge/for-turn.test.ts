import type { KnowledgeProposal, KnowledgeState } from '@shared/types/knowledge'
import { emptyKnowledgeState } from '@shared/types/knowledge'
import type { ReviewEntry } from '@shared/types/review'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addReviewEntry, reviewStore, setReviewStorageForTests } from '@/packages/review'
import { formatKnowledgeSection, isLegacyMemoryActive, knowledgeForTurn } from './for-turn'
import { _resetScopesForTests, _setScopeReaderForTests } from './scopes'
import { NEVER_SEND_EMAIL } from './select'
import { _resetKnowledgeForTests, ensureKnowledgeLoaded, knowledgeStore } from './store'
import { getRaw, type MakeItemInput, makeItem, putRaw, resetTestStorage } from './test-storage'

vi.mock('@/storage', async () => (await import('./test-storage')).default)
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, string>) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => vars?.[k] ?? ''),
}))
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn(() => 'undo-1') }))
const memory = vi.hoisted(() => ({ enabled: true }))
vi.mock('@/stores/memoryStore', () => ({
  memoryStore: { getState: () => ({ settings: { enabled: memory.enabled } }) },
}))
vi.mock('@/packages/review', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/packages/review')>()
  return { ...actual, addReviewEntry: vi.fn(actual.addReviewEntry) }
})

let reviewData: Record<string, unknown> = {}
const reviewEntries = (): ReviewEntry[] =>
  (reviewData['review-entries'] as { entries: ReviewEntry[] } | undefined)?.entries ?? []
const recheckCalls = () => vi.mocked(addReviewEntry).mock.calls.filter(([e]) => e.kind === 're-check')
const stored = () => (getRaw<KnowledgeState>('knowledge') as KnowledgeState | undefined) ?? emptyKnowledgeState()
const ids = (scopeId: string) => knowledgeForTurn(scopeId).map((i) => i.id)

const SCOPES = [
  { id: 'acme', name: 'Acme', kind: 'client' },
  { id: 'quiet', name: 'Quiet', kind: 'client', readsEverywhere: { facts: false, documents: false } },
  { id: 'proj', name: 'Proj', kind: 'project' },
]

beforeEach(() => {
  resetTestStorage()
  _resetKnowledgeForTests()
  _resetScopesForTests()
  _setScopeReaderForTests(async () => SCOPES as never)
  reviewData = {}
  setReviewStorageForTests({
    getItem: async <T>(k: string, fb: T) => (k in reviewData ? (structuredClone(reviewData[k]) as T) : fb),
    setItemNow: (k: string, v: unknown) => {
      reviewData[k] = structuredClone(v)
      return Promise.resolve()
    },
  })
  reviewStore.setState({ entries: [], lastCheckedAt: undefined, loaded: false })
  vi.mocked(addReviewEntry).mockClear()
  memory.enabled = true
})

afterEach(() => {
  setReviewStorageForTests(null)
})

/** Writes items (and proposals) straight into storage, as another window would, then loads fresh. */
async function seed(items: MakeItemInput[], proposals: KnowledgeProposal[] = []) {
  const made = await Promise.all(items.map((o) => makeItem({ scopeId: 'acme', ...o })))
  putRaw('knowledge', { ...stored(), items: [...stored().items, ...made], proposals })
  await ensureKnowledgeLoaded({ fresh: true })
  return made
}

describe('knowledgeForTurn', () => {
  it('scope items come first, then Everywhere preferences and facts', async () => {
    await seed([
      { id: 'a-old', text: 'Acme old', updatedAt: 1 },
      { id: 'a-new', text: 'Acme new', updatedAt: 5 },
      { id: 'e-fact', scopeId: EVERYWHERE_SCOPE_ID, text: 'Office is in Hanoi', updatedAt: 9 },
      { id: 'e-pref', scopeId: EVERYWHERE_SCOPE_ID, kind: 'preference', text: 'Answer briefly', updatedAt: 2 },
      { id: 'other', scopeId: 'proj', text: 'Not mine' },
    ])

    expect(ids('acme')).toEqual(['a-new', 'a-old', NEVER_SEND_EMAIL.id, 'e-pref', 'e-fact'])
  })

  it('client scope with facts off gets preferences only', async () => {
    await seed([
      { id: 'q1', scopeId: 'quiet', text: 'Quiet fact' },
      { id: 'e-fact', scopeId: EVERYWHERE_SCOPE_ID, text: 'Office is in Hanoi' },
      { id: 'e-dec', scopeId: EVERYWHERE_SCOPE_ID, kind: 'decision', text: 'We ship on Fridays' },
      { id: 'e-pref', scopeId: EVERYWHERE_SCOPE_ID, kind: 'preference', text: 'Answer briefly' },
    ])

    expect(ids('quiet')).toEqual(['q1', NEVER_SEND_EMAIL.id, 'e-pref'])
  })

  it('client scope without readsEverywhere reads facts', async () => {
    await seed([{ id: 'e-fact', scopeId: EVERYWHERE_SCOPE_ID, text: 'Office is in Hanoi' }])

    expect(ids('acme')).toEqual([NEVER_SEND_EMAIL.id, 'e-fact'])
    // An unknown scope fails closed to the client defaults, which read facts.
    expect(ids('gone')).toEqual([NEVER_SEND_EMAIL.id, 'e-fact'])
  })

  it('Everywhere reads only its own items', async () => {
    await seed([
      { id: 'a1', text: 'Acme fact' },
      { id: 'e-fact', scopeId: EVERYWHERE_SCOPE_ID, text: 'Office is in Hanoi' },
      { id: 'e-pref', scopeId: EVERYWHERE_SCOPE_ID, kind: 'preference', text: 'Answer briefly' },
    ])

    expect(ids(EVERYWHERE_SCOPE_ID)).toEqual([NEVER_SEND_EMAIL.id, 'e-pref', 'e-fact'])
  })

  it('overridden Everywhere item is left out', async () => {
    await seed([
      { id: 'e-fact', scopeId: EVERYWHERE_SCOPE_ID, text: 'Invoices are due in 30 days' },
      { id: 'e-pref', scopeId: EVERYWHERE_SCOPE_ID, kind: 'preference', text: 'Answer in English' },
      { id: 'a1', text: 'Acme invoices are due in 14 days', overrides: ['e-fact', 'e-pref', NEVER_SEND_EMAIL.id] },
    ])

    // The built-in preference always applies.
    expect(ids('acme')).toEqual(['a1', NEVER_SEND_EMAIL.id])
    // Other scopes still read the Everywhere items.
    expect(ids('proj')).toEqual([NEVER_SEND_EMAIL.id, 'e-pref', 'e-fact'])
  })

  it('pending proposals and superseded items are never included', async () => {
    const proposal: KnowledgeProposal = {
      id: 'p1',
      scopeId: 'acme',
      kind: 'fact',
      text: 'Pending fact',
      sources: [],
      origin: 'chat',
      createdAt: 1,
    }
    await seed(
      [
        { id: 'a1', text: 'Kept' },
        { id: 'a2', text: 'Old', status: 'superseded', supersededBy: 'a1' },
        { id: 'a3', text: 'Gone', status: 'removed' },
      ],
      [proposal, { ...proposal, id: 'p2', scopeId: EVERYWHERE_SCOPE_ID, kind: 'preference' }]
    )

    expect(ids('acme')).toEqual(['a1', NEVER_SEND_EMAIL.id])
  })

  it('tampered item is left out and re-checked', async () => {
    await seed([
      { id: 'a1', text: 'Launch is 6 Nov' },
      { id: 'a2', text: 'Budget is 10k' },
    ])
    expect(ids('acme')).toEqual(expect.arrayContaining(['a1', 'a2']))
    expect(recheckCalls()).toHaveLength(0)

    const doc = stored()
    doc.items[0].text = 'Launch is 1 Dec'
    putRaw('knowledge', doc)
    await ensureKnowledgeLoaded({ fresh: true })

    expect(ids('acme')).not.toContain('a1')
    expect(ids('acme')).toContain('a2')
    expect(knowledgeStore.getState().unverified.has('a1')).toBe(true)
    const rechecks = reviewEntries().filter((e) => e.kind === 're-check')
    expect(rechecks).toHaveLength(1)
    expect(rechecks[0]).toMatchObject({
      text: "Can't verify: Launch is 1 Dec",
      sub: 'It changed outside Dango, so answers leave it out until you approve it again.',
      ref: { type: 'knowledge', id: 'a1' },
      scopeId: 'acme',
      state: 'open',
    })
    expect(stored().items[0].healthNotice).toEqual({ reason: 'unverified', key: 'r1' })

    await ensureKnowledgeLoaded({ fresh: true })
    expect(recheckCalls()).toHaveLength(1)
    expect(ids('acme')).not.toContain('a1')
  })

  it('a changed approval hash or condition also fails verification', async () => {
    await seed([
      { id: 'a1', text: 'Launch is 6 Nov', condition: 'for the EU' },
      { id: 'a2', text: 'Budget is 10k' },
    ])
    const doc = stored()
    doc.items[0].condition = 'for the US'
    const rev = doc.items[1].revisions[0]
    if (rev.approval) rev.approval.contentHash = 'f'.repeat(64)
    putRaw('knowledge', doc)
    await ensureKnowledgeLoaded({ fresh: true })

    expect(ids('acme')).toEqual([NEVER_SEND_EMAIL.id])
  })

  it('due item stays in use and is filed once', async () => {
    await seed([{ id: 'a1', text: 'Launch is 6 Nov', staleAfter: '2026-01-01T00:00:00Z' }])

    expect(ids('acme')).toContain('a1')
    expect(recheckCalls()).toHaveLength(1)
    expect(recheckCalls()[0][0]).toMatchObject({
      kind: 're-check',
      text: 'Due for review: Launch is 6 Nov',
      ref: { type: 'knowledge', id: 'a1' },
    })
    expect(stored().items[0].healthNotice).toEqual({ reason: 'stale', key: '2026-01-01T00:00:00Z' })

    await ensureKnowledgeLoaded({ fresh: true })
    expect(recheckCalls()).toHaveLength(1)

    const doc = stored()
    doc.items[0].staleAfter = '2026-02-01T00:00:00Z'
    putRaw('knowledge', doc)
    await ensureKnowledgeLoaded({ fresh: true })
    expect(recheckCalls()).toHaveLength(2)
    expect(ids('acme')).toContain('a1')
  })

  it('an item due in the future is not filed', async () => {
    await seed([{ id: 'a1', text: 'Launch is 6 Nov', staleAfter: '2999-01-01T00:00:00Z' }])

    expect(recheckCalls()).toHaveLength(0)
    expect(stored().items[0].healthNotice).toBeUndefined()
  })

  it('fresh read before a turn', async () => {
    await ensureKnowledgeLoaded()
    expect(ids('acme')).toEqual([NEVER_SEND_EMAIL.id])

    // Another window (main) approves an item; this window (Quick Chat) has its own store.
    const item = await makeItem({ id: 'new', scopeId: 'acme', text: 'Launch moved to 8 Nov' })
    putRaw('knowledge', { ...stored(), items: [item] })
    await ensureKnowledgeLoaded({ fresh: true })

    expect(ids('acme')).toContain('new')
  })
})

describe('isLegacyMemoryActive', () => {
  it('is true while memory is on and the move has not happened', async () => {
    await ensureKnowledgeLoaded({ fresh: true })
    expect(isLegacyMemoryActive()).toBe(true)
    memory.enabled = false
    expect(isLegacyMemoryActive()).toBe(false)
  })

  it('a fresh load with migration done stored turns it off', async () => {
    expect(isLegacyMemoryActive()).toBe(true)
    putRaw('knowledge-migration', { state: 'done' })
    await ensureKnowledgeLoaded({ fresh: true })
    expect(isLegacyMemoryActive()).toBe(false)
  })
})

describe('formatKnowledgeSection', () => {
  it('lists the scope, then Everywhere, then the tie-break line', async () => {
    await seed([
      { id: 'a1', text: 'Launch is 6 Nov', condition: 'for the EU launch' },
      { id: 'e-fact', scopeId: EVERYWHERE_SCOPE_ID, text: 'Office is in Hanoi' },
    ])

    expect(formatKnowledgeSection('acme', knowledgeForTurn('acme'))).toBe(
      '\n## Approved knowledge: Acme\n' +
        '- Launch is 6 Nov (when for the EU launch)\n' +
        '\n## Approved knowledge: Everywhere\n' +
        '- Never send email\n' +
        '- Office is in Hanoi\n' +
        '\nIf an item for Acme disagrees with an Everywhere item, follow the Acme item.\n'
    )
  })

  it('Everywhere alone has one section and no tie-break line', () => {
    expect(formatKnowledgeSection(EVERYWHERE_SCOPE_ID, [NEVER_SEND_EMAIL])).toBe(
      '\n## Approved knowledge: Everywhere\n- Never send email\n'
    )
  })

  it('an empty list gives an empty string', () => {
    expect(formatKnowledgeSection('acme', [])).toBe('')
  })
})
