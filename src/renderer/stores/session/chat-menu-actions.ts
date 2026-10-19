import { t } from 'i18next'
import { readScopes } from '@/hooks/useScopes'
import { getLogger } from '@/lib/utils'
import { pushUndo } from '@/packages/undo'
import { getEffectiveProjectId } from '@/projects/project-context'
import { moveSessionToScope } from '@/projects/scope-sessions'
import * as chatStore from '@/stores/chatStore'
import * as toastActions from '@/stores/toastActions'

const log = getLogger('chat-menu-actions')

/**
 * Delete a chat with a 5 s undo. Undo puts back the same chat (same id, messages and raw list position) and its
 * task checklist. Resolves null when the chat no longer exists.
 */
export async function deleteChatWithUndo(sessionId: string): Promise<{ name: string } | null> {
  const live = await chatStore.getSession(sessionId)
  if (!live) {
    return null
  }
  // Stop a running answer first: otherwise the stream keeps writing into the deleted chat, and undo would bring back
  // a message still marked generating (a spinner nothing will ever clear). The partial text is kept.
  const generating = [...live.messages].reverse().find((m) => m.generating)
  const { getActiveGenerationMessageId } = await import('./generation-cancel')
  const running = Boolean(generating) || Boolean(getActiveGenerationMessageId(sessionId))
  if (running) {
    const { stopSessionGeneration } = await import('./stop-generation')
    await stopSessionGeneration(sessionId, generating ?? null)
  }
  // Snapshot after Stop, so undo restores the chat stopped.
  const session = (running ? await chatStore.getSession(sessionId) : live) ?? live
  // deleteSession clears the chat's checklist from memory and disk; keep a copy for undo.
  const { taskStore, flushSessionTasks } = await import('@/stores/taskStore')
  await taskStore.getState().hydrateSessionTasks(sessionId)
  const tasks = taskStore.getState().getSessionTasks(sessionId)

  const index = await chatStore.deleteSession(sessionId)
  pushUndo({
    message: t('Deleted "{{name}}"', { name: session.name }),
    undo: async () => {
      await chatStore.restoreSession(session, index)
      if (tasks.length > 0) {
        taskStore.getState().replaceSessionTasks(sessionId, tasks)
        await flushSessionTasks(sessionId)
      }
    },
  })
  return { name: session.name }
}

/** Archive or unarchive a chat with a 5 s undo that flips it back. */
export async function archiveChatWithUndo(sessionId: string): Promise<{ name: string; archived: boolean } | null> {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return null
  }
  const archived = !session.archived
  await chatStore.updateSession(sessionId, { archived })
  pushUndo({
    message: archived
      ? t('Archived "{{name}}"', { name: session.name })
      : t('Unarchived "{{name}}"', { name: session.name }),
    undo: async () => {
      await chatStore.updateSession(sessionId, { archived: !archived })
    },
  })
  return { name: session.name, archived }
}

/**
 * Move a chat to a scope (`undefined` = no scope) with a 5 s undo that moves it back. Resolves null, with no undo,
 * when nothing moved: the chat is gone, it is already there, or the scope was refused (Everywhere holds no chats).
 */
export async function moveChatWithUndo(
  sessionId: string,
  scopeId: string | undefined
): Promise<{ name: string; scopeName: string } | null> {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    return null
  }
  const previousId = getEffectiveProjectId(session)
  if ((previousId ?? undefined) === (scopeId || undefined)) {
    return null
  }
  if (!(await moveSessionToScope(sessionId, scopeId || undefined))) {
    return null
  }
  const scopes = await readScopes()
  const nameOf = (id: string | undefined) => (id ? scopes.find((scope) => scope.id === id)?.name : undefined)
  const targetName = nameOf(scopeId)
  const previousName = nameOf(previousId)
  // A scope removed meanwhile has no name to show: say only that the chat moved, never "Moved to No scope".
  const scopeName = targetName ?? (scopeId ? '' : t('No scope'))
  const message = targetName
    ? t('Moved to {{scope}}', { scope: targetName })
    : !scopeId && previousName
      ? t('Moved out of {{scope}}', { scope: previousName })
      : t('Moved "{{name}}"', { name: session.name })
  pushUndo({
    message,
    undo: async () => {
      await moveSessionToScope(sessionId, previousId)
    },
  })
  return { name: session.name, scopeName }
}

/** moveChatWithUndo for UI handlers (menu, sidebar drag, composer scope pill): a failure is logged and toasted. */
export async function moveChatWithUndoOrToast(sessionId: string, scopeId: string | undefined): Promise<boolean> {
  try {
    return (await moveChatWithUndo(sessionId, scopeId)) !== null
  } catch (error) {
    log.error('Failed to move chat to scope', error)
    toastActions.add(t("Couldn't move this chat. Try again."))
    return false
  }
}
