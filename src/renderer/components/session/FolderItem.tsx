import { ActionIcon, Flex, Text, Tooltip } from '@mantine/core'
import type { ScopeKind } from '@shared/types'
import {
  IconChevronDown,
  IconChevronRight,
  IconDots,
  IconPlus,
  IconSettings,
  IconStack2,
  IconTrash,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import { ScalableIcon } from '../common/ScalableIcon'
import { ProjectBadge } from '../project/ProjectBadge'
import { projectFolderActions } from '../project/ProjectMenu'

export interface FolderItemProps {
  active: boolean
  count: number
  /** @deprecated emoji ignored in UI — scopes use a shared outline mark */
  emoji?: string
  expanded: boolean
  implicit?: boolean
  kind: ScopeKind
  name: string
  projectId?: string
  workspaceStatus?: import('@shared/types/workspace').WorkspaceStatus
  onCreateChat?(): void
  onDelete?(): void
  onOpen(): void
  onOpenSettings(): void
  onToggle(): void
}

function FolderItem({
  active,
  count,
  expanded,
  implicit = false,
  kind,
  name,
  projectId,
  workspaceStatus,
  onCreateChat,
  onDelete,
  onOpen,
  onOpenSettings,
  onToggle,
}: FolderItemProps) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const [menuOpened, setMenuOpened] = useState(false)

  const actionMenuItems = useMemo<ActionMenuItemProps[]>(
    () =>
      implicit
        ? []
        : [
            {
              text: t('New chat'),
              icon: IconPlus,
              onClick: () => onCreateChat?.(),
            },
            {
              text: t('Scope settings'),
              icon: IconSettings,
              onClick: () => onOpenSettings(),
            },
            { divider: true },
            ...(projectId ? projectFolderActions({ projectId, t }) : []),
            {
              text: t('Delete scope'),
              icon: IconTrash,
              color: 'chatbox-error' as const,
              onClick: () => onDelete?.(),
            },
          ],
    [implicit, onCreateChat, onDelete, onOpenSettings, projectId, t]
  )

  return (
    <Flex
      align="center"
      gap={6}
      mx={6}
      px={8}
      py={5}
      className={clsx(
        'group/folder-item project-folder-row',
        !implicit && 'hover:bg-[var(--chatbox-background-tertiary-hover)]',
        active && 'studio-rail-row-active'
      )}
    >
      <ActionIcon
        variant="transparent"
        size={28}
        color="chatbox-tertiary"
        aria-label={t('Toggle chats')}
        aria-expanded={expanded}
        className="shrink-0 active:scale-[0.96] transition-transform"
        onClick={(event) => {
          event.stopPropagation()
          onToggle()
        }}
      >
        <ScalableIcon
          icon={expanded ? IconChevronDown : IconChevronRight}
          size={13}
          className={clsx('project-folder-chevron', expanded && 'is-open')}
        />
      </ActionIcon>

      <IconStack2 size={14} stroke={1.5} className="project-row-icon" aria-hidden />

      <Text
        span
        size="xs"
        c="chatbox-tertiary"
        fw={550}
        role="button"
        tabIndex={0}
        className="tracking-tight truncate project-folder-name cursor-pointer"
        style={{ fontSize: '0.8125rem', letterSpacing: '-0.01em' }}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen()
          }
        }}
      >
        {name}
      </Text>
      {kind === 'client' ? <span className="dg-chip">client</span> : null}
      {workspaceStatus ? <ProjectBadge status={workspaceStatus} /> : null}

      <Text
        span
        size="xs"
        c="chatbox-tertiary"
        flex={1}
        className="tabular-nums project-folder-count"
        style={{ fontSize: '0.6875rem' }}
      >
        {count}
      </Text>

      {/* Hover-only + on desktop; always available on small screens + inside menu */}
      {!implicit && onCreateChat && (
        <Tooltip label={t('New chat')} withArrow openDelay={400}>
          <ActionIcon
            variant="transparent"
            size={28}
            color="chatbox-tertiary"
            className={clsx(
              'active:scale-[0.96] transition-transform',
              isSmallScreen || menuOpened ? '' : 'group-hover/folder-item:visible invisible'
            )}
            aria-label={t('New chat')}
            onClick={(event) => {
              event.stopPropagation()
              event.preventDefault()
              onCreateChat()
            }}
          >
            <ScalableIcon icon={IconPlus} size={15} />
          </ActionIcon>
        </Tooltip>
      )}

      {!implicit && (
        <ActionMenu
          type="desktop"
          items={actionMenuItems}
          position="bottom-start"
          opened={menuOpened}
          onChange={(opened) => setMenuOpened(opened)}
        >
          <ActionIcon
            variant="transparent"
            size={28}
            color="chatbox-tertiary"
            className={clsx(
              'active:scale-[0.96] transition-transform',
              isSmallScreen || menuOpened ? '' : 'group-hover/folder-item:visible invisible'
            )}
            aria-label={t('Scope options')}
            onClick={(event) => {
              event.stopPropagation()
              event.preventDefault()
            }}
          >
            <ScalableIcon icon={IconDots} size={15} />
          </ActionIcon>
        </ActionMenu>
      )}
    </Flex>
  )
}

export default memo(FolderItem)
