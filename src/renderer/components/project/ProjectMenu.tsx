import type { ActionMenuItemProps } from '@/components/ActionMenu'
import { IconFolder, IconFolderOff, IconLink } from '@tabler/icons-react'
import platform, { platformCapabilities } from '@/platform'
import { listSessionsMeta, updateSession } from '@/stores/chatStore'

export function projectFolderActions(opts: { projectId: string; t: (key: string) => string }): ActionMenuItemProps[] {
  if (!platformCapabilities.supportsProjectWorkspace) {
    return []
  }
  return [
    {
      text: opts.t('Open Folder'),
      icon: IconFolder,
      onClick: () => {
        void platform.pickAndBindProject?.(opts.projectId)
      },
    },
    {
      text: opts.t('Reveal in Finder'),
      icon: IconFolder,
      onClick: () => {
        void platform.revealProject?.(opts.projectId)
      },
    },
    {
      text: opts.t('Relink folder'),
      icon: IconLink,
      onClick: () => {
        void platform.relinkProject?.(opts.projectId)
      },
    },
    {
      text: opts.t('Read project instructions'),
      icon: IconFolder,
      onClick: () => {
        void platform.setProjectTrust?.(opts.projectId, 'instructions', 'allowed')
      },
    },
    {
      text: opts.t('Unbind folder'),
      icon: IconFolderOff,
      onClick: async () => {
        await platform.unbindProject?.(opts.projectId)
        const list = await listSessionsMeta()
        for (const session of list) {
          if ((session.projectId || session.folderId) === opts.projectId) {
            await updateSession(session.id, { workspaceRoot: undefined })
          }
        }
      },
    },
  ]
}
