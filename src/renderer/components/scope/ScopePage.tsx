import type { Scope, SessionMeta } from '@shared/types'
import type { DragEvent, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import Page from '@/components/layout/Page'
import { openAddSourceSheet } from '@/components/sources/AddSourceSheet'
import { startNewChat } from '@/lib/startNewChat'
import { ScopeChatsTab } from './ScopeChatsTab'
import { ScopeKnowledgeTab } from './ScopeKnowledgeTab'
import { ScopeOverview } from './ScopeOverview'
import { ScopeSourcesTab } from './ScopeSourcesTab'

export type ScopeTab = 'overview' | 'knowledge' | 'sources' | 'files' | 'chats' | 'settings'

export type ScopePageViewProps = {
  scope: Scope | undefined
  chats: SessionMeta[]
  knowledgeCount: number
  tab: ScopeTab
  folderBound: boolean
  onTabChange(tab: ScopeTab): void
  onNewChat(): void
  onOpenChat(id: string): void
  settings: ReactNode
  files: ReactNode
}

const carriesFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files')

/** True when the drop holds a directory. Read during the drop event; the entry's path is never used. */
function holdsDirectory(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.items ?? []).some(
    (item) => item.kind === 'file' && item.webkitGetAsEntry?.()?.isDirectory === true
  )
}

export function ScopePageView(props: ScopePageViewProps) {
  const { t } = useTranslation()
  const { scope } = props
  if (!scope) {
    return (
      <Page title="">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 px-4 py-6">
          <p style={{ margin: 0 }}>{t('This scope no longer exists.')}</p>
          <button type="button" className="dg-btn dg-btn--primary" onClick={() => startNewChat({})}>
            {t('Start a new chat')}
          </button>
        </div>
      </Page>
    )
  }
  const tabs: Array<{ id: ScopeTab; label: string }> = [
    { id: 'overview', label: t('Overview') },
    { id: 'knowledge', label: t('Knowledge') },
    { id: 'sources', label: t('Sources') },
    ...(props.folderBound ? [{ id: 'files' as const, label: t('Files') }] : []),
    { id: 'chats', label: t('Chats') },
    { id: 'settings', label: t('Settings') },
  ]
  const tab: ScopeTab = props.tab === 'files' && !props.folderBound ? 'overview' : props.tab
  return (
    <Page title={scope.name}>
      {/* A folder dropped here opens the sheet at Folder; the native picker then chooses the folder, never the dropped
          path (folders bind only through the picker). */}
      <div
        className="mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 py-4"
        onDragOver={(e) => {
          if (carriesFiles(e)) e.preventDefault()
        }}
        onDrop={(e) => {
          if (!carriesFiles(e)) return
          // Keeps the webview from opening a dropped file.
          e.preventDefault()
          if (holdsDirectory(e)) void openAddSourceSheet({ scopeId: scope.id, kind: 'folder' })
        }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <h2 className="dg-type-title-2">{scope.name}</h2>
            {scope.kind === 'client' ? <span className="dg-chip">{t('client')}</span> : null}
          </div>
          <button type="button" className="dg-btn dg-btn--primary" onClick={props.onNewChat}>
            {t('New chat')}
          </button>
        </div>
        <div role="tablist" className="dg-insp__tabs" style={{ padding: 0 }}>
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => props.onTabChange(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div role="tabpanel">
          {tab === 'overview' ? (
            <ScopeOverview
              scope={scope}
              chats={props.chats}
              knowledgeCount={props.knowledgeCount}
              onTabChange={props.onTabChange}
              onNewChat={props.onNewChat}
              onOpenChat={props.onOpenChat}
            />
          ) : null}
          {tab === 'knowledge' ? <ScopeKnowledgeTab scope={scope} /> : null}
          {tab === 'sources' ? <ScopeSourcesTab scope={scope} /> : null}
          {tab === 'files' ? props.files : null}
          {tab === 'chats' ? (
            <ScopeChatsTab
              scope={scope}
              chats={props.chats}
              onNewChat={props.onNewChat}
              onOpenChat={props.onOpenChat}
            />
          ) : null}
          {tab === 'settings' ? props.settings : null}
        </div>
      </div>
    </Page>
  )
}
