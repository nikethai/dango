import type { KnowledgeItem, KnowledgeProposal, KnowledgeUse } from '@shared/types/knowledge'
import { useEffect, useMemo } from 'react'
import { useStore } from 'zustand'
import { getLogger } from '@/lib/utils'
import { type KnowledgeListOptions, selectKnowledge } from './lifecycle'
import { selectProposals } from './proposals'
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
