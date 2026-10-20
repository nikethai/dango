import { searchImportedSnapshot } from '@shared/imported-history'
import { t } from 'i18next'
import { oneLine, SEARCH_GROUP_LIMIT, type SearchHit, type SearchProvider } from '../types'

const EXCERPT_LIMIT = 160

async function openImportedConversation(sourceId: string, conversationId: string): Promise<void> {
  const { loadImportedHistory } = await import('@/packages/imported-history')
  const snapshot = await loadImportedHistory()
  const source = snapshot.sources.find((item) => item.id === sourceId)
  const conversation = source?.conversations.find((item) => item.id === conversationId)
  if (!source || !conversation) return
  const { default: NiceModal } = await import('@ebay/nice-modal-react')
  void NiceModal.show('imported-conversation', { source, conversation })
}

/** Imported ChatGPT conversations, one hit per conversation. They belong to no scope, so only All searches them. */
export const importedThreadsProvider: SearchProvider = {
  id: 'importedThreads',
  group: 'sources',
  async search(q, signal) {
    if (q.scopeIds !== 'all' || !q.text.trim()) return []
    const { loadImportedHistory } = await import('@/packages/imported-history')
    const snapshot = await loadImportedHistory()
    if (signal.aborted) return []

    const hits: SearchHit[] = []
    const seen = new Set<string>()
    for (const found of searchImportedSnapshot(snapshot, q.text)) {
      const key = `${found.sourceId}:${found.conversationId}`
      if (seen.has(key)) continue
      seen.add(key)
      const title = found.conversationTitle
      hits.push({
        id: `imported:${key}`,
        group: 'sources',
        title,
        excerpt: oneLine(found.message.text).slice(0, EXCERPT_LIMIT),
        sourceLabel: t('ChatGPT “{{title}}”', { title }),
        open: () => openImportedConversation(found.sourceId, found.conversationId),
      })
      if (hits.length >= SEARCH_GROUP_LIMIT) break
    }
    return hits
  },
}
