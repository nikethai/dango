/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useDontSuggestList,
  useKnowledgeList,
  useKnowledgeUses,
  useProposalConflictText,
  useProposalsForMessage,
} from './hooks'
import { _resetKnowledgeForTests, commitKnowledge } from './store'
import { makeItem, resetTestStorage } from './test-storage'

vi.mock('@/storage', async () => (await import('./test-storage')).default)
vi.mock('./scopes', () => ({ refreshScopes: async () => undefined }))

beforeEach(() => {
  resetTestStorage()
  _resetKnowledgeForTests()
})
afterEach(cleanup)

describe('knowledge hooks', () => {
  it('useKnowledgeList follows commits and keeps its array between unrelated renders', async () => {
    const { result, rerender } = renderHook(() => useKnowledgeList('acme', { query: 'launch' }))
    expect(result.current).toEqual([])
    const item = await makeItem({ id: 'k1', scopeId: 'acme', text: 'Launch is 6 Nov' })
    await act(async () => {
      await commitKnowledge((d) => {
        d.items.push(item)
      })
    })
    await waitFor(() => expect(result.current.map((i) => i.id)).toEqual(['k1']))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('useProposalsForMessage and useKnowledgeUses select by id', async () => {
    const item = await makeItem({ id: 'k1', scopeId: 'acme' })
    await commitKnowledge((d) => {
      d.items.push(item)
      d.proposals.push({
        id: 'p-1',
        scopeId: 'acme',
        kind: 'fact',
        text: 'Budget is 10k',
        sources: [],
        origin: 'chat',
        createdAt: 1,
        messageId: 'm1',
      })
      d.uses.push({ itemId: 'k1', scopeId: 'acme', ref: { type: 'chat', id: 'c1', label: 'Chat' }, at: 5 })
    })
    const proposals = renderHook(() => useProposalsForMessage('m1'))
    const uses = renderHook(() => useKnowledgeUses('k1'))
    expect(proposals.result.current.map((p) => p.id)).toEqual(['p-1'])
    expect(uses.result.current.map((u) => u.ref.id)).toEqual(['c1'])
  })

  it('useProposalConflictText gives the first item an open conflict names, and nothing otherwise', async () => {
    const old = await makeItem({ id: 'k1', scopeId: 'acme', text: 'Launch is 4 Nov' })
    await commitKnowledge((d) => {
      d.items.push(old)
      d.conflicts.push(
        { id: 'c1', scopeId: 'acme', proposalId: 'p-1', itemIds: ['k1'], state: 'open', createdAt: 1 },
        { id: 'c2', scopeId: 'acme', proposalId: 'p-2', itemIds: ['k1'], state: 'resolved', createdAt: 1 }
      )
    })
    expect(renderHook(() => useProposalConflictText('p-1')).result.current).toBe('Launch is 4 Nov')
    expect(renderHook(() => useProposalConflictText('p-2')).result.current).toBeUndefined()
    expect(renderHook(() => useProposalConflictText('p-3')).result.current).toBeUndefined()

    const hook = renderHook(() => useProposalConflictText('p-1'))
    await act(async () => {
      await commitKnowledge((d) => {
        const c = d.conflicts.find((x) => x.id === 'c1')
        if (c) c.state = 'dismissed'
      })
    })
    await waitFor(() => expect(hook.result.current).toBeUndefined())
  })

  it('useDontSuggestList is newest first and follows commits', async () => {
    const { result } = renderHook(() => useDontSuggestList())
    expect(result.current).toEqual([])
    await act(async () => {
      await commitKnowledge((d) => {
        d.dontSuggest.push(
          { id: 'a', scopeId: 'acme', text: 'A', textKey: 'a', addedAt: 1 },
          { id: 'b', scopeId: 'acme', text: 'B', textKey: 'b', addedAt: 2 }
        )
      })
    })
    await waitFor(() => expect(result.current.map((e) => e.id)).toEqual(['b', 'a']))
  })
})
