import type { KnowledgeProposal, KnowledgeState } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addReviewEntry, setReviewEntryState } from '@/packages/review'
import { pushUndo, type UndoInput } from '@/packages/undo'
import { setContradictionCheckerForTests } from './contradictions'
import {
  allowSuggestAgain,
  DONT_SUGGEST_WINDOW_MS,
  deferProposal,
  dismissProposal,
  getConflict,
  listDontSuggest,
  listProposals,
  moveProposalsForSession,
  proposeKnowledge,
} from './proposals'
import { startReviewSync } from './review-sync'
import { _resetScopesForTests, _setScopeReaderForTests } from './scopes'
import { _resetKnowledgeForTests, commitKnowledge, knowledgeStore } from './store'
import { getRaw, makeItem, resetTestStorage } from './test-storage'

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

const DAY = 24 * 60 * 60 * 1000
const checker = vi.fn(async (_: { text: string }): Promise<string[]> => [])
const lastUndo = (): UndoInput => vi.mocked(pushUndo).mock.calls.at(-1)?.[0] as UndoInput
const stored = () => getRaw<KnowledgeState>('knowledge') as KnowledgeState
let stopSync: () => void = () => undefined

beforeEach(() => {
  vi.useRealTimers()
  resetTestStorage()
  _resetKnowledgeForTests()
  _resetScopesForTests()
  _setScopeReaderForTests(async () => [])
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
  vi.useRealTimers()
})

async function seedItems() {
  const acme = await makeItem({ id: 'a1', scopeId: 'acme', text: 'Launch is 6 Nov' })
  const everywhere = await makeItem({ id: 'e1', scopeId: EVERYWHERE_SCOPE_ID, text: 'Launch reviews are on Fridays' })
  await commitKnowledge((d) => {
    d.items.push(acme, everywhere)
  })
}

describe('proposeKnowledge', () => {
  it('stores a plain proposal with checkedAt and pushes no undo', async () => {
    const p = (await proposeKnowledge(input({ sessionId: 's1', messageId: 'm1' }))) as KnowledgeProposal
    expect(p).toMatchObject({ scopeId: 'acme', text: 'Launch is 13 Nov', sessionId: 's1', messageId: 'm1' })
    expect(p.id).toBeTruthy()
    expect(typeof p.createdAt).toBe('number')
    expect(typeof p.checkedAt).toBe('number')
    expect(p.conflictsWith).toBeUndefined()
    expect(stored().proposals).toEqual([p])
    expect(pushUndo).not.toHaveBeenCalled()
    // Task 2's sync files the Proposal entry.
    expect(addReviewEntry).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'proposal', ref: { type: 'proposal', id: p.id } })
    )
  })

  it('same-scope contradiction stores a conflict', async () => {
    await seedItems()
    checker.mockResolvedValue(['a1'])
    const p = (await proposeKnowledge(input())) as KnowledgeProposal
    expect(p.conflictsWith).toEqual(['a1'])
    const conflicts = stored().conflicts
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({ scopeId: 'acme', proposalId: p.id, itemIds: ['a1'], state: 'open' })
    expect(getConflict(conflicts[0].id)).toEqual(conflicts[0])
    expect(addReviewEntry).toHaveBeenCalledWith(expect.objectContaining({ kind: 'conflict' }))
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it("keeps the input's conflictsWith and adds the found ids", async () => {
    await seedItems()
    checker.mockResolvedValue(['a1'])
    const p = (await proposeKnowledge(input({ conflictsWith: ['x9'] }))) as KnowledgeProposal
    expect(p.conflictsWith).toEqual(['x9', 'a1'])
  })

  it('Everywhere clash is an override, not a conflict', async () => {
    await seedItems()
    checker.mockResolvedValue(['e1'])
    const p = (await proposeKnowledge(input())) as KnowledgeProposal
    expect(p.overrides).toEqual(['e1'])
    expect(p.conflictsWith).toBeUndefined()
    expect(stored().conflicts).toEqual([])
  })

  it('preference targets Everywhere', async () => {
    const p = (await proposeKnowledge(input({ kind: 'preference', text: 'Keep answers short' }))) as KnowledgeProposal
    expect(p.scopeId).toBe(EVERYWHERE_SCOPE_ID)
  })

  it('duplicate of an approved item is dropped', async () => {
    await seedItems()
    expect(await proposeKnowledge(input({ text: 'launch is 6 nov.' }))).toBeNull()
    expect(stored().proposals).toEqual([])
    expect(checker).not.toHaveBeenCalled()
  })

  it('duplicate of an open proposal is dropped', async () => {
    expect(await proposeKnowledge(input())).not.toBeNull()
    expect(await proposeKnowledge(input({ text: ' Launch  is 13 nov! ' }))).toBeNull()
    expect(stored().proposals).toHaveLength(1)
  })

  it('checker failure is no conflict: a plain proposal without checkedAt', async () => {
    await seedItems()
    checker.mockRejectedValue(new Error('offline'))
    const p = (await proposeKnowledge(input())) as KnowledgeProposal
    expect(p).not.toBeNull()
    expect(p.checkedAt).toBeUndefined()
    expect(p.conflictsWith).toBeUndefined()
    expect(stored().conflicts).toEqual([])
  })
})

