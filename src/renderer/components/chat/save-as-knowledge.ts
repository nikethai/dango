import type { Message } from '@shared/types'
import { t } from 'i18next'
import { getLogger } from '@/lib/utils'

const log = getLogger('knowledge')

type SaveModule = Pick<typeof import('@/packages/knowledge/save-message'), 'saveMessageAsKnowledge'>

/**
 * The message toolbar's Save as knowledge. `saveMessageAsKnowledge` toasts its own failures; this also catches
 * its chunk failing to load (or anything else it throws), so the click never leaves an unhandled rejection.
 */
export async function saveAsKnowledgeFromMessage(
  msg: Message,
  sessionId: string,
  load: () => Promise<SaveModule> = () => import('@/packages/knowledge/save-message')
): Promise<void> {
  try {
    const { saveMessageAsKnowledge } = await load()
    await saveMessageAsKnowledge(msg, sessionId)
  } catch (error) {
    log.error('Save as knowledge failed:', error)
    try {
      const toastActions = await import('@/stores/toastActions')
      toastActions.add(t("Couldn't save that. Try again."))
    } catch (toastError) {
      log.error('Save as knowledge toast failed:', toastError)
    }
  }
}
