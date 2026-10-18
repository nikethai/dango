import type { Scope, SessionMeta } from '@shared/types'
import { t } from 'i18next'
import { pushUndo } from '@/packages/undo'
import { getEffectiveProjectId } from '@/projects/project-context'
import { moveSessionToScope, unassignScopeSessions } from './scope-sessions'

/**
 * Delete a scope: its chats go back to Recents, then the scope is removed (one write), then a 5 s undo is offered.
 * Undo puts the same scope back (same id and order) and moves exactly the chats that were unassigned.
 */
export async function deleteScopeWithUndo(
  scope: Scope,
  sessions: SessionMeta[],
  deps: { removeScope(id: string): void; putScope(scope: Scope): void }
): Promise<void> {
  const movedIds = sessions
    .filter((session) => getEffectiveProjectId(session) === scope.id)
    .map((session) => session.id)
  await unassignScopeSessions(scope.id, sessions)
  deps.removeScope(scope.id)
  pushUndo({
    message: t('Deleted {{name}}', { name: scope.name }),
    undo: async () => {
      deps.putScope(scope)
      await Promise.all(movedIds.map((id) => moveSessionToScope(id, scope.id)))
    },
  })
}
