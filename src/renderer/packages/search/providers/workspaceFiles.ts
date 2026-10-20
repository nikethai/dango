import { v4 as uuidv4 } from 'uuid'
import { SEARCH_GROUP_LIMIT, type SearchHit, type SearchProvider } from '../types'
import { openScopeTab } from './openScope'

/**
 * Files in the folder sources of the chosen scopes (slice 7 makes every bound folder a source). Goes through the
 * workspace broker only: `restoreProjectBinding` (picker-bound, read-only here) and `searchWorkspace`; a scope whose
 * binding is not `ready` is skipped. Desktop only (`supportsProjectWorkspace`).
 */
export const workspaceFilesProvider: SearchProvider = {
  id: 'workspaceFiles',
  group: 'sources',
  minChars: 2,
  async search(q, signal) {
    const text = q.text.trim()
    if (!text) return []
    const { default: platform, platformCapabilities } = await import('@/platform')
    const { restoreProjectBinding, searchWorkspace } = platform
    if (!platformCapabilities.supportsProjectWorkspace || !restoreProjectBinding || !searchWorkspace) return []

    const { loadSources, listSources } = await import('@/packages/sources')
    await loadSources()
    if (signal.aborted) return []
    const scopeIds = [...new Set(listSources({ kind: 'folder' }).map((source) => source.scopeId))].filter(
      (scopeId) => q.scopeIds === 'all' || q.scopeIds.includes(scopeId)
    )

    const searchScope = async (scopeId: string): Promise<SearchHit[]> => {
      const descriptor = await restoreProjectBinding.call(platform, scopeId)
      if (signal.aborted || descriptor.status !== 'ready' || !descriptor.capabilityId) return []
      const requestId = uuidv4()
      const cancel = () => void platform.cancelWorkspaceRequest?.(requestId)?.catch(() => undefined)
      signal.addEventListener('abort', cancel, { once: true })
      try {
        const { hits } = await searchWorkspace.call(platform, descriptor.capabilityId, text, requestId)
        if (signal.aborted) return []
        return hits.map((hit, i) => ({
          id: `file:${scopeId}:${hit.relativePath}:${hit.line ?? i}`,
          group: 'sources' as const,
          title: hit.relativePath,
          excerpt: hit.excerpt,
          scopeId,
          sourceLabel: hit.line === undefined ? hit.relativePath : `${hit.relativePath}:${hit.line}`,
          open: () => openScopeTab(scopeId, 'files'),
        }))
      } finally {
        signal.removeEventListener('abort', cancel)
      }
    }

    const perScope = await Promise.all(scopeIds.map((scopeId) => searchScope(scopeId).catch(() => [])))
    if (signal.aborted) return []
    return perScope.flat().slice(0, SEARCH_GROUP_LIMIT)
  },
}
