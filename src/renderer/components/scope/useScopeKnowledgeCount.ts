import { useKnowledgeList } from '@/packages/knowledge/hooks'

/** Approved knowledge items in a scope, kept current. */
export function useScopeKnowledgeCount(scopeId: string): number {
  return useKnowledgeList(scopeId).length
}
