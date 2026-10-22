import type { Message, Session } from '@shared/types'
import type { KnowledgeSourceInput } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { t } from 'i18next'
import { getLogger } from '@/lib/utils'
import { getMemoryMessageText } from '@/packages/memory/message-text'
import {
  CLIENT_ANSWER_TOOL,
  CLIENT_RECALL_TOOL,
  holdsLocalOnlyRecall,
} from '@/packages/model-calls/toolsets/pm-pilot-history'
import { getEffectiveProjectId } from '@/projects/project-context'
import { addKnowledge, KnowledgeConflictError } from './approve'
import { quote } from './text'

const log = getLogger('knowledge')

/** The messages of the message's thread up to and including it; null when the session does not hold it. */
function messagesUpTo(session: Session | null | undefined, msg: Message): Message[] | null {
  const threads = [session?.messages ?? [], ...(session?.threads ?? []).map((th) => th.messages ?? [])]
  for (const messages of threads) {
    const at = messages.findIndex((m) => m.id === msg.id)
    if (at >= 0) return [...messages.slice(0, at), msg]
  }
  return null
}

/**
 * ADR 0003 for a saved message: `null` when it holds no local-only text. Else the local-only sources its text may
 * repeat (from the first local-only recall of its chat to it), or `'unknown'` when they cannot all be named: a Needs you
 * opening or a later answer in that chat (they quote the mail), a summary of local-only answers, or a result
 * without `localOnlySourceIds`. The user's own messages are theirs (a cloud model gets them too). An answer whose chat
 * cannot be read (`chat` null) counts as unknown: what came before it is not known.
 */
function localOnlySources(msg: Message, chat: Message[] | null): string[] | 'unknown' | null {
  if (msg.pmQuestionId) return 'unknown'
  if (msg.role === 'user') return null
  if (!chat) return 'unknown'
  if (chat.some((m) => !!m.pmQuestionId)) return 'unknown'
  const from = chat.findIndex(holdsLocalOnlyRecall)
  if (from < 0) return null
  const ids = new Set<string>()
  for (const m of chat.slice(from)) {
    if (m.pmLocalOnly) return 'unknown'
    for (const p of m.contentParts ?? []) {
      if (p.type !== 'tool-call' || (p.toolName !== CLIENT_RECALL_TOOL && p.toolName !== CLIENT_ANSWER_TOOL)) continue
      const result = p.result as { localOnly?: unknown; localOnlySourceIds?: unknown } | undefined
      if (result?.localOnly !== true) continue
      const named = result.localOnlySourceIds
      if (!Array.isArray(named) || named.length === 0 || !named.every((id) => typeof id === 'string' && id)) {
        return 'unknown'
      }
      for (const id of named) ids.add(id)
    }
  }
  return ids.size > 0 ? [...ids] : 'unknown'
}

/**
 * A message's "Save as knowledge" action: adds its text (first 500 characters) as a fact in the chat's
 * scope, or Everywhere. `addKnowledge` pushes its own undo; this only toasts what went wrong.
 * Text built from email or tasks kept on this device is filed with those sources (so it stays off cloud models), or
 * not saved when they are not known.
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
    const localOnly = localOnlySources(msg, messagesUpTo(session, msg))
    if (localOnly === 'unknown') {
      toastActions.add(t("This answer used email or tasks kept on this device, so it can't be saved as knowledge."))
      return
    }
    const scopeId = (session ? getEffectiveProjectId(session) : undefined) ?? EVERYWHERE_SCOPE_ID
    if (localOnly) {
      const sources: KnowledgeSourceInput[] = localOnly.map((sourceId) => ({
        kind: 'chat',
        label: t('Chat answer'),
        sourceId,
      }))
      await addKnowledge({ scopeId, kind: 'fact', text, sources })
    } else {
      await addKnowledge({ scopeId, kind: 'fact', text })
    }
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
