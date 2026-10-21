import { ActionIcon } from '@mantine/core'
import { IconInfoCircle, IconSearch } from '@tabler/icons-react'
import { createFileRoute, Navigate, useNavigate } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Page from '@/components/layout/Page'
import { NewScopeSheet } from '@/components/scope'
import SessionList from '@/components/session/SessionList'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { useScopes } from '@/hooks/useScopes'
import useVersion from '@/hooks/useVersion'
import { useUIStore } from '@/stores/uiStore'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'

export const Route = createFileRoute('/scopes')({
  component: ScopesTab,
})

/**
 * The phone Scopes tab (RS3): the sidebar's list as a page — Everywhere, the scopes, then the chats (SessionList
 * already renders all three, R22). Medium and wide have the sidebar, so the page sends them to Review.
 * The header carries what the old phone drawer had besides the list: Search (the ⌘K overlay, mounted in __root) and
 * About (version, updates, source link).
 */
function ScopesTab() {
  const { t } = useTranslation()
  const mode = useLayoutMode()
  const navigate = useNavigate()
  const { addScope } = useScopes()
  const viewportRef = useRef<HTMLDivElement>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [newScopeOpen, setNewScopeOpen] = useState(false)
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const { needCheckUpdate } = useVersion()
  const updateWaiting = CHATBOX_BUILD_PLATFORM === 'android' && needCheckUpdate

  if (mode !== 'phone') return <Navigate to="/" replace />

  return (
    <Page
      title={t('Scopes')}
      // One 44 px control on each side keeps the title centred.
      left={
        <ActionIcon
          variant="subtle"
          color="chatbox-secondary"
          size={44}
          aria-label={t('Search')}
          onClick={() => setOpenSearchDialog(true)}
        >
          <IconSearch size={18} stroke={1.8} aria-hidden />
        </ActionIcon>
      }
      right={
        <ActionIcon
          variant="subtle"
          color="chatbox-secondary"
          size={44}
          aria-label={t('About')}
          className="dg-scopes__about"
          onClick={() => void navigate({ to: '/about' })}
        >
          <IconInfoCircle size={18} stroke={1.8} aria-hidden />
          {updateWaiting && <span className="dg-scopes__update-dot" aria-hidden="true" />}
        </ActionIcon>
      }
    >
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
