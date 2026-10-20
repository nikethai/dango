import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { t } from 'i18next'
import { SEARCH_GROUP_LIMIT, type SearchHit, type SearchProvider } from '../types'
import { openScopeTab } from './openScope'

/** Approved knowledge in the chosen scopes; All is every scope plus Everywhere (which `readScopes` leaves out). */
export const knowledgeProvider: SearchProvider = {
  id: 'knowledge',
  group: 'knowledge',
  async search(q, signal) {
    const query = q.text.trim()
    if (!query) return []
    const { ensureKnowledgeLoaded, listKnowledge, scopeName } = await import('@/packages/knowledge')
    await ensureKnowledgeLoaded()
    let scopeIds: string[]
    if (q.scopeIds === 'all') {
      const { readScopes } = await import('@/hooks/useScopes')
      scopeIds = [...(await readScopes()).map((scope) => scope.id), EVERYWHERE_SCOPE_ID]
    } else {
      scopeIds = q.scopeIds
    }
    if (signal.aborted) return []

    const hits: SearchHit[] = []
    for (const scopeId of new Set(scopeIds)) {
      const label = t('{{scopeName}} knowledge', { scopeName: scopeName(scopeId) })
      for (const item of listKnowledge(scopeId, { query })) {
        hits.push({
          id: `knowledge:${item.id}`,
          group: 'knowledge',
          title: item.text,
          scopeId,
          sourceLabel: label,
          open: () => openScopeTab(scopeId, 'knowledge'),
        })
        if (hits.length >= SEARCH_GROUP_LIMIT) return hits
      }
    }
    return hits
  },
}
