import type { Session } from '@shared/types'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { getEffectiveProjectId } from '@/projects/project-context'

/**
 * The scope a chat's Review entries file under: the chat's project (legacy `folderId` counts, as everywhere else the
 * chat resolves its scope through `getEffectiveProjectId`), else Everywhere.
 */
export function scopeIdForSession(session: Pick<Session, 'projectId' | 'folderId'>): string {
  return getEffectiveProjectId(session) ?? EVERYWHERE_SCOPE_ID
}
