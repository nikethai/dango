import type { SessionMeta } from '@shared/types'
import {
  IconArchive,
  IconArchiveOff,
  IconDeviceFloppy,
  IconEdit,
  IconFolder,
  IconGitBranch,
  IconStar,
  IconStarFilled,
  IconTrash,
} from '@tabler/icons-react'
import type { TFunction } from 'i18next'
import type { ActionMenuItemProps } from '../ActionMenu'

export type ChatMenuHandlers = {
  onRename(): void
  onTogglePin(): void
  onMoveToScope(): void
  onBranch(): void
  onExport(): void
  onToggleArchive(): void
  onDelete(): void
}

/**
 * The one chat menu (CM1), shared by the sidebar row and the chat header. Delete has no double check: it is undoable.
 * Callers add their own rows around it (Session options above, Clear All Messages below in the header).
 */
export function buildChatMenuItems(
  session: Pick<SessionMeta, 'starred' | 'archived'>,
  h: ChatMenuHandlers,
  t: TFunction
): ActionMenuItemProps[] {
  return [
    { text: t('Rename'), icon: IconEdit, onClick: () => h.onRename() },
    {
      text: session.starred ? t('Unpin') : t('Pin'),
      icon: session.starred ? IconStarFilled : IconStar,
      onClick: () => h.onTogglePin(),
    },
    { text: t('Move to scope…'), icon: IconFolder, onClick: () => h.onMoveToScope() },
    { text: t('Branch'), icon: IconGitBranch, onClick: () => h.onBranch() },
    { text: t('Export'), icon: IconDeviceFloppy, onClick: () => h.onExport() },
    { divider: true },
    {
      text: session.archived ? t('Unarchive') : t('Archive'),
      icon: session.archived ? IconArchiveOff : IconArchive,
      onClick: () => h.onToggleArchive(),
    },
    { text: t('Delete chat'), icon: IconTrash, color: 'chatbox-error', onClick: () => h.onDelete() },
  ]
}