describe('dismissProposal', () => {
  it('dismiss removes the proposal, records the dismissal, closes its conflict and pushes the undo', async () => {
    await seedItems()
    checker.mockResolvedValue(['a1'])
    const p = (await proposeKnowledge(input())) as KnowledgeProposal
    const result = await dismissProposal(p.id)
    expect(result).toEqual({ offerDontSuggest: false })
    const s = stored()
    expect(s.proposals).toEqual([])
    expect(s.conflicts[0].state).toBe('dismissed')
    expect(s.dismissals).toEqual([{ textKey: 'launch is 13 nov', scopeId: 'acme', at: expect.any(Number) }])
    expect(pushUndo).toHaveBeenCalledTimes(1)
    expect(lastUndo()).toMatchObject({ group: 'knowledge', message: 'Dismissed "Launch is 13 Nov"' })
    expect(lastUndo().extra).toBeUndefined()

    await lastUndo().undo()
    expect(stored().proposals).toHaveLength(1)
    expect(stored().conflicts[0].state).toBe('open')
    expect(stored().dismissals).toEqual([])
  })

  it('second dismiss within 30 days carries the extra, the first does not', async () => {
    const first = (await proposeKnowledge(input())) as KnowledgeProposal
    expect(await dismissProposal(first.id)).toEqual({ offerDontSuggest: false })
    expect(lastUndo().extra).toBeUndefined()

    const second = (await proposeKnowledge(input())) as KnowledgeProposal
    expect(await dismissProposal(second.id)).toEqual({ offerDontSuggest: true })
    expect(lastUndo().extra?.label).toBe("Don't suggest this again")
  })

  it('a dismissal in another scope does not count', async () => {
    const first = (await proposeKnowledge(input({ scopeId: 'other' }))) as KnowledgeProposal
    await dismissProposal(first.id)
    const second = (await proposeKnowledge(input())) as KnowledgeProposal
    expect(await dismissProposal(second.id)).toEqual({ offerDontSuggest: false })
  })

  it('after 31 days it does not', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const first = (await proposeKnowledge(input())) as KnowledgeProposal
    await dismissProposal(first.id)
    vi.setSystemTime(Date.now() + 31 * DAY)
    expect(DONT_SUGGEST_WINDOW_MS).toBe(30 * DAY)
    const second = (await proposeKnowledge(input())) as KnowledgeProposal
    expect(await dismissProposal(second.id)).toEqual({ offerDontSuggest: false })
    expect(lastUndo().extra).toBeUndefined()
  })

  it('undoing a dismiss removes its dismissal, so the next dismiss does not offer it', async () => {
    const first = (await proposeKnowledge(input())) as KnowledgeProposal
    await dismissProposal(first.id)
    await lastUndo().undo()
    expect(stored().dismissals).toEqual([])
    // The undone proposal is back; dismiss it again.
    expect(await dismissProposal(first.id)).toEqual({ offerDontSuggest: false })
  })

  it("don't suggest again blocks that scope, Everywhere entries block every scope, allowSuggestAgain lets it through", async () => {
    const first = (await proposeKnowledge(input())) as KnowledgeProposal
    await dismissProposal(first.id)
    const second = (await proposeKnowledge(input())) as KnowledgeProposal
    await dismissProposal(second.id)
    // The toast's extra; clicking it twice adds one entry.
    lastUndo().extra?.onClick()
    await vi.waitFor(() => expect(listDontSuggest()).toHaveLength(1))
    await dismissProposal(second.id, { dontSuggestAgain: true })
    expect(listDontSuggest()).toEqual([
      {
        id: expect.any(String),
        scopeId: 'acme',
        text: 'Launch is 13 Nov',
        textKey: 'launch is 13 nov',
        addedAt: expect.any(Number),
      },
    ])
    expect(await proposeKnowledge(input())).toBeNull()
    // Another scope is not blocked by an acme entry.
    expect(await proposeKnowledge(input({ scopeId: 'other' }))).not.toBeNull()

    // An Everywhere entry blocks every scope.
    const pref = (await proposeKnowledge(
      input({ kind: 'preference', text: 'Keep answers short' })
    )) as KnowledgeProposal
    await dismissProposal(pref.id, { dontSuggestAgain: true })
    expect(listDontSuggest()).toHaveLength(2)
    expect(await proposeKnowledge(input({ text: 'Keep answers short', scopeId: 'beta' }))).toBeNull()
    expect(await proposeKnowledge(input({ kind: 'preference', text: 'Keep answers short' }))).toBeNull()

    const entry = listDontSuggest().find((e) => e.scopeId === 'acme')
    await allowSuggestAgain(entry?.id as string)
    expect(listDontSuggest()).toHaveLength(1)
    expect(await proposeKnowledge(input())).not.toBeNull()
  })
})

