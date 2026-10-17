import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useMemo } from 'react'
import { z } from 'zod'
import { ScopePageView } from '@/components/scope/ScopePage'
import { useScopeKnowledgeCount } from '@/components/scope/useScopeKnowledgeCount'
import { groupSessionsByScope } from '@/components/session/session-list-helpers'
import { useScopes } from '@/hooks/useScopes'
import { startNewChat } from '@/lib/startNewChat'
import { useSessionList } from '@/stores/chatStore'

const SCOPE_TABS = ['overview', 'knowledge', 'sources', 'files', 'chats', 'settings'] as const

export const Route = createFileRoute('/scope/$scopeId')({
  component: ScopeRoute,
  validateSearch: zodValidator(z.object({ tab: z.enum(SCOPE_TABS).catch('overview') })),
})

function ScopeRoute() {
  const { scopeId } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = useNavigate()
  const { scopes, getScope } = useScopes()
  const { sessionMetaList } = useSessionList()
  const scope = getScope(scopeId)
  const knowledgeCount = useScopeKnowledgeCount(scopeId)
  const chats = useMemo(() => {
    const { groups } = groupSessionsByScope(scopes, sessionMetaList ?? [])
    return groups.find((group) => group.scope.id === scopeId)?.sessions ?? []
  }, [scopes, sessionMetaList, scopeId])

  return (
    <ScopePageView
      scope={scope}
      chats={chats}
      knowledgeCount={knowledgeCount}
      tab={tab}
      folderBound={false}
      settings={null}
      files={null}
      onTabChange={(next) => void navigate({ to: '/scope/$scopeId', params: { scopeId }, search: { tab: next } })}
      onNewChat={() => startNewChat({ scopeId })}
      onOpenChat={(id) => void navigate({ to: '/session/$sessionId', params: { sessionId: id } })}
    />
  )
}
