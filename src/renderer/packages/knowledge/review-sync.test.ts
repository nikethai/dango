import type { KnowledgeConflict, KnowledgeProposal } from '@shared/types/knowledge'
import type { Scope } from '@shared/types/scope'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addReviewEntry, setReviewEntryState } from '@/packages/review'
import { _resetInitForTests, initKnowledge } from './init'
import { startReviewSync } from './review-sync'
import {
  _resetScopesForTests,
  _setScopeReaderForTests,
  getScopeReads,
  refreshScopes,
  scopeName,
  watchScopes,
} from './scopes'
import { _resetKnowledgeForTests, commitKnowledge } from './store'
import { makeItem, putRaw, resetTestStorage } from './test-storage'

vi.mock('@/storage', async () => (await import('./test-storage')).default)
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, string>) => key.replace(/\{\{(\w+)\}\}/g, (_, k) => vars?.[k] ?? ''),
}))
vi.mock('@/packages/review', () => ({
  addReviewEntry: vi.fn(async () => undefined),
  setReviewEntryState: vi.fn(async () => undefined),
}))

const proposal = (over: Partial<KnowledgeProposal> = {}): KnowledgeProposal => ({
  id: 'p-1',
  scopeId: 'p1',
  kind: 'fact',
  text: 'Launch is 13 Nov',
  sources: [{ kind: 'chat', label: 'Launch planning' }],
  origin: 'chat',
  createdAt: 2_000,
  ...over,
})

const conflict = (over: Partial<KnowledgeConflict> = {}): KnowledgeConflict => ({
  id: 'c-1',
  scopeId: 'p1',
  proposalId: 'p-1',
  itemIds: ['k1'],
  state: 'open',
  createdAt: 2_000,
  ...over,
})

let stop: () => void = () => undefined

beforeEach(() => {
  resetTestStorage()
  _resetKnowledgeForTests()
  _resetScopesForTests()
  vi.mocked(addReviewEntry).mockClear()
  vi.mocked(setReviewEntryState).mockClear()
  stop = startReviewSync()
})

afterEach(() => {
  stop()
  _resetInitForTests()
})

describe('review sync', () => {
  it('new proposal → open proposal entry', async () => {
    await commitKnowledge((d) => {
      d.proposals.push(proposal())
    })
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
    expect(addReviewEntry).toHaveBeenCalledWith({
      kind: 'proposal',
      ref: { type: 'proposal', id: 'p-1' },
      scopeId: 'p1',
      text: 'Launch is 13 Nov',
      source: 'Launch planning',
    })
    expect(setReviewEntryState).not.toHaveBeenCalled()
  })

  it('proposal with an open conflict → conflict entry, proposal entry dismissed', async () => {
    const item = await makeItem({ text: 'Launch is 6 Nov' })
    await commitKnowledge((d) => {
      d.items.push(item)
      d.proposals.push(proposal({ conflictsWith: ['k1'] }))
      d.conflicts.push(conflict())
    })
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
    expect(addReviewEntry).toHaveBeenCalledWith({
      kind: 'conflict',
      ref: { type: 'conflict', id: 'c-1' },
      scopeId: 'p1',
      text: 'Launch is 13 Nov',
      sub: 'Saved: "Launch is 6 Nov"',
    })
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'proposal', id: 'p-1' } }, 'dismissed')
  })

  it('resolved conflict → done', async () => {
    const item = await makeItem({ text: 'Launch is 6 Nov' })
    await commitKnowledge((d) => {
      d.items.push(item)
      d.proposals.push(proposal())
      d.conflicts.push(conflict())
    })
    vi.mocked(addReviewEntry).mockClear()
    vi.mocked(setReviewEntryState).mockClear()
    await commitKnowledge((d) => {
      d.proposals = []
      d.conflicts[0].state = 'resolved'
      d.conflicts[0].resolvedAt = 3_000
    })
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'conflict', id: 'c-1' } }, 'done')
    expect(addReviewEntry).not.toHaveBeenCalled()
  })

  it('approved proposal → done', async () => {
    await commitKnowledge((d) => {
      d.proposals.push(proposal())
    })
    vi.mocked(setReviewEntryState).mockClear()
    const item = await makeItem({ id: 'k2', text: 'Launch is 13 Nov', proposalId: 'p-1' })
    await commitKnowledge((d) => {
      d.proposals = []
      d.items.push(item)
    })
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'proposal', id: 'p-1' } }, 'done')
  })

  it('removed proposal → dismissed', async () => {
    await commitKnowledge((d) => {
      d.proposals.push(proposal())
    })
    vi.mocked(setReviewEntryState).mockClear()
    await commitKnowledge((d) => {
      d.proposals = []
    })
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'proposal', id: 'p-1' } }, 'dismissed')
  })

  it('reverted removal → open', async () => {
    await commitKnowledge((d) => {
      d.proposals.push(proposal())
    })
    const removal = await commitKnowledge((d) => {
      d.proposals = []
    })
    vi.mocked(addReviewEntry).mockClear()
    vi.mocked(setReviewEntryState).mockClear()
    await removal.revert()
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'proposal', id: 'p-1' } }, 'open')
    expect(setReviewEntryState).not.toHaveBeenCalledWith(expect.anything(), 'dismissed')
  })

  it('reverted approve reopens the proposal entry', async () => {
    await commitKnowledge((d) => {
      d.proposals.push(proposal())
    })
    const item = await makeItem({ id: 'k2', text: 'Launch is 13 Nov', proposalId: 'p-1' })
    const approve = await commitKnowledge((d) => {
      d.proposals = []
      d.items.push(item)
    })
    vi.mocked(setReviewEntryState).mockClear()
    await approve.revert()
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'proposal', id: 'p-1' } }, 'open')
  })

  it('conflict deleted by a commit → dismissed', async () => {
    const item = await makeItem({ text: 'Launch is 6 Nov' })
    await commitKnowledge((d) => {
      d.items.push(item)
      d.proposals.push(proposal())
      d.conflicts.push(conflict())
    })
    vi.mocked(setReviewEntryState).mockClear()
    await commitKnowledge((d) => {
      d.conflicts = []
    })
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'conflict', id: 'c-1' } }, 'dismissed')
  })

  it('conflict resolved by keeping the new statement → both entries done', async () => {
    const item = await makeItem({ text: 'Launch is 6 Nov' })
    await commitKnowledge((d) => {
      d.items.push(item)
      d.proposals.push(proposal({ conflictsWith: ['k1'] }))
      d.conflicts.push(conflict())
    })
    vi.mocked(addReviewEntry).mockClear()
    vi.mocked(setReviewEntryState).mockClear()
    // The shape T5's Keep this (new statement) commits: old item superseded, new item from the proposal.
    const kept = await makeItem({ id: 'k2', text: 'Launch is 13 Nov', proposalId: 'p-1' })
    await commitKnowledge((d) => {
      d.items[0].status = 'superseded'
      d.items[0].supersededBy = 'k2'
      d.items.push(kept)
      d.proposals = []
      d.conflicts[0].state = 'resolved'
      d.conflicts[0].resolvedAt = 3_000
    })
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'conflict', id: 'c-1' } }, 'done')
    expect(setReviewEntryState).toHaveBeenCalledWith({ ref: { type: 'proposal', id: 'p-1' } }, 'done')
    expect(setReviewEntryState).toHaveBeenCalledTimes(2)
    expect(addReviewEntry).not.toHaveBeenCalled()
  })

  it('initKnowledge called twice → one listener', async () => {
    stop()
    _resetInitForTests()
    await Promise.all([initKnowledge(), initKnowledge()])
    await initKnowledge()
    await commitKnowledge((d) => {
      d.proposals.push(proposal())
    })
    expect(addReviewEntry).toHaveBeenCalledTimes(1)
  })

  it('stops after unsubscribe', async () => {
    stop()
    await commitKnowledge((d) => {
      d.proposals.push(proposal())
    })
    expect(addReviewEntry).not.toHaveBeenCalled()
  })
})

