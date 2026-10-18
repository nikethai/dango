import type { Message } from '@shared/types'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { t } from 'i18next'
import { getLogger } from '@/lib/utils'
import { getMemoryMessageText } from '@/packages/memory/message-text'
import { getEffectiveProjectId } from '@/projects/project-context'
import { addKnowledge, KnowledgeConflictError } from './approve'
import { quote } from './text'

const log = getLogger('knowledge')

/**
 * A message's "Save as knowledge" action: adds its text (first 500 characters) as a fact in the chat's
 * scope, or Everywhere. `addKnowledge` pushes its own undo; this only toasts what went wrong.
 */
export async function saveMessageAsKnowledge(msg: Message, sessionId: string): Promise<void> {
  // Loaded on demand: the toast store reads localStorage, and the chat store is heavy.
  const toastActions = await import('@/stores/toastActions')
  const text = getMemoryMessageText(msg).slice(0, 500).trim()
  if (!text) {
    toastActions.add(t('Nothing to save'))
    return
  }
  try {
    const chatStore = await import('@/stores/chatStore')
    const session = await chatStore.getSession(sessionId)
    const scopeId = (session ? getEffectiveProjectId(session) : undefined) ?? EVERYWHERE_SCOPE_ID
    await addKnowledge({ scopeId, kind: 'fact', text })
  } catch (error) {
    if (error instanceof KnowledgeConflictError) {
      toastActions.add(t('Waiting in Review: it contradicts "{{old}}"', { old: quote(error.oldText) }))
    } else if (error instanceof Error && error.message === 'duplicate') {
      toastActions.add(t('Already saved'))
    } else {
      log.error('Save as knowledge failed:', error)
      toastActions.add(t("Couldn't save that. Try again."))
    }
  }
}
