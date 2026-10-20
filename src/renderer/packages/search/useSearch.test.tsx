// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetSearchProvidersForTests, registerSearchProvider } from './registry'
import type { SearchHit, SearchQuery } from './types'
import { useSearch } from './useSearch'

const hit = (title: string, group: SearchHit['group'] = 'chats'): SearchHit => ({
  id: `${group}:${title}`,
  group,
  title,
  sourceLabel: title,
  open: () => undefined,
})

/** Lets the promise chains of a resolved provider run. */
const flush = () => vi.advanceTimersByTimeAsync(0)

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  _resetSearchProvidersForTests()
})

describe('useSearch', () => {
  it('stale results are dropped', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<SearchHit[]>>>()
    const search = vi.fn((q: SearchQuery, _signal: AbortSignal) => {
      const d = deferred<SearchHit[]>()
      pending.set(q.text, d)
      return d.promise
    })
    registerSearchProvider({ id: 'p', group: 'chats', search })

    const { result, rerender } = renderHook(({ text }) => useSearch(text, 'all'), {
      initialProps: { text: 'la' },
    })
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(search).toHaveBeenCalledTimes(1)

    rerender({ text: 'launch' })
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(search).toHaveBeenCalledTimes(2)
    expect(search.mock.calls[0]?.[1].aborted).toBe(true)

    await act(async () => {
      pending.get('launch')?.resolve([hit('launch result')])
      await flush()
    })
    expect(result.current.groups.chats.map((h) => h.title)).toEqual(['launch result'])
    expect(result.current.loading).toBe(false)

    await act(async () => {
      pending.get('la')?.resolve([hit('la result')])
      await flush()
    })
    expect(result.current.groups.chats.map((h) => h.title)).toEqual(['launch result'])
    expect(result.current.loading).toBe(false)
  })

  it('stale is true from a text change until the new run answers first, with the old groups still shown', async () => {
    const pending = new Map<string, ReturnType<typeof deferred<SearchHit[]>>>()
    registerSearchProvider({
      id: 'p',
      group: 'chats',
      search: (q: SearchQuery) => {
        const d = deferred<SearchHit[]>()
        pending.set(q.text, d)
        return d.promise
      },
    })
    registerSearchProvider({ id: 'slow', group: 'knowledge', search: () => new Promise<SearchHit[]>(() => undefined) })
    const { result, rerender } = renderHook(({ text }) => useSearch(text, 'all'), { initialProps: { text: 'la' } })
    expect(result.current.stale).toBe(true)
    await act(() => vi.advanceTimersByTimeAsync(150))
    await act(async () => {
      pending.get('la')?.resolve([hit('la result')])
      await flush()
    })
    expect(result.current.stale).toBe(false)
    expect(result.current.loading).toBe(true)

    rerender({ text: 'launch' })
    expect(result.current.stale).toBe(true)
    expect(result.current.groups.chats.map((h) => h.title)).toEqual(['la result'])
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(result.current.stale).toBe(true)

    await act(async () => {
      pending.get('launch')?.resolve([hit('launch result')])
      await flush()
    })
    expect(result.current.stale).toBe(false)
    expect(result.current.groups.chats.map((h) => h.title)).toEqual(['launch result'])

    rerender({ text: '' })
    expect(result.current.stale).toBe(false)
  })

  it('debounces typing by 150 ms', async () => {
    const search = vi.fn(async (_q: SearchQuery): Promise<SearchHit[]> => [])
    registerSearchProvider({ id: 'p', group: 'chats', search })
    const { rerender } = renderHook(({ text }) => useSearch(text, 'all'), { initialProps: { text: 'l' } })
    await act(() => vi.advanceTimersByTimeAsync(100))
    rerender({ text: 'la' })
    await act(() => vi.advanceTimersByTimeAsync(100))
    expect(search).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(50))
    expect(search).toHaveBeenCalledTimes(1)
    expect(search.mock.calls[0][0]).toEqual({ text: 'la', scopeIds: 'all' })
  })

  it('scope change re-runs', async () => {
    const search = vi.fn(async (q: SearchQuery) => [
      hit(q.scopeIds === 'all' ? 'everything' : q.scopeIds.join(','), 'knowledge'),
    ])
    registerSearchProvider({ id: 'p', group: 'knowledge', search })
    const { result, rerender } = renderHook(({ scopes }: { scopes: string[] | 'all' }) => useSearch('launch', scopes), {
      initialProps: { scopes: 'all' as string[] | 'all' },
    })
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(result.current.groups.knowledge.map((h) => h.title)).toEqual(['everything'])

    // A new array with the same ids is the same scope and does not search again.
    rerender({ scopes: 'all' })
    rerender({ scopes: ['acme'] })
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(search).toHaveBeenCalledTimes(2)
    expect(search.mock.calls[1][0]).toEqual({ text: 'launch', scopeIds: ['acme'] })
    expect(result.current.groups.knowledge.map((h) => h.title)).toEqual(['acme'])

    rerender({ scopes: ['acme'] })
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(search).toHaveBeenCalledTimes(2)
  })

  it('empty text calls no provider and gives empty groups', async () => {
    const search = vi.fn(async () => [hit('x')])
    registerSearchProvider({ id: 'p', group: 'chats', search })
    const { result } = renderHook(() => useSearch('   ', 'all'))
    await act(() => vi.advanceTimersByTimeAsync(500))
    expect(search).not.toHaveBeenCalled()
    expect(result.current).toEqual({ groups: { chats: [], knowledge: [], sources: [] }, loading: false, stale: false })
  })

  it('fills each group as its provider returns, skips providers below minChars, and keeps at most 8 per group', async () => {
    const slow = deferred<SearchHit[]>()
    const files = vi.fn(async () => [hit('file')])
    registerSearchProvider({ id: 'chats', group: 'chats', search: () => slow.promise })
    registerSearchProvider({
      id: 'threads',
      group: 'sources',
      search: async () => Array.from({ length: 6 }, (_, i) => hit(`t${i}`, 'sources')),
    })
    registerSearchProvider({
      id: 'more',
      group: 'sources',
      search: async () => Array.from({ length: 6 }, (_, i) => hit(`m${i}`, 'sources')),
    })
    registerSearchProvider({ id: 'files', group: 'sources', minChars: 2, search: files })

    const { result } = renderHook(() => useSearch('l', 'all'))
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(files).not.toHaveBeenCalled()
    expect(result.current.groups.sources).toHaveLength(8)
    expect(result.current.groups.sources.slice(0, 6).map((h) => h.title)).toEqual(['t0', 't1', 't2', 't3', 't4', 't5'])
    expect(result.current.groups.chats).toEqual([])
    expect(result.current.loading).toBe(true)

    await act(async () => {
      slow.resolve([hit('chat')])
      await flush()
    })
    expect(result.current.groups.chats.map((h) => h.title)).toEqual(['chat'])
    expect(result.current.loading).toBe(false)
  })

  it('a provider that throws leaves the others', async () => {
    registerSearchProvider({
      id: 'bad',
      group: 'chats',
      search: () => Promise.reject(new Error('boom')),
    })
    registerSearchProvider({
      id: 'sync',
      group: 'sources',
      search: () => {
        throw new Error('sync boom')
      },
    })
    registerSearchProvider({ id: 'good', group: 'knowledge', search: async () => [hit('k', 'knowledge')] })
    const { result } = renderHook(() => useSearch('launch', 'all'))
    await act(() => vi.advanceTimersByTimeAsync(150))
    expect(result.current.groups.knowledge.map((h) => h.title)).toEqual(['k'])
    expect(result.current.loading).toBe(false)
  })
})
