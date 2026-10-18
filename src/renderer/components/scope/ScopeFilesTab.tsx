import type { WorkspaceDescriptor, WorkspaceListEntry } from '@shared/types/workspace'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ProjectExplorerTree } from '@/components/project/ProjectExplorerTree'
import { SourceControlView } from '@/components/project/SourceControlView'
import platform from '@/platform'
import * as toastActions from '@/stores/toastActions'

const VISIBLE_STATUSES: ReadonlyArray<WorkspaceDescriptor['status']> = [
  'ready',
  'missing',
  'permission-denied',
  'relink-required',
]

export function shouldShowFilesTab(descriptor: WorkspaceDescriptor | null, supportsProjectWorkspace: boolean): boolean {
  if (!descriptor || !supportsProjectWorkspace) return false
  return VISIBLE_STATUSES.includes(descriptor.status)
}

function folderLabel(displayPath: string) {
  const parts = displayPath.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts[parts.length - 1] || displayPath
}

export function ScopeFilesTab(props: {
  scopeId: string
  descriptor: WorkspaceDescriptor
  onDescriptorChange(d: WorkspaceDescriptor | null): void
}) {
  const { scopeId, descriptor, onDescriptorChange } = props
  const { t } = useTranslation()
  const ready = descriptor.status === 'ready' && Boolean(descriptor.capabilityId)
  const [entries, setEntries] = useState<WorkspaceListEntry[]>([])
  const [childrenByDir, setChildrenByDir] = useState<Record<string, WorkspaceListEntry[]>>({})
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({})
  const attachedPaths = useMemo(() => new Set<string>(), [])

  const loadRoot = useCallback(async () => {
    if (!ready || !platform.listWorkspaceChildren) {
      setEntries([])
      return
    }
    try {
      const result = await platform.listWorkspaceChildren(descriptor.capabilityId, '')
      setEntries(result.entries)
      setChildrenByDir({})
      setOpenDirs({})
    } catch {
      setEntries([])
    }
  }, [ready, descriptor.capabilityId])

  useEffect(() => {
    void loadRoot()
  }, [loadRoot])

  const toggleDir = async (relativePath: string) => {
    if (openDirs[relativePath]) {
      setOpenDirs((prev) => ({ ...prev, [relativePath]: false }))
      return
    }
    if (!childrenByDir[relativePath] && platform.listWorkspaceChildren) {
      try {
        const result = await platform.listWorkspaceChildren(descriptor.capabilityId, relativePath)
        setChildrenByDir((prev) => ({ ...prev, [relativePath]: result.entries }))
      } catch {
        return
      }
    }
    setOpenDirs((prev) => ({ ...prev, [relativePath]: true }))
  }

  const relink = async () => {
    try {
      const next = await platform.relinkProject?.(scopeId)
      if (next) onDescriptorChange(next)
    } catch {
      toastActions.add(t('Could not open folder'))
    }
  }

  if (!ready) {
    return (
      <div className="scope-files-tab">
        <div className="scope-files-folder" title={descriptor.displayPath}>
          {folderLabel(descriptor.displayPath)}
        </div>
        <p>{t("Dango can't open this folder.")}</p>
        <button type="button" className="dg-btn" onClick={() => void relink()}>
          {t('Relink folder')}
        </button>
      </div>
    )
  }

  return (
    <div className="scope-files-tab">
      <div className="scope-files-folder" title={descriptor.displayPath}>
        {folderLabel(descriptor.displayPath)}
      </div>
      <SourceControlView capabilityId={descriptor.capabilityId} />
      <ProjectExplorerTree
        entries={entries}
        attachedPaths={attachedPaths}
        openDirs={openDirs}
        childrenByDir={childrenByDir}
        onToggle={toggleDir}
        onAttach={() => {}}
      />
    </div>
  )
}
