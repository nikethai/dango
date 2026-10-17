import type { Scope, ScopeKind } from '@shared/types'
import { useAtomValue, useSetAtom, useStore } from 'jotai'
import { useMemo } from 'react'
import { projectToFolder } from '@/projects/project-migration'
import { createScope, parseScopes, patchScope } from '@/projects/scope-store'
import { myFoldersAtom, myProjectsAtom } from './useFolders'

export function useScopes() {
  const store = useStore()
  const raw = useAtomValue(myProjectsAtom)
  const setProjects = useSetAtom(myProjectsAtom)
  const setFolders = useSetAtom(myFoldersAtom)
  const scopes = useMemo(() => parseScopes(raw), [raw])

  const commit = (next: Scope[]) => {
    setProjects(next)
    setFolders(next.map(projectToFolder))
  }

  // Writes read the live atom value, not the render closure, so two writes in one tick (or an undo
  // that fires seconds after the render that created it) never drop each other's change.
  const current = () => parseScopes(store.get(myProjectsAtom))

  const getScope = (id?: string) => (id ? scopes.find((scope) => scope.id === id) : undefined)

  const addScope = (input: { name: string; kind: ScopeKind }): Scope => {
    const live = current()
    const scope = createScope(live, input)
    commit([...live, scope])
    return scope
  }

  const updateScope = (id: string, patch: Partial<Omit<Scope, 'id'>>) => {
    commit(patchScope(current(), id, patch))
  }

  const removeScope = (id: string) => {
    commit(current().filter((scope) => scope.id !== id))
  }

  const putScope = (scope: Scope) => {
    const live = current()
    const exists = live.some((item) => item.id === scope.id)
    commit(exists ? live.map((item) => (item.id === scope.id ? scope : item)) : [...live, scope])
  }

  return { scopes, getScope, addScope, updateScope, removeScope, putScope }
}
