import type { Folder, Project, Scope } from '@shared/types'
import { atomWithStorage } from 'jotai/utils'
import { useMemo } from 'react'
import { folderToProject, projectToFolder } from '@/projects/project-migration'
import { applyFolderUpdate, createScope } from '@/projects/scope-store'
import storage, { StorageKey } from '@/storage'
import { useScopes } from './useScopes'

export const myFoldersAtom = atomWithStorage<Folder[]>(StorageKey.MyFolders, [], storage)
/** Canonical scope list (stored under `myProjects`). Read with `parseScopes`. */
export const myProjectsAtom = atomWithStorage<Scope[]>(StorageKey.MyProjects, [], storage)

/** Compatibility adapter: Folder-shaped view over scopes. */
export function useFolders() {
  const { scopes, addScope, updateScope, removeScope, putScope } = useScopes()
  const folders = useMemo(() => scopes.map(projectToFolder), [scopes])

  const addFolder = (folder: Omit<Folder, 'id' | 'order'> & Partial<Pick<Folder, 'id' | 'order'>>) => {
    const hasExtras =
      folder.id !== undefined ||
      folder.order !== undefined ||
      folder.emoji !== undefined ||
      folder.defaultCopilotId !== undefined ||
      folder.defaultAgentId !== undefined
    if (!hasExtras) {
      return projectToFolder(addScope({ name: folder.name, kind: 'project' }))
    }
    const base = createScope(scopes, {
      name: folder.name,
      kind: 'project',
      id: folder.id,
      defaultAgentId: folder.defaultAgentId ?? folder.defaultCopilotId,
    })
    const scope: Scope = {
      ...base,
      emoji: folder.emoji,
      defaultCopilotId: folder.defaultCopilotId,
      order: folder.order ?? base.order,
    }
    putScope(scope)
    return projectToFolder(scope)
  }

  const updateFolder = (folderId: string, updater: Partial<Folder> | ((folder: Folder) => Folder)) => {
    const scope = scopes.find((item) => item.id === folderId)
    if (!scope) return
    const { id: _id, ...patch } = applyFolderUpdate(scope, updater)
    updateScope(folderId, patch)
  }

  const removeFolder = (folderId: string) => removeScope(folderId)

  return { folders, addFolder, updateFolder, removeFolder }
}

export function toPortableProject(folder: Folder): Project {
  return folderToProject(folder)
}

export function toCompatibilityFolder(project: Project): Folder {
  return projectToFolder(project)
}