describe('deferProposal and listProposals', () => {
  it('defer keeps it listed with deferred: true', async () => {
    const p = (await proposeKnowledge(input({ messageId: 'm1' }))) as KnowledgeProposal
    vi.mocked(setReviewEntryState).mockClear()
    await deferProposal(p.id)
    expect(listProposals({ scopeId: 'acme' })).toEqual([{ ...p, deferred: true }])
    expect(listProposals({ messageId: 'm1' })).toHaveLength(1)
    expect(listProposals({ messageId: 'm2' })).toEqual([])
    // The Review entry stays open.
    expect(setReviewEntryState).not.toHaveBeenCalled()
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('lists oldest first, filtered by scope', async () => {
    const a = (await proposeKnowledge(input({ text: 'One fact here' }))) as KnowledgeProposal
    await proposeKnowledge(input({ text: 'Other scope fact', scopeId: 'other' }))
    const b = (await proposeKnowledge(input({ text: 'Two fact here' }))) as KnowledgeProposal
    expect(listProposals({ scopeId: 'acme' }).map((p) => p.id)).toEqual([a.id, b.id])
    expect(listProposals()).toHaveLength(3)
  })
})

describe('moveProposalsForSession', () => {
  it("moves only that session's proposals and returns the count", async () => {
    const a = (await proposeKnowledge(input({ text: 'First fact here', sessionId: 's1' }))) as KnowledgeProposal
    const b = (await proposeKnowledge(input({ text: 'Second fact here', sessionId: 's1' }))) as KnowledgeProposal
    const c = (await proposeKnowledge(input({ text: 'Third fact here', sessionId: 's2' }))) as KnowledgeProposal
    const pref = (await proposeKnowledge(
      input({ kind: 'preference', text: 'Keep answers short', sessionId: 's1' })
    )) as KnowledgeProposal
    expect(await moveProposalsForSession('s1', 'beta')).toBe(2)
    const byId = new Map(knowledgeStore.getState().state.proposals.map((p) => [p.id, p]))
    expect(byId.get(a.id)?.scopeId).toBe('beta')
    expect(byId.get(b.id)?.scopeId).toBe('beta')
    expect(byId.get(c.id)?.scopeId).toBe('acme')
    // A preference stays in Everywhere.
    expect(byId.get(pref.id)?.scopeId).toBe(EVERYWHERE_SCOPE_ID)
    expect(await moveProposalsForSession('s1', 'beta')).toBe(0)
  })

  it('a moved proposal drops its old-scope conflict and is checked again on approve', async () => {
    await seedItems()
    checker.mockResolvedValue(['a1'])
    const p = (await proposeKnowledge(input({ sessionId: 's1' }))) as KnowledgeProposal
    expect(await moveProposalsForSession('s1', 'beta')).toBe(1)
    const moved = knowledgeStore.getState().state.proposals[0]
    expect(moved).toMatchObject({ id: p.id, scopeId: 'beta' })
    expect(moved.conflictsWith).toBeUndefined()
    expect(moved.checkedAt).toBeUndefined()
    expect(stored().conflicts[0].state).toBe('dismissed')
  })
})
