import type { Scope, SessionMeta } from '@shared/types'
import { t } from 'i18next'
import { getLogger } from '@/lib/utils'
import * as toastActions from '@/stores/toastActions'
import { deleteScopeWithUndo } from './scope-delete'
import { moveSessionToScope } from './scope-sessions'

const log = getLogger('scope-feedback')

/** moveSessionToScope for UI handlers: a failure is logged and shown as a toast instead of being swallowed. */
export async function moveSessionToScopeOrToast(sessionId: string, scopeId: string | undefined): Promise<boolean> {
  try {
    return await moveSessionToScope(sessionId, scopeId)
  } catch (error) {
    log.error('Failed to move chat to scope', error)
    toastActions.add(t("Couldn't move this chat. Try again."))
    return false
  }
}

/** deleteScopeWithUndo for UI handlers. Resolves false (after a toast) when the delete failed. */
export async function deleteScopeOrToast(
  scope: Scope,
  sessions: SessionMeta[],
  deps: Parameters<typeof deleteScopeWithUndo>[2]
): Promise<boolean> {
  try {
    await deleteScopeWithUndo(scope, sessions, deps)
    return true
  } catch (error) {
    log.error('Failed to delete scope', error)
    toastActions.add(t("Couldn't delete {{name}}. Try again.", { name: scope.name }))
    return false
  }
}
