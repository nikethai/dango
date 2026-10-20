import type { Session, SessionMeta } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { t } from 'i18next'
import { getEffectiveProjectId } from '@/projects/project-context'
import { inScopes, oneLine, SEARCH_GROUP_LIMIT, type SearchHit, type SearchProvider } from '../types'

const EXCERPT_LIMIT = 160
/** Characters kept before the match when the excerpt is cut. */
const EXCERPT_LEAD = 40
/** Messages are scanned from two characters; one character matches chat names only. */
const MESSAGE_MIN_CHARS = 2

/** At most `EXCERPT_LIMIT` characters of `text` around the first match of `query`, with … where it was cut. */
export function excerptAround(text: string, query: string): string {
  if (text.length <= EXCERPT_LIMIT) return text
  const at = Math.max(0, text.toLowerCase().indexOf(oneLine(query).toLowerCase()))
  const start = Math.max(0, at - EXCERPT_LEAD)
  if (start === 0) return `${text.slice(0, EXCERPT_LIMIT - 1)}…`
  if (start + EXCERPT_LIMIT - 1 >= text.length) return `…${text.slice(text.length - (EXCERPT_LIMIT - 1))}`
  return `…${text.slice(start, start + EXCERPT_LIMIT - 2)}…`
}

/**
 * Switches to the chat and, when a message is given, scrolls to it once the list has rendered (moved from the old
 * search dialog). The caller closes its own UI.
 */
export function openChatHit(sessionId: string, messageId?: string): void {
  void (async () => {
    const [{ getDefaultStore }, { currentSessionIdAtom }, { switchCurrentSession }, scrollActions] = await Promise.all([
      import('jotai'),
      import('@/stores/atoms'),
      import('@/stores/sessionActions'),
      import('@/stores/scrollActions'),
    ])
    const needsSwitch = getDefaultStore().get(currentSessionIdAtom) !== sessionId
    if (needsSwitch) switchCurrentSession(sessionId)
    if (!messageId) return

    const tryScroll = async (attempt = 0, maxAttempts = 10): Promise<void> => {
      const delay = needsSwitch ? (attempt === 0 ? 300 : 200) : 100
      await new Promise((resolve) => setTimeout(resolve, delay))
      const success = await scrollActions.scrollToMessage(sessionId, messageId)
      if (!success && attempt < maxAttempts) await tryScroll(attempt + 1, maxAttempts)
    }
    await tryScroll()
  })()
}

function chatHit(meta: Pick<SessionMeta, 'id' | 'name' | 'projectId' | 'folderId'>, match?: MessageMatch): SearchHit {
  const name = meta.name
  return {
    id: `chat:${meta.id}`,
    group: 'chats',
    title: name,
    excerpt: match?.excerpt,
    scopeId: getEffectiveProjectId(meta),
    sourceLabel: t('Chat “{{name}}”', { name }),
    open: () => openChatHit(meta.id, match?.messageId),
  }
}

type MessageMatch = { messageId: string; excerpt: string }

/**
 * Chats: name matches first (from the chat list), then chats whose messages match (`searchSessions`), one hit per
 * chat with its first matching message as the excerpt. Scoped searches keep chats whose project is a chosen scope.
 */
export const chatsProvider: SearchProvider = {
  id: 'chats',
  group: 'chats',
  async search(q, signal) {
    const needle = q.text.trim().toLowerCase()
    if (!needle) return []
    const [{ listSessionsMeta }, { searchSessions }] = await Promise.all([
      import('@/stores/chatStore'),
      import('@/stores/sessionHelpers'),
    ])
    const wanted = (s: Pick<SessionMeta, 'hidden' | 'projectId' | 'folderId'>) =>
      !s.hidden && inScopes(getEffectiveProjectId(s), q.scopeIds)

    const metas = (await listSessionsMeta()).filter(wanted)
    if (signal.aborted) return []
    const nameMatches = metas.filter((meta) => meta.name?.toLowerCase().includes(needle))

    // Off-scope and hidden chats are skipped before their storage is read; the scan stops on abort or after a group's
    // worth of matching chats. A batch that still arrives after an abort is dropped.
    const messageMatches = new Map<string, { session: Session; match: MessageMatch }>()
    if (needle.length >= MESSAGE_MIN_CHARS) {
      await searchSessions(
        q.text,
        undefined,
        (batch) => {
          if (signal.aborted) return
          for (const session of batch) {
            if (messageMatches.has(session.id) || !wanted(session)) continue
            const first = session.messages[0]
            if (!first) continue
            const text = oneLine(getMessageText(first, false, false))
            messageMatches.set(session.id, {
              session,
              match: { messageId: first.id, excerpt: excerptAround(text, q.text.trim()) },
            })
          }
        },
        { signal, include: wanted, maxSessions: SEARCH_GROUP_LIMIT }
      )
    }
    if (signal.aborted) return []

    const named = new Set(nameMatches.map((meta) => meta.id))
    const hits = nameMatches.map((meta) => chatHit(meta, messageMatches.get(meta.id)?.match))
    for (const [id, { session, match }] of messageMatches) {
      if (!named.has(id)) hits.push(chatHit(session, match))
    }
    return hits.slice(0, SEARCH_GROUP_LIMIT)
  },
}
