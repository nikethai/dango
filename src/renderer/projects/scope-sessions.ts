import { isEverywhere, type SessionMeta } from '@shared/types'
import { getEffectiveProjectId } from '@/projects/project-context'
import { updateSession } from '@/stores/chatStore'

/**
 * The only writer of a chat's scope. Writes projectId and folderId together so neither can
 * shadow the other (getEffectiveProjectId prefers projectId). Everywhere holds no chats: refused, no write.
 */
export async function moveSessionToScope(sessionId: string, scopeId: string | undefined): Promise<boolean> {
  if (isEverywhere(scopeId)) {
    return false
  }
  await updateSession(sessionId, { projectId: scopeId, folderId: scopeId })
  return true
}

/** Clear the scope of every session currently in `scopeId` (legacy folderId-only chats included). */
export async function unassignScopeSessions(scopeId: string, sessions: SessionMeta[]): Promise<number> {
  const inScope = sessions.filter((session) => getEffectiveProjectId(session) === scopeId)
  await Promise.all(inScope.map((session) => moveSessionToScope(session.id, undefined)))
  return inScope.length
}
