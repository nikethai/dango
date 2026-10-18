import { ActionIcon, Tooltip } from '@mantine/core'
import type { WorkspaceDescriptor, WorkspaceListEntry } from '@shared/types/workspace'
import { IconRefresh } from '@tabler/icons-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import platform, { platformCapabilities } from '@/platform'
import type { ResolvedProjectContext } from '@/projects/project-context'
import { canAttachContext } from '@/projects/project-context-draft'
import * as toastActions from '@/stores/toastActions'
import { uiStore, useUIStore } from '@/stores/uiStore'
import { getStagedChangeSetId, subscribeStagedChangeSets } from '@/packages/model-calls/toolsets/file'
import { ProjectChangeReview } from './ProjectChangeReview'
import { ProjectExportDialog } from './ProjectExportDialog'
import { ExplorerFileRow, ProjectExplorerTree } from './ProjectExplorerTree'
import { QuickRunPanel } from './QuickRunPanel'
import { SourceControlView } from './SourceControlView'

function folderLabel(displayPath?: string) {
  if (!displayPath) return ''
  const parts = displayPath.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || displayPath
}

export function ProjectContextPanel({
  sessionId,
  projectId,
  descriptor,
  resolved,
  onDescriptorChange,
}: {
  sessionId: string
  projectId?: string
  descriptor?: WorkspaceDescriptor | null
  resolved: ResolvedProjectContext
  onDescriptorChange: (descriptor: WorkspaceDescriptor | null) => void
}) {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<WorkspaceListEntry[]>([])
  const [childrenByDir, setChildrenByDir] = useState<Record<string, WorkspaceListEntry[]>>({})
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<Array<{ relativePath: string }>>([])
  const [tab, setTab] = useState<'files' | 'scm' | 'review' | 'run'>('files')
  const [exportOpen, setExportOpen] = useState(false)
  const [changeSetId, setChangeSetId] = useState(() => getStagedChangeSetId(sessionId) || '')
  const attached = useUIStore((s) => s.projectContextDrafts[sessionId])
  const attachedPaths = useMemo(() => new Set((attached ?? []).map((e) => e.relativePath)), [attached])

  const ready = descriptor?.status === 'ready' && Boolean(descriptor.capabilityId)

  useEffect(() => {
    const sync = () => setChangeSetId(getStagedChangeSetId(sessionId) || '')
    sync()
    return subscribeStagedChangeSets(sync)
  }, [sessionId])

  const loadRoot = useCallback(async () => {
    if (!descriptor?.capabilityId || !platform.listWorkspaceChildren) {
      setEntries([])
      return
    }
    const result = await platform.listWorkspaceChildren(descriptor.capabilityId, '')
    setEntries(result.entries)
    setChildrenByDir({})
    setOpenDirs({})
    setHits([])
  }, [descriptor?.capabilityId])

  useEffect(() => {
    void loadRoot()
  }, [loadRoot])

  if (!platformCapabilities.supportsProjectWorkspace || !projectId) {
    return null
  }

  const openFolder = async () => {
    try {
      const next = await platform.pickAndBindProject?.(projectId)
      if (next) onDescriptorChange(next)
    } catch {
      toastActions.add(t('Could not open folder'))
    }
  }

  const relink = async () => {
    try {
      const next = await platform.relinkProject?.(projectId)
      if (next) onDescriptorChange(next)
    } catch {
      toastActions.add(t('Could not open folder'))
    }
  }

  const attach = async (relativePath: string) => {
    if (!descriptor?.capabilityId || !platform.readWorkspaceFile) return
    try {
      const file = await platform.readWorkspaceFile(descriptor.capabilityId, relativePath)
      const current = uiStore.getState().projectContextDrafts[sessionId] || []
      const next = canAttachContext(current, {
        projectId: descriptor.projectId,
        rootGeneration: descriptor.rootGeneration,
        relativePath,
        revision: file.revision,
        excerpt: file.content.slice(0, 32_000),
        byteLength: file.size,
      })
      if (!next.ok) {
        toastActions.add(
          next.reason === 'count'
            ? t('Too many context files')
            : next.reason === 'bytes'
              ? t('Selected context is too large')
              : t('This file cannot be attached')
        )
        return
      }
      uiStore.getState().setProjectContextDraft(sessionId, next.entries)
    } catch {
      toastActions.add(t('This file cannot be attached'))
    }
  }

  const search = async () => {
    if (!query.trim() || !platform.searchWorkspace || !descriptor?.capabilityId) {
      setHits([])
      return
    }
    const result = await platform.searchWorkspace(descriptor.capabilityId, query.trim())
    setHits(result.hits.map((h) => ({ relativePath: h.relativePath })))
  }

  const toggleDir = async (relativePath: string) => {
    if (openDirs[relativePath]) {
      setOpenDirs((prev) => ({ ...prev, [relativePath]: false }))
      return
    }
    if (!childrenByDir[relativePath] && platform.listWorkspaceChildren && descriptor?.capabilityId) {
      const result = await platform.listWorkspaceChildren(descriptor.capabilityId, relativePath)
      setChildrenByDir((prev) => ({ ...prev, [relativePath]: result.entries }))
    }
    setOpenDirs((prev) => ({ ...prev, [relativePath]: true }))
  }

  const showRelink =
    descriptor?.status === 'relink-required' ||
    descriptor?.status === 'missing' ||
    resolved.kind === 'legacy-reconnect-required'

  const emptyHint =
    resolved.kind === 'legacy-reconnect-required'
      ? t('Reconnect the project folder using Open Folder. Pasted paths cannot authorize access.')
      : descriptor?.status === 'permission-denied'
        ? t('Permission denied')
        : t('You have not yet opened a folder.')

  return (
    <aside aria-label={t('Project Files')} className="project-explorer">
      <header className="project-explorer-header">
        <span className="project-explorer-kicker">{t('Files')}</span>
        {ready ? (
          <Tooltip label={t('Refresh files')}>
            <ActionIcon variant="subtle" size={22} onClick={() => void loadRoot()} aria-label={t('Refresh files')}>
              <IconRefresh size={13} stroke={1.7} />
            </ActionIcon>
          </Tooltip>
        ) : null}
      </header>

      {ready ? (
        <>
          <div className="project-explorer-root" title={descriptor?.displayPath}>
            {folderLabel(descriptor?.displayPath)}
          </div>
          <div className="project-explorer-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === 'files'} onClick={() => setTab('files')}>
              {t('Files')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'scm'} onClick={() => setTab('scm')}>
              {t('Source Control')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'review'} onClick={() => setTab('review')}>
              {t('Change Review')}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'run'} onClick={() => setTab('run')}>
              {t('Quick Local Run')}
            </button>
          </div>
          {tab === 'files' ? (
            <>
              <button type="button" className="project-explorer-open" onClick={() => setExportOpen(true)}>
                {t('Export safe snapshot')}
              </button>
              {exportOpen && descriptor?.capabilityId ? (
                <ProjectExportDialog capabilityId={descriptor.capabilityId} onClose={() => setExportOpen(false)} />
              ) : null}
              <input
                className="project-explorer-filter"
                value={query}
                onChange={(e) => {
                  setQuery(e.currentTarget.value)
                  if (!e.currentTarget.value.trim()) setHits([])
                }}
                placeholder={t('Search files')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    void search()
                  }
                }}
              />
              <div className="project-explorer-tree" role="tree">
                {hits.length > 0 ? (
                  hits.map((hit) => (
                    <ExplorerFileRow
                      key={hit.relativePath}
                      name={hit.relativePath}
                      attached={attachedPaths.has(hit.relativePath)}
                      onClick={() => undefined}
                      onKeyDown={(event) => {
                        if (event.key === ' ' || event.key === 'Enter') {
                          event.preventDefault()
                          void attach(hit.relativePath)
                        }
                      }}
                    />
                  ))
                ) : entries.length === 0 ? (
                  <div className="project-explorer-muted">{t('No files')}</div>
                ) : (
                  <ProjectExplorerTree
                    entries={entries}
                    attachedPaths={attachedPaths}
                    openDirs={openDirs}
                    childrenByDir={childrenByDir}
                    onToggle={toggleDir}
                    onAttach={attach}
                  />
                )}
              </div>
            </>
          ) : null}
          {tab === 'scm' && descriptor?.capabilityId ? <SourceControlView capabilityId={descriptor.capabilityId} /> : null}
          {tab === 'review' ? <ProjectChangeReview changeSetId={changeSetId} /> : null}
          {tab === 'run' ? <QuickRunPanel /> : null}
        </>
      ) : (
        <div className="project-explorer-empty">
          <p className="project-explorer-empty-copy">{emptyHint}</p>
          <button
            type="button"
            className="project-explorer-open"
            onClick={() => void (showRelink ? relink() : openFolder())}
          >
            {showRelink ? t('Relink folder') : t('Open Folder')}
          </button>
        </div>
      )}
    </aside>
  )
}
