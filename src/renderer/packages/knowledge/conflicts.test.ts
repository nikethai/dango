import type { KnowledgeConflict, KnowledgeProposal, KnowledgeState } from '@shared/types/knowledge'
import type { ReviewEntry } from '@shared/types/review'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { reviewStore, setReviewStorageForTests } from '@/packages/review'
import { pushUndo, type UndoInput } from '@/packages/undo'
import { resolveConflict } from './conflicts'
import { moveProposalsForSession } from './proposals'
import { startReviewSync } from './review-sync'
import { _resetScopesForTests, _setScopeReaderForTests } from './scopes'
import { _resetKnowledgeForTests, commitKnowledge } from './store'
import { getRaw, makeItem, resetTestStorage } from './test-storage'
import { contentHash } from './text'
import { listKnowledgeUses, recordKnowledgeUse } from './uses'

vi.mock('@/storage', async () => (await import('./test-storage')).default)
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, string>) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => vars?.[k] ?? ''),
}))
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn(() => 'undo-1') }))

let reviewData: Record<string, unknown> = {}
const reviewEntries = (): ReviewEntry[] =>
  (reviewData['review-entries'] as { entries: ReviewEntry[] } | undefined)?.entries ?? []
const entriesFor = (type: string, id: string) => reviewEntries().filter((e) => e.ref.type === type && e.ref.id === id)
const stored = () => getRaw<KnowledgeState>('knowledge') as KnowledgeState
const lastUndo = (): UndoInput => vi.mocked(pushUndo).mock.calls.at(-1)?.[0] as UndoInput
let stopSync: () => void = () => undefined

const proposal = (over: Partial<KnowledgeProposal> = {}): KnowledgeProposal => ({
  id: 'p-1',
  scopeId: 'acme',
  kind: 'fact',
  text: 'Launch is 13 Nov',
  sources: [{ kind: 'chat', label: 'Launch planning' }],
  origin: 'chat',
  conflictsWith: ['k1'],
  createdAt: 2_000,
  sessionId: 'sess-1',
  ...over,
})

const conflict = (over: Partial<KnowledgeConflict> = {}): KnowledgeConflict => ({
  id: 'c-1',
  scopeId: 'acme',
  proposalId: 'p-1',
  itemIds: ['k1'],
  state: 'open',
  createdAt: 2_000,
  ...over,
})

beforeEach(() => {
  resetTestStorage()
  _resetKnowledgeForTests()
  _resetScopesForTests()
  _setScopeReaderForTests(async () => [{ id: 'acme', name: 'Acme' } as never])
  reviewData = {}
  setReviewStorageForTests({
    getItem: async <T>(k: string, fb: T) => (k in reviewData ? (structuredClone(reviewData[k]) as T) : fb),
    setItemNow: (k: string, v: unknown) => {
      reviewData[k] = structuredClone(v)
      return Promise.resolve()
    },
  })
  reviewStore.setState({ entries: [], lastCheckedAt: undefined, loaded: false })
  vi.mocked(pushUndo).mockClear()
  stopSync = startReviewSync()
})

afterEach(() => {
  stopSync()
  setReviewStorageForTests(null)
  vi.restoreAllMocks()
})

/** Old item k1 "Launch is 4 Nov" in acme, and proposal p-1 "Launch is 13 Nov" in open conflict c-1 with it. */
async function seedConflict() {
  const old = await makeItem({ id: 'k1', scopeId: 'acme', text: 'Launch is 4 Nov' })
  await commitKnowledge((d) => {
    d.items.push(old)
    d.proposals.push(proposal())
    d.conflicts.push(conflict())
  })
}

