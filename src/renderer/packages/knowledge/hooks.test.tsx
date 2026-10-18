/**
 * @vitest-environment jsdom
 */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useKnowledgeList, useKnowledgeUses, useProposalsForMessage } from './hooks'
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
})
