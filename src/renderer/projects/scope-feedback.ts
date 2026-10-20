import type { Scope, SessionMeta } from '@shared/types'
import { t } from 'i18next'
import { getLogger } from '@/lib/utils'
import * as toastActions from '@/stores/toastActions'
import { deleteScopeWithUndo } from './scope-delete'

const log = getLogger('scope-feedback')

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
