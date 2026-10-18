import type { KnowledgeProposal, KnowledgeState } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addReviewEntry, setReviewEntryState } from '@/packages/review'
import { pushUndo, type UndoInput } from '@/packages/undo'
import { addKnowledge, approveProposal, KnowledgeConflictError } from './approve'
import { setContradictionCheckerForTests } from './contradictions'
import { proposeKnowledge } from './proposals'
import { startReviewSync } from './review-sync'
import { _resetScopesForTests, _setScopeReaderForTests } from './scopes'
import { _resetKnowledgeForTests, commitKnowledge } from './store'
import { getRaw, makeItem, resetTestStorage, testStorage } from './test-storage'
import { contentHash } from './text'

vi.mock('@/storage', async () => (await import('./test-storage')).default)
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, string>) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => vars?.[k] ?? ''),
}))
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn(() => 'undo-1') }))
vi.mock('@/packages/review', () => ({
  addReviewEntry: vi.fn(async () => undefined),
  setReviewEntryState: vi.fn(async () => undefined),
}))

type ProposeInput = Parameters<typeof proposeKnowledge>[0]
const input = (over: Partial<ProposeInput> = {}): ProposeInput => ({
  scopeId: 'acme',
  kind: 'fact',
  text: 'Launch is 13 Nov',
  sources: [{ kind: 'chat', label: 'Launch planning' }],
  origin: 'chat',
  ...over,
})

const checker = vi.fn(async (_: { text: string }): Promise<string[]> => [])
const lastUndo = (): UndoInput => vi.mocked(pushUndo).mock.calls.at(-1)?.[0] as UndoInput
const stored = () => getRaw<KnowledgeState>('knowledge') as KnowledgeState
let stopSync: () => void = () => undefined

beforeEach(() => {
  vi.useRealTimers()
  resetTestStorage()
  _resetKnowledgeForTests()
  _resetScopesForTests()
  _setScopeReaderForTests(async () => [{ id: 'acme', name: 'Acme' } as never])
  checker.mockReset()
  checker.mockResolvedValue([])
  setContradictionCheckerForTests(checker)
  vi.mocked(pushUndo).mockClear()
  vi.mocked(addReviewEntry).mockClear()
  vi.mocked(setReviewEntryState).mockClear()
  stopSync = startReviewSync()
})

afterEach(() => {
  stopSync()
  setContradictionCheckerForTests(null)
})

async function propose(over: Partial<ProposeInput> = {}): Promise<KnowledgeProposal> {
  return (await proposeKnowledge(input(over))) as KnowledgeProposal
}

async function seedAcmeItem() {
  const item = await makeItem({ id: 'a1', scopeId: 'acme', text: 'Launch is 6 Nov' })
  await commitKnowledge((d) => {
    d.items.push(item)
  })
}

