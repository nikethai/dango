/**
 * @vitest-environment jsdom
 */

import { act, renderHook } from '@testing-library/react'
import { createStore, Provider } from 'jotai'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/storage', () => ({
  default: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
  StorageKey: { MyProjects: 'myProjects', MyFolders: 'myFolders' },
}))

import { parseScopes } from '@/projects/scope-store'
import { myProjectsAtom } from './useFolders'
import { useScopes } from './useScopes'

describe('useScopes writes', () => {
  it('two writes in one tick both land', () => {
    const store = createStore()
    const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
    const { result } = renderHook(() => useScopes(), { wrapper })
    act(() => {
      result.current.addScope({ name: 'A', kind: 'project' })
      result.current.addScope({ name: 'B', kind: 'client' })
    })
    expect(parseScopes(store.get(myProjectsAtom)).map((scope) => scope.name)).toEqual(['A', 'B'])
  })

  it('a put from a stale closure keeps later changes', () => {
    const store = createStore()
    const wrapper = ({ children }: { children: ReactNode }) => <Provider store={store}>{children}</Provider>
    const { result } = renderHook(() => useScopes(), { wrapper })
    let a = result.current.scopes[0]
    act(() => {
      a = result.current.addScope({ name: 'A', kind: 'project' })
    })
    const stale = result.current
    act(() => {
      stale.removeScope(a.id)
      result.current.addScope({ name: 'B', kind: 'project' })
    })
    act(() => stale.putScope(a))
    expect(
      parseScopes(store.get(myProjectsAtom))
        .map((scope) => scope.name)
        .sort()
    ).toEqual(['A', 'B'])
  })
})
