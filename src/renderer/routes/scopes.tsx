import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Page from '@/components/layout/Page'
import { NewScopeSheet } from '@/components/scope'
import SessionList from '@/components/session/SessionList'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { useScopes } from '@/hooks/useScopes'

export const Route = createFileRoute('/scopes')({
  component: ScopesTab,
})

/**
 * The phone Scopes tab (RS3): the sidebar's list as a page — Everywhere, the scopes, then the chats (SessionList
 * already renders all three, R22). Medium and wide have the sidebar, so the page sends them to Review.
 */
function ScopesTab() {
  const { t } = useTranslation()
  const mode = useLayoutMode()
  const navigate = useNavigate()
  const { addScope } = useScopes()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [newScopeOpen, setNewScopeOpen] = useState(false)

  if (mode !== 'phone') return <Navigate to="/" replace />

  return (
    <Page title={t('Scopes')}>
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rail-session-list">
        <SessionList
          sessionListViewportRef={viewportRef}
          showArchived={showArchived}
          onShowArchivedChange={setShowArchived}
          onCreateProject={() => setNewScopeOpen(true)}
          density="mobile"
          scopesOpen
        />
      </div>
      <NewScopeSheet
        opened={newScopeOpen}
        onClose={() => setNewScopeOpen(false)}
        onCreate={(input) => {
          const scope = addScope(input)
          setNewScopeOpen(false)
          void navigate({ to: '/scope/$scopeId', params: { scopeId: scope.id }, search: { tab: 'overview' } })
        }}
      />
    </Page>
  )
}
