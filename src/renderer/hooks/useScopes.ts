import type { Scope, ScopeKind } from '@shared/types'
import { useAtom, useSetAtom } from 'jotai'
import { useMemo } from 'react'
import { projectToFolder } from '@/projects/project-migration'
import { createScope, parseScopes, patchScope } from '@/projects/scope-store'
import { myFoldersAtom, myProjectsAtom } from './useFolders'

export function useScopes() {
  const [raw, setProjects] = useAtom(myProjectsAtom)
  const setFolders = useSetAtom(myFoldersAtom)
  const scopes = useMemo(() => parseScopes(raw), [raw])

  const commit = (next: Scope[]) => {
    setProjects(next)
    setFolders(next.map(projectToFolder))
  }

  const getScope = (id?: string) => (id ? scopes.find((scope) => scope.id === id) : undefined)

  const addScope = (input: { name: string; kind: ScopeKind }): Scope => {
    const scope = createScope(scopes, input)
    commit([...scopes, scope])
    return scope
  }

  const updateScope = (id: string, patch: Partial<Omit<Scope, 'id'>>) => {
    commit(patchScope(scopes, id, patch))
  }

  const removeScope = (id: string) => {
    commit(scopes.filter((scope) => scope.id !== id))
  }

  const putScope = (scope: Scope) => {
    const exists = scopes.some((item) => item.id === scope.id)
    commit(exists ? scopes.map((item) => (item.id === scope.id ? scope : item)) : [...scopes, scope])
  }

  return { scopes, getScope, addScope, updateScope, removeScope, putScope }
}
