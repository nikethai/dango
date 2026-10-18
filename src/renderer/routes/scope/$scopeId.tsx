import { EVERYWHERE_SCOPE_ID } from '@shared/types'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { EverywherePage } from '@/components/scope/EverywherePage'
import { ScopeFilesTab, shouldShowFilesTab } from '@/components/scope/ScopeFilesTab'
import { ScopePageView } from '@/components/scope/ScopePage'
import { NO_AGENT_VALUE, ScopeSettingsTab } from '@/components/scope/ScopeSettingsTab'
import { useScopeKnowledgeCount } from '@/components/scope/useScopeKnowledgeCount'
import { groupSessionsByScope } from '@/components/session/session-list-helpers'
import { useMyCopilots, useRemoteCopilots } from '@/hooks/useCopilots'
import { useProjectWorkspace } from '@/hooks/useProjectWorkspace'
import { useScopes } from '@/hooks/useScopes'
import { startNewChat } from '@/lib/startNewChat'
import { platformCapabilities } from '@/platform'
import { deleteScopeOrToast } from '@/projects/scope-feedback'
import { useSessionList } from '@/stores/chatStore'

const SCOPE_TABS = ['overview', 'knowledge', 'sources', 'files', 'chats', 'settings'] as const

export const Route = createFileRoute('/scope/$scopeId')({
  component: ScopeRoute,
  validateSearch: zodValidator(z.object({ tab: z.enum(SCOPE_TABS).catch('overview') })),
})

function ScopeRoute() {
  const { scopeId } = Route.useParams()
  if (scopeId === EVERYWHERE_SCOPE_ID) return <EverywherePage />
  // key: remount per scope so one scope's workspace descriptor never shows under another.
  return <ScopeContent key={scopeId} scopeId={scopeId} />
}

function ScopeContent({ scopeId }: { scopeId: string }) {
  const { tab } = Route.useSearch()
  const navigate = useNavigate()
  const { t } = useTranslation()
  const { scopes, getScope, updateScope, removeScope, putScope } = useScopes()
  const { copilots: myCopilots } = useMyCopilots()
  const { copilots: remoteCopilots } = useRemoteCopilots()
  const { sessionMetaList } = useSessionList()
  const scope = getScope(scopeId)
  const knowledgeCount = useScopeKnowledgeCount(scopeId)
  const { descriptor, setDescriptor } = useProjectWorkspace({ projectId: scopeId })
  const filesVisible = shouldShowFilesTab(descriptor, platformCapabilities.supportsProjectWorkspace)
  const chats = useMemo(() => {
    const { groups } = groupSessionsByScope(scopes, sessionMetaList ?? [])
    return groups.find((group) => group.scope.id === scopeId)?.sessions ?? []
  }, [scopes, sessionMetaList, scopeId])

  const agentOptions = useMemo(() => {
    const seen = new Set<string>()
    const options = [{ value: NO_AGENT_VALUE, label: t('None') }]
    for (const copilot of [...myCopilots, ...remoteCopilots]) {
      if (seen.has(copilot.id)) continue
      seen.add(copilot.id)
      options.push({ value: copilot.id, label: copilot.name })
    }
    return options
  }, [myCopilots, remoteCopilots, t])

  return (
    <ScopePageView
      scope={scope}
      chats={chats}
      knowledgeCount={knowledgeCount}
      tab={tab}
      folderBound={filesVisible}
      settings={
        scope ? (
          <ScopeSettingsTab
            scope={scope}
            agentOptions={agentOptions}
            onChange={(patch) => updateScope(scope.id, patch)}
            onDelete={() => {
              void deleteScopeOrToast(scope, sessionMetaList ?? [], { removeScope, putScope }).then((deleted) => {
                if (deleted) startNewChat({})
              })
            }}
          />
        ) : null
      }
      files={
        filesVisible && descriptor ? (
          <ScopeFilesTab scopeId={scopeId} descriptor={descriptor} onDescriptorChange={setDescriptor} />
        ) : null
      }
      onTabChange={(next) => void navigate({ to: '/scope/$scopeId', params: { scopeId }, search: { tab: next } })}
      onNewChat={() => startNewChat({ scopeId })}
      onOpenChat={(id) => void navigate({ to: '/session/$sessionId', params: { sessionId: id } })}
    />
  )
}
