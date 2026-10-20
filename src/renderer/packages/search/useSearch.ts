import { useEffect, useMemo, useState } from 'react'
import { listSearchProviders } from './registry'
import { SEARCH_GROUP_LIMIT, SEARCH_GROUPS, type SearchGroup, type SearchHit, type SearchQuery } from './types'

export const SEARCH_DEBOUNCE_MS = 150

export type SearchState = {
  groups: Record<SearchGroup, SearchHit[]>
  /** The current text and scope have providers still running (or waiting for the debounce). */
  loading: boolean
  /**
   * The groups belong to an earlier text or scope: true from any change until the current run's first provider
   * settles; false for empty text. Callers ignore ↵ / ⌘↵ while stale.
   */
  stale: boolean
}

// What the groups on screen were found for (`key`), and the last run whose providers all settled.
type RunState = { groups: Record<SearchGroup, SearchHit[]>; key: string | null; settledKey: string | null }

const emptyGroups = (): Record<SearchGroup, SearchHit[]> => ({ chats: [], knowledge: [], sources: [] })

const EMPTY_STATE: SearchState = { groups: emptyGroups(), loading: false, stale: false }

/** Groups in provider registration order, each cut to `SEARCH_GROUP_LIMIT`. */
function buildGroups(order: string[], results: Map<string, SearchHit[]>): Record<SearchGroup, SearchHit[]> {
  const groups = emptyGroups()
  for (const id of order) {
    for (const hit of results.get(id) ?? []) {
      if (SEARCH_GROUPS.includes(hit.group)) groups[hit.group].push(hit)
    }
  }
  for (const group of SEARCH_GROUPS) groups[group] = groups[group].slice(0, SEARCH_GROUP_LIMIT)
  return groups
}

/**
 * Runs every registered provider for `text` in `scopeIds`, 150 ms after the last change. Providers run in parallel and
 * each group fills as its provider returns. A newer text or scope aborts the older run, whose late results are
 * dropped: the groups only ever hold hits of the current run. Empty text gives empty groups and calls nothing.
 */
export function useSearch(text: string, scopeIds: string[] | 'all'): SearchState {
  const trimmed = text.trim()
  // Callers pass a fresh array each render; the run depends on the ids, not the array.
  const scopeKey = scopeIds === 'all' ? 'all' : JSON.stringify(scopeIds)
  const scopes = useMemo<SearchQuery['scopeIds']>(
    () => (scopeKey === 'all' ? 'all' : (JSON.parse(scopeKey) as string[])),
    [scopeKey]
  )
  const runKey = `${scopeKey}\u0000${trimmed}`
  const [state, setState] = useState<RunState>(() => ({ groups: emptyGroups(), key: null, settledKey: null }))

  useEffect(() => {
    if (!trimmed) {
      setState({ groups: emptyGroups(), key: null, settledKey: null })
      return
    }
    // Earlier results stay on screen (stale) until this run's first provider answers, then are replaced, never mixed.
    const key = runKey
    const controller = new AbortController()
    const timer = setTimeout(() => {
      const providers = listSearchProviders().filter((p) => trimmed.length >= (p.minChars ?? 1))
      const order = providers.map((p) => p.id)
      const results = new Map<string, SearchHit[]>()
      let pending = providers.length
      if (pending === 0) {
        setState({ groups: emptyGroups(), key, settledKey: key })
        return
      }
      const query: SearchQuery = { text: trimmed, scopeIds: scopes }
      for (const provider of providers) {
        let run: Promise<SearchHit[]>
        try {
          run = provider.search(query, controller.signal)
        } catch (error) {
          run = Promise.reject(error)
        }
        void run
          .then(
            (hits) => results.set(provider.id, hits),
            (error) => {
              if (!controller.signal.aborted) console.warn(`[search] provider ${provider.id} failed`, error)
              results.set(provider.id, [])
            }
          )
          .then(() => {
            if (controller.signal.aborted) return
            pending -= 1
            setState({ groups: buildGroups(order, results), key, settledKey: pending > 0 ? null : key })
          })
      }
    }, SEARCH_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [runKey, trimmed, scopes])

  if (!trimmed) return EMPTY_STATE
  return { groups: state.groups, loading: state.settledKey !== runKey, stale: state.key !== runKey }
}
