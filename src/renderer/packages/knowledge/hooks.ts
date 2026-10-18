import type { KnowledgeItem, KnowledgeProposal, KnowledgeUse } from '@shared/types/knowledge'
import { useEffect, useMemo } from 'react'
import { useStore } from 'zustand'
import { getLogger } from '@/lib/utils'
import { selectProposals } from './proposals'
import { type KnowledgeListOptions, selectKnowledge } from './select'
import { ensureKnowledgeLoaded, knowledgeStore } from './store'
import { selectKnowledgeUses } from './uses'

// Each hook selects the whole document (a stable reference until the next commit) and derives its list
// with `useMemo` from the same pure helper the plain functions use (preflight C6). A selector that
// returned a fresh filtered array would re-render forever under zustand 5.

const log = getLogger('knowledge')

function useKnowledgeState() {
  useEffect(() => {
    ensureKnowledgeLoaded().catch((error) => log.error('Knowledge load failed:', error))
  }, [])
  return useStore(knowledgeStore, (s) => s.state)
}

/** `listKnowledge(scopeId, opts)`, kept current. */
export function useKnowledgeList(scopeId: string, opts?: KnowledgeListOptions): KnowledgeItem[] {
  const state = useKnowledgeState()
  // Options arrive as fresh objects each render; key the memo on their values.
  const status = opts?.status?.join(',')
  const kind = opts?.kind?.join(',')
  const query = opts?.query
  return useMemo(
    () =>
      selectKnowledge(state, scopeId, {
        ...(status !== undefined ? { status: status.split(',') as KnowledgeItem['status'][] } : {}),
        ...(kind !== undefined ? { kind: kind.split(',') as KnowledgeItem['kind'][] } : {}),
        ...(query !== undefined ? { query } : {}),
      }),
    [state, scopeId, status, kind, query]
  )
}

/** The open proposals filed from this message, oldest first. */
export function useProposalsForMessage(messageId: string): KnowledgeProposal[] {
  const state = useKnowledgeState()
  return useMemo(() => selectProposals(state, { messageId }), [state, messageId])
}

/** `listKnowledgeUses(itemId)`, kept current. */
export function useKnowledgeUses(itemId: string): KnowledgeUse[] {
  const state = useKnowledgeState()
  return useMemo(() => selectKnowledgeUses(state, itemId), [state, itemId])
}

/** The text of the first item an open conflict on this proposal names, if it has one. */
export function useProposalConflictText(proposalId: string): string | undefined {
  const state = useKnowledgeState()
  return useMemo(() => {
    const conflict = state.conflicts.find((c) => c.proposalId === proposalId && c.state === 'open')
    if (!conflict) return undefined
    return state.items.find((i) => i.id === conflict.itemIds[0])?.text
  }, [state, proposalId])
}

/** One item by id, whatever its status, kept current. */
export function useKnowledgeItem(id: string | undefined): KnowledgeItem | undefined {
  const state = useKnowledgeState()
  return useMemo(() => (id === undefined ? undefined : state.items.find((i) => i.id === id)), [state, id])
}
