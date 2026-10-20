import type { Message, Session, SessionMeta } from '@shared/types'
import { getMessageText, migrateMessage } from '@shared/utils/message'
import { migrateSession } from '@/utils/session-utils'

/** Current global-search stop after this many matching messages. */
export const LINEAR_HISTORY_SEARCH_RESULT_CAP = 50

/**
 * Escape user input so history search is a case-insensitive substring, not a regex.
 * Preserves the existing SearchDialog contract.
 */
export function escapeHistorySearchInput(searchInput: string): string {
  return searchInput.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&')
}

export function createHistorySearchRegexp(searchInput: string): RegExp {
  return new RegExp(escapeHistorySearchInput(searchInput), 'i')
}

/**
 * Linear in-memory match against a session's current thread and archived threads.
 * Does not scan `messageForksHash` (forks) or tool-call / image-only parts.
 */
export function matchSessionMessages(sessionInput: Session, regexp: RegExp): Message[] {
  const session = migrateSession(sessionInput)
  const matchedMessages: Message[] = []
  for (let i = session.messages.length - 1; i >= 0; i--) {
    const message = session.messages[i]
    if (regexp.test(getMessageText(message))) {
      matchedMessages.push(message)
    }
  }
  if (session.threads) {
    for (let i = session.threads.length - 1; i >= 0; i--) {
      const thread = session.threads[i]
      for (let j = thread.messages.length - 1; j >= 0; j--) {
        const message = thread.messages[j]
        if (regexp.test(getMessageText(message))) {
          matchedMessages.push(message)
        }
      }
    }
  }
  return matchedMessages.map((m) => migrateMessage(m))
}

export type HistoryScanOptions = {
  /** Stops the scan: no session is read after it aborts. */
  signal?: AbortSignal
  /** Sessions failing this are skipped before their storage is read. */
  include?: (meta: SessionMeta) => boolean
  /** Stops after this many matching sessions. When set, the message cap no longer applies. */
  maxSessions?: number
}

/**
 * Reads the listed sessions in order and emits each one that has matching messages (with only those messages). Without
 * options it stops at `LINEAR_HISTORY_SEARCH_RESULT_CAP` matching messages, as the global search always did.
 */
export async function scanHistorySessions(
  metas: SessionMeta[],
  read: (sessionId: string) => Promise<Session | null>,
  regexp: RegExp,
  onBatch: (batch: Session[]) => void,
  opts: HistoryScanOptions = {}
): Promise<void> {
  const { signal, include, maxSessions } = opts
  let matchedMessages = 0
  let matchedSessions = 0
  for (const meta of metas) {
    if (signal?.aborted) return
    if (include && !include(meta)) continue
    const session = await read(meta.id)
    if (signal?.aborted) return
    if (!session) continue
    const messages = matchSessionMessages(session, regexp)
    if (messages.length === 0) continue
    matchedMessages += messages.length
    matchedSessions += 1
    onBatch([{ ...session, messages }])
    if (maxSessions !== undefined) {
      if (matchedSessions >= maxSessions) return
    } else if (matchedMessages >= LINEAR_HISTORY_SEARCH_RESULT_CAP) {
      return
    }
  }
}
