/**
 * @vitest-environment jsdom
 */

import { act, renderHook, waitFor } from '@testing-library/react'
import { createStore, Provider, useAtomValue } from 'jotai'
import { type ReactNode, Suspense } from 'react'
import { describe, expect, it, vi } from 'vitest'

const stored = vi.hoisted(() => ({ value: null as unknown }))

vi.mock('@/storage', () => ({
  default: { getItem: async () => stored.value, setItem: async () => {}, removeItem: async () => {} },
  StorageKey: { MyProjects: 'myProjects', MyFolders: 'myFolders' },
}))

import { parseScopes } from '@/projects/scope-store'
import { myProjectsAtom } from './useFolders'
import { readScopes, useScopes } from './useScopes'

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

  it('a write after a reload keeps the scopes that were loaded from storage', async () => {
    stored.value = [
      { id: 'a', name: 'A', kind: 'project', order: 0 },
      { id: 'b', name: 'B', kind: 'client', order: 1 },
    ]
    try {
      const store = createStore()
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Provider store={store}>
          <Suspense fallback={null}>{children}</Suspense>
        </Provider>
      )
      const { result } = renderHook(() => useScopes(), { wrapper })
      await waitFor(() => expect(result.current?.scopes.map((scope) => scope.name)).toEqual(['A', 'B']))
      act(() => result.current.updateScope('b', { kind: 'project' }))
      expect(result.current.scopes.map((scope) => `${scope.name}:${scope.kind}`)).toEqual(['A:project', 'B:project'])
      act(() => {
        result.current.addScope({ name: 'C', kind: 'client' })
      })
      expect(result.current.scopes.map((scope) => scope.name)).toEqual(['A', 'B', 'C'])
    } finally {
      stored.value = null
    }
  })

  it('addScope after a reload keeps A and B', async () => {
    stored.value = [
      { id: 'a', name: 'A', kind: 'project', order: 0 },
      { id: 'b', name: 'B', kind: 'client', order: 1 },
    ]
    try {
      const store = createStore()
      const wrapper = ({ children }: { children: ReactNode }) => (
        <Provider store={store}>
          <Suspense fallback={null}>{children}</Suspense>
        </Provider>
      )
      const { result } = renderHook(() => useScopes(), { wrapper })
      await waitFor(() => expect(result.current?.scopes).toHaveLength(2))
      act(() => {
        result.current.addScope({ name: 'C', kind: 'project' })
      })
      expect(result.current.scopes.map((scope) => scope.name)).toEqual(['A', 'B', 'C'])
    } finally {
      stored.value = null
    }
  })
})

describe('readScopes', () => {
  const data = [
    { id: 'a', name: 'A', kind: 'client', order: 0 },
    { id: 'b', name: 'B', kind: 'project', order: 1 },
  ]

  it('awaits the storage Promise the atom holds after a reload', async () => {
    stored.value = data
    try {
      const store = createStore()
      const { unmount } = renderHook(() => useAtomValue(myProjectsAtom), {
        wrapper: ({ children }: { children: ReactNode }) => (
          <Provider store={store}>
            <Suspense fallback={null}>{children}</Suspense>
          </Provider>
        ),
      })
      expect(store.get(myProjectsAtom)).toBeInstanceOf(Promise)
      expect((await readScopes(store)).map((scope) => scope.name)).toEqual(['A', 'B'])
      unmount()
    } finally {
      stored.value = null
    }
  })

  it('reads storage when the atom was never mounted', async () => {
    stored.value = data
    try {
      const scopes = await readScopes(createStore())
      expect(scopes.map((scope) => `${scope.name}:${scope.kind}`)).toEqual(['A:client', 'B:project'])
    } finally {
      stored.value = null
    }
  })
})