describe('approveProposal', () => {
  it('approve saves with source and history', async () => {
    const p = await propose()
    const item = await approveProposal(p.id)

    expect(item).toMatchObject({
      scopeId: 'acme',
      kind: 'fact',
      text: 'Launch is 13 Nov',
      status: 'approved',
      proposalId: p.id,
      sources: [{ id: 's1', kind: 'chat', label: 'Launch planning' }],
      approvedRevisionId: 'r1',
    })
    expect(item.history.map((e) => [e.action, e.by])).toEqual([
      ['proposed', 'chat'],
      ['approved', 'user'],
    ])
    expect(item.history[0].note).toBeUndefined()
    expect(item.revisions).toHaveLength(1)
    expect(item.revisions[0]).toMatchObject({ id: 'r1', text: 'Launch is 13 Nov', by: 'chat' })
    expect(stored().items).toEqual([item])
    expect(stored().proposals).toEqual([])
    expect(lastUndo().message).toBe('Approved "Launch is 13 Nov" for Acme')
    expect(setReviewEntryState).toHaveBeenLastCalledWith({ ref: { type: 'proposal', id: p.id } }, 'done')
  })

  it('maps background-review origin to its history actor', async () => {
    const p = await propose({ origin: 'background-review' })
    const item = await approveProposal(p.id)
    expect(item.history[0].by).toBe('background-review')
    expect(item.revisions[0].by).toBe('background-review')
  })

  it("edited text is saved, original kept in the proposed event's note", async () => {
    const p = await propose()
    const item = await approveProposal(p.id, { text: 'Launch is 14 Nov' })

    expect(item.text).toBe('Launch is 14 Nov')
    expect(item.history[0]).toMatchObject({ action: 'proposed', by: 'chat', note: 'Launch is 13 Nov' })
    expect(item.revisions.map((r) => [r.id, r.text, r.by, r.parentId])).toEqual([
      ['r1', 'Launch is 13 Nov', 'chat', undefined],
      ['r2', 'Launch is 14 Nov', 'user', 'r1'],
    ])
    expect(item.approvedRevisionId).toBe('r2')
  })

  it('preference approved for acme lands in Everywhere', async () => {
    // Seeded directly in acme, so the approve itself does the mapping (ADR 0013).
    const p: KnowledgeProposal = {
      id: 'p-pref',
      scopeId: 'acme',
      kind: 'preference',
      text: 'Keep answers short',
      sources: [{ kind: 'chat', label: 'Launch planning' }],
      origin: 'chat',
      createdAt: 1,
    }
    await commitKnowledge((d) => {
      d.proposals.push(p)
    })
    const item = await approveProposal(p.id)
    expect(item.scopeId).toBe(EVERYWHERE_SCOPE_ID)
    expect(stored().items.map((i) => [i.id, i.scopeId])).toEqual([[item.id, EVERYWHERE_SCOPE_ID]])
    expect(stored().proposals).toEqual([])
    expect(lastUndo().message).toBe('Approved "Keep answers short" for Everywhere')
  })

  it('a second approve of the same proposal throws missing and saves one item', async () => {
    const p = await propose()
    const [first, second] = await Promise.allSettled([approveProposal(p.id), approveProposal(p.id)])
    expect(first.status).toBe('fulfilled')
    expect(second).toMatchObject({ status: 'rejected', reason: new Error('missing') })
    expect(stored().items).toHaveLength(1)
    expect(vi.mocked(pushUndo)).toHaveBeenCalledTimes(1)
    await expect(approveProposal(p.id)).rejects.toThrow('missing')
    expect(stored().items).toHaveLength(1)
  })

  it('throws missing for an unknown id', async () => {
    await expect(approveProposal('nope')).rejects.toThrow('missing')
  })

  it('approve of a conflicted proposal throws KnowledgeConflictError', async () => {
    await seedAcmeItem()
    checker.mockResolvedValue(['a1'])
    const p = await propose()
    checker.mockClear()

    const error = await approveProposal(p.id).catch((e) => e)
    expect(error).toBeInstanceOf(KnowledgeConflictError)
    expect(error.oldText).toBe('Launch is 6 Nov')
    expect(error.conflict).toMatchObject({ proposalId: p.id, itemIds: ['a1'], state: 'open' })
    expect(checker).not.toHaveBeenCalled()
    expect(stored().items.map((i) => i.id)).toEqual(['a1'])
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('edited text that contradicts creates a conflict and throws', async () => {
    await seedAcmeItem()
    const p = await propose({ text: 'Launch is 6 Nov in Berlin' })
    checker.mockResolvedValue(['a1'])

    const error = await approveProposal(p.id, { text: 'Launch is 9 Nov' }).catch((e) => e)
    expect(error).toBeInstanceOf(KnowledgeConflictError)
    expect(error.oldText).toBe('Launch is 6 Nov')
    const s = stored()
    expect(s.proposals).toHaveLength(1)
    expect(s.proposals[0]).toMatchObject({ id: p.id, text: 'Launch is 9 Nov', conflictsWith: ['a1'] })
    expect(s.conflicts).toEqual([expect.objectContaining({ proposalId: p.id, itemIds: ['a1'], state: 'open' })])
    expect(s.items.map((i) => i.id)).toEqual(['a1'])
    expect(pushUndo).not.toHaveBeenCalled()
    expect(addReviewEntry).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: 'conflict', text: 'Launch is 9 Nov' })
    )
  })

  it('approve without a model saves', async () => {
    await seedAcmeItem()
    checker.mockRejectedValue(new Error('No model configured'))
    const p = await propose()
    expect(p.checkedAt).toBeUndefined()

    const item = await approveProposal(p.id)
    expect(checker).toHaveBeenCalledTimes(2)
    expect(item.status).toBe('approved')
    expect(stored().conflicts).toEqual([])
    expect(stored().proposals).toEqual([])
  })

  it('no re-check when nothing changed', async () => {
    await seedAcmeItem()
    const p = await propose()
    expect(p.checkedAt).toBeDefined()
    checker.mockClear()

    await approveProposal(p.id)
    expect(checker).not.toHaveBeenCalled()
  })

  it('re-checks when an item in the scope changed after the check', async () => {
    await seedAcmeItem()
    const p = await propose()
    checker.mockClear()
    await commitKnowledge((d) => {
      d.items[0].updatedAt = (p.checkedAt ?? 0) + 1
    })

    await approveProposal(p.id)
    expect(checker).toHaveBeenCalledTimes(1)
  })

  it('approve pushes the knowledge undo and undo brings the proposal back', async () => {
    const p = await propose()
    await approveProposal(p.id)
    const undo = lastUndo()
    expect(undo.group).toBe('knowledge')

    vi.mocked(setReviewEntryState).mockClear()
    await undo.undo()
    expect(stored().items).toEqual([])
    expect(stored().proposals.map((x) => x.id)).toEqual([p.id])
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'proposal', id: p.id } }, 'open')
  })

  it('approval is bound to the content', async () => {
    const p = await propose()
    const item = await approveProposal(p.id)
    expect(item.revisions[0].approval).toMatchObject({
      by: 'user',
      contentHash: await contentHash('fact', 'Launch is 13 Nov'),
    })

    const q = await propose({ text: 'Beta opens 1 Dec' })
    const edited = await approveProposal(q.id, { text: 'Beta opens 2 Dec' })
    expect(edited.revisions).toHaveLength(2)
    expect(edited.revisions[0].approval).toBeUndefined()
    expect(edited.revisions[1].approval?.contentHash).toBe(await contentHash('fact', 'Beta opens 2 Dec'))
  })
})