describe('scopes', () => {
  const scopes = [
    { id: 'p1', name: 'Acme launch', kind: 'project', order: 0 },
    { id: 'c1', name: 'Globex', kind: 'client', order: 1, readsEverywhere: { facts: false, documents: true } },
    { id: 'c2', name: 'Initech', kind: 'client', order: 2 },
  ]

  it('scopeName for everywhere and unknown ids', async () => {
    putRaw('myProjects', scopes)
    await refreshScopes()
    expect(scopeName(EVERYWHERE_SCOPE_ID)).toBe('Everywhere')
    expect(scopeName('p1')).toBe('Acme launch')
    expect(scopeName('nope')).toBe('Unknown scope')
  })

  it('getScopeReads uses readsEverywhereFor for a client scope', async () => {
    putRaw('myProjects', scopes)
    await refreshScopes()
    expect(getScopeReads('c1')).toEqual({ facts: false, documents: true })
    expect(getScopeReads('c2')).toEqual({ facts: true, documents: false })
    expect(getScopeReads('p1')).toEqual({ facts: true, documents: true })
    expect(getScopeReads(EVERYWHERE_SCOPE_ID)).toEqual({ facts: true, documents: true })
  })

  it('an unknown scope gets the client defaults', async () => {
    putRaw('myProjects', scopes)
    await refreshScopes()
    expect(getScopeReads('nope')).toEqual({ facts: true, documents: false })
  })

  it('a slower, older refresh never overwrites a newer one', async () => {
    const release: Array<(v: Scope[]) => void> = []
    _setScopeReaderForTests(() => new Promise((r) => release.push(r)))
    const older = refreshScopes()
    const newer = refreshScopes()
    await vi.waitFor(() => expect(release).toHaveLength(2))
    release[1]([{ id: 'p1', name: 'New', kind: 'project', order: 0 }])
    await newer
    release[0]([{ id: 'p1', name: 'Old', kind: 'project', order: 0 }])
    await older
    expect(scopeName('p1')).toBe('New')
  })

  it('snapshot follows myProjectsAtom', async () => {
    putRaw('myProjects', scopes)
    await refreshScopes()
    // Imported here: `@/hooks/useFolders` reaches `@/storage` at load, before the storage mock is ready.
    const [{ getDefaultStore }, { myProjectsAtom }] = await Promise.all([import('jotai'), import('@/hooks/useFolders')])
    const unwatch = watchScopes()
    getDefaultStore().set(myProjectsAtom, [{ id: 'p1', name: 'Renamed', kind: 'project', order: 0 }] as never)
    await vi.waitFor(() => expect(scopeName('p1')).toBe('Renamed'))
    unwatch()
  })
})