describe('resolveConflict', () => {
  it('keep the new one supersedes the old and re-checks its draft', async () => {
    await seedConflict()
    await recordKnowledgeUse(['k1'], { type: 'draft', id: 'd1', label: 'Reply to Acme' })
    await recordKnowledgeUse(['k1'], { type: 'chat', id: 'chat-1', label: 'Launch chat' })

    await resolveConflict('c-1', { keep: 'p-1' })

    const s = stored()
    const kept = s.items.find((i) => i.id !== 'k1')
    expect(kept).toMatchObject({ text: 'Launch is 13 Nov', status: 'approved', proposalId: 'p-1', scopeId: 'acme' })
    expect(s.items.find((i) => i.id === 'k1')).toMatchObject({ status: 'superseded', supersededBy: kept?.id })
    expect(s.items.find((i) => i.id === 'k1')?.history.at(-1)).toMatchObject({ action: 'superseded', by: 'user' })
    expect(s.proposals).toEqual([])
    expect(s.conflicts[0]).toMatchObject({ state: 'resolved' })
    expect(s.conflicts[0].resolvedAt).toEqual(expect.any(Number))

    const rechecks = reviewEntries().filter((e) => e.kind === 're-check')
    expect(rechecks).toHaveLength(1)
    expect(rechecks[0]).toMatchObject({
      text: 'Reply to Acme',
      sub: 'It used "Launch is 4 Nov", which was replaced.',
      state: 'open',
    })
    expect(entriesFor('conflict', 'c-1').map((e) => e.state)).toEqual(['done'])
    expect(pushUndo).toHaveBeenCalledTimes(1)
    expect(lastUndo()).toMatchObject({ group: 'knowledge', message: 'Kept "Launch is 13 Nov"' })
  })

  it('keep the old one stores the proposal as superseded history', async () => {
    await seedConflict()
    await resolveConflict('c-1', { keep: 'k1' })

    const s = stored()
    expect(s.items.find((i) => i.id === 'k1')).toMatchObject({ status: 'approved', approvedRevisionId: 'r1' })
    const loser = s.items.find((i) => i.id !== 'k1')
    expect(loser).toMatchObject({
      text: 'Launch is 13 Nov',
      status: 'superseded',
      supersededBy: 'k1',
      proposalId: 'p-1',
      approvedRevisionId: 'r1',
      sources: [{ id: 's1', kind: 'chat', label: 'Launch planning' }],
    })
    expect(loser?.revisions).toHaveLength(1)
    expect(loser?.revisions[0].approval).toBeUndefined()
    expect(loser?.revisions[0].by).toBe('chat')
    expect(loser?.history.map((e) => [e.action, e.by])).toEqual([
      ['proposed', 'chat'],
      ['superseded', 'user'],
    ])
    expect(s.proposals).toEqual([])
    expect(s.conflicts[0].state).toBe('resolved')
    expect(reviewEntries().filter((e) => e.kind === 're-check')).toEqual([])
    expect(entriesFor('conflict', 'c-1').map((e) => e.state)).toEqual(['done'])
    expect(lastUndo().message).toBe('Kept "Launch is 4 Nov"')
  })

  it('keep both writes the condition on both', async () => {
    await seedConflict()
    await resolveConflict('c-1', { keepBoth: '  for the EU launch ' })

    const s = stored()
    expect(s.items).toHaveLength(2)
    for (const item of s.items) {
      expect(item.status).toBe('approved')
      expect(item.condition).toBe('for the EU launch')
      const rev = item.revisions.find((r) => r.id === item.approvedRevisionId)
      expect(rev).toMatchObject({ condition: 'for the EU launch', text: item.text })
      expect(rev?.approval?.contentHash).toBe(await contentHash('fact', item.text, 'for the EU launch'))
      expect(item.history.at(-1)).toMatchObject({ action: 'kept-both', by: 'user', note: 'for the EU launch' })
    }
    const old = s.items.find((i) => i.id === 'k1')
    expect(old?.revisions.map((r) => [r.id, r.parentId])).toEqual([
      ['r1', undefined],
      ['r2', 'r1'],
    ])
    expect(s.proposals).toEqual([])
    expect(s.conflicts[0].state).toBe('resolved')
    expect(lastUndo().message).toBe('Kept both, with a condition')
    expect(pushUndo).toHaveBeenCalledTimes(1)
  })

  it('blank condition throws and changes nothing', async () => {
    await seedConflict()
    const before = stored()
    await expect(resolveConflict('c-1', { keepBoth: '   ' })).rejects.toThrow('condition-required')
    expect(stored()).toEqual(before)
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('refuses a missing conflict, a closed one and a choice outside it', async () => {
    await seedConflict()
    await expect(resolveConflict('nope', { keep: 'k1' })).rejects.toThrow('missing')
    await expect(resolveConflict('c-1', { keep: 'k9' })).rejects.toThrow('missing')
    await resolveConflict('c-1', { keep: 'k1' })
    await expect(resolveConflict('c-1', { keep: 'k1' })).rejects.toThrow('missing')
    expect(pushUndo).toHaveBeenCalledTimes(1)
  })

  it('undo of keep this dismisses the re-check and reopens the conflict', async () => {
    await seedConflict()
    await recordKnowledgeUse(['k1'], { type: 'draft', id: 'd1', label: 'Reply to Acme' })
    await resolveConflict('c-1', { keep: 'p-1' })

    await lastUndo().undo()

    const s = stored()
    expect(s.items.map((i) => [i.id, i.status])).toEqual([['k1', 'approved']])
    expect(s.proposals.map((p) => p.id)).toEqual(['p-1'])
    expect(s.conflicts[0].state).toBe('open')
    expect(
      reviewEntries()
        .filter((e) => e.kind === 're-check')
        .map((e) => e.state)
    ).toEqual(['dismissed'])
    expect(entriesFor('conflict', 'c-1').map((e) => e.state)).toEqual(['open'])
    expect(entriesFor('proposal', 'p-1').filter((e) => e.state === 'open')).toEqual([])
  })

  it('uses are capped at 50 per item', async () => {
    await seedConflict()
    let now = 10_000
    vi.spyOn(Date, 'now').mockImplementation(() => now++)
    for (let n = 0; n < 55; n++) {
      await recordKnowledgeUse(['k1'], { type: 'chat', id: `chat-${n}`, label: `Chat ${n}` })
    }
    await recordKnowledgeUse(['k1'], { type: 'chat', id: 'chat-10', label: 'Chat 10' })

    const uses = listKnowledgeUses('k1')
    expect(uses).toHaveLength(50)
    expect(uses[0].ref.id).toBe('chat-10')
    expect(uses.map((u) => u.ref.id)).not.toContain('chat-0')
    expect(new Set(uses.map((u) => u.ref.id)).size).toBe(50)
    expect(uses.every((u, i) => i === 0 || uses[i - 1].at >= u.at)).toBe(true)
    expect(pushUndo).not.toHaveBeenCalled()
  })
})

describe('review sync keeps one entry per proposal', () => {
  async function proposalThenConflict() {
    const old = await makeItem({ id: 'k1', scopeId: 'acme', text: 'Launch is 4 Nov' })
    await commitKnowledge((d) => {
      d.items.push(old)
      d.proposals.push(proposal())
    })
    await commitKnowledge((d) => {
      d.conflicts.push(conflict())
    })
    expect(entriesFor('proposal', 'p-1').map((e) => e.state)).toEqual(['dismissed'])
  }

  it('a commit that deletes the conflict but keeps the proposal reopens its entry', async () => {
    await proposalThenConflict()
    await commitKnowledge((d) => {
      d.conflicts = []
    })
    expect(entriesFor('proposal', 'p-1').map((e) => e.state)).toEqual(['open'])
    expect(entriesFor('conflict', 'c-1').map((e) => e.state)).toEqual(['dismissed'])
  })

  it('a conflict dismissed while its proposal stays reopens the one entry, not a second', async () => {
    await proposalThenConflict()
    await moveProposalsForSession('sess-1', 'other')
    expect(stored().proposals[0].scopeId).toBe('other')
    expect(entriesFor('proposal', 'p-1').map((e) => [e.state, e.scopeId])).toEqual([['open', 'other']])
    expect(entriesFor('conflict', 'c-1').map((e) => e.state)).toEqual(['dismissed'])
  })
})