describe('addKnowledge', () => {
  it('addKnowledge saves as the user', async () => {
    const item = await addKnowledge({ scopeId: 'acme', kind: 'decision', text: 'We ship on Tuesdays' })
    expect(item).toMatchObject({
      scopeId: 'acme',
      kind: 'decision',
      text: 'We ship on Tuesdays',
      sources: [{ kind: 'user', label: 'You', id: 's1' }],
    })
    expect(item.history.map((e) => [e.action, e.by])).toEqual([
      ['proposed', 'user'],
      ['approved', 'user'],
    ])
    expect(item.revisions[0].by).toBe('user')
    expect(stored().proposals).toEqual([])
    expect(vi.mocked(pushUndo)).toHaveBeenCalledTimes(1)
    expect(lastUndo().message).toBe('Added "We ship on Tuesdays" to Acme')
  })

  it('undo of add leaves no item and no open proposal', async () => {
    const item = await addKnowledge({ scopeId: 'acme', kind: 'fact', text: 'Launch is 13 Nov' })
    vi.mocked(setReviewEntryState).mockClear()
    await lastUndo().undo()

    expect(stored().items).toEqual([])
    expect(stored().proposals).toEqual([])
    expect(setReviewEntryState).toHaveBeenLastCalledWith(
      { ref: { type: 'proposal', id: item.proposalId } },
      'dismissed'
    )
  })

  it('undo of add is one commit', async () => {
    await addKnowledge({ scopeId: 'acme', kind: 'fact', text: 'Launch is 13 Nov' })
    testStorage.setItemNow.mockClear()
    await lastUndo().undo()
    expect(testStorage.setItemNow.mock.calls.filter(([k]) => k === 'knowledge')).toHaveLength(1)
    expect(stored().items).toEqual([])
    expect(stored().proposals).toEqual([])
  })

  it('a failed undo of add leaves the item in place', async () => {
    const item = await addKnowledge({ scopeId: 'acme', kind: 'fact', text: 'Launch is 13 Nov' })
    testStorage.setItemNow.mockRejectedValueOnce(new Error('disk full'))
    await expect(lastUndo().undo()).rejects.toThrow('disk full')
    expect(stored().items.map((i) => i.id)).toEqual([item.id])
    expect(stored().proposals).toEqual([])
  })

  it('blank text throws empty', async () => {
    await expect(addKnowledge({ scopeId: 'acme', kind: 'fact', text: '   ' })).rejects.toThrow('empty')
    expect(vi.mocked(pushUndo)).not.toHaveBeenCalled()
  })

  it('a known text throws duplicate', async () => {
    await addKnowledge({ scopeId: 'acme', kind: 'fact', text: 'Launch is 13 Nov' })
    await expect(addKnowledge({ scopeId: 'acme', kind: 'fact', text: 'launch is 13 nov.' })).rejects.toThrow(
      'duplicate'
    )
    await propose({ text: 'Beta opens 1 Dec' })
    await expect(addKnowledge({ scopeId: 'acme', kind: 'fact', text: 'Beta opens 1 Dec' })).rejects.toThrow('duplicate')
  })

  it('a user add skips the Don’t suggest list', async () => {
    await commitKnowledge((d) => {
      d.dontSuggest.push({
        id: 'd1',
        scopeId: 'acme',
        text: 'Launch is 13 Nov',
        textKey: 'launch is 13 nov',
        addedAt: 1,
      })
    })
    const item = await addKnowledge({ scopeId: 'acme', kind: 'fact', text: 'Launch is 13 Nov' })
    expect(item.status).toBe('approved')
  })

  it('a contradicting add throws KnowledgeConflictError and leaves the conflict in Review', async () => {
    await seedAcmeItem()
    checker.mockResolvedValue(['a1'])
    const error = await addKnowledge({ scopeId: 'acme', kind: 'fact', text: 'Launch is 9 Nov' }).catch((e) => e)
    expect(error).toBeInstanceOf(KnowledgeConflictError)
    expect(error.oldText).toBe('Launch is 6 Nov')
    expect(stored().conflicts).toHaveLength(1)
    expect(stored().proposals).toHaveLength(1)
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('an add without a model saves with one check', async () => {
    await seedAcmeItem()
    checker.mockRejectedValue(new Error('offline'))
    const item = await addKnowledge({ scopeId: 'acme', kind: 'fact', text: 'Launch is 9 Nov' })
    expect(item.status).toBe('approved')
    expect(checker).toHaveBeenCalledTimes(1)
  })
})
