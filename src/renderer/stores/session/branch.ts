import { t } from 'i18next'
import * as chatStore from '../chatStore'
import { _copySession, switchCurrentSession } from './crud'
import { findMessageLocation } from './forks'

/**
 * Start a new chat from this point: a copy of the chat named "{{name}} (branch)" holding the messages up to and
 * including `messageId` (new ids), with no threads and no forks. Opens it and resolves its id.
 */
export async function branchChatFromMessage(sessionId: string, messageId: string): Promise<string> {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    throw new Error(`Session ${sessionId} not found`)
  }
  const location = findMessageLocation(session, messageId)
  if (!location) {
    throw new Error(`Message ${messageId} not found`)
  }
  // Compaction points follow the list the message is in: the session's for the current list, else its thread's.
  const compactionPoints =
    location.list === session.messages
      ? session.compactionPoints
      : session.threads?.find((thread) => thread.messages === location.list)?.compactionPoints
  // A copied message that was still streaming would show a spinner nothing ever clears.
  const messages = location.list
    .slice(0, location.index + 1)
    .map((m) => (m.generating ? { ...m, generating: false, cancel: undefined } : m))
  const copy = await _copySession({
    ...session,
    name: t('{{name}} (branch)', { name: session.name }),
    messages,
    threads: [],
    // Points whose messages were not copied are dropped by the copy.
    compactionPoints,
  })
  switchCurrentSession(copy.id)
  return copy.id
}
