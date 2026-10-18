import type { Scope } from '@shared/types'
import { KnowledgeTab } from '@/components/knowledge/KnowledgeTab'

export function ScopeKnowledgeTab({ scope }: { scope: Scope }) {
  return <KnowledgeTab scopeId={scope.id} />
}
