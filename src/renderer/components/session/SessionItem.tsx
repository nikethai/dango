import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Button, Flex, Select, Text, TextInput } from '@mantine/core'
import type { SessionMeta } from '@shared/types'
import {
  IconArchive,
  IconCopy,
  IconDots,
  IconEdit,
  IconFolder,
  IconSettings,
  IconStar,
  IconStarFilled,
  IconTrash,
} from '@tabler/icons-react'
import clsx from 'clsx'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useFolders } from '@/hooks/useFolders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { getEffectiveProjectId } from '@/projects/project-context'
import { moveSessionToScope } from '@/projects/scope-sessions'
import { router } from '@/router'
import {
  deleteSession as deleteSessionStore,
  getSession,
  updateSession as updateSessionStore,
} from '@/stores/chatStore'
import { copyAndSwitchSession, switchCurrentSession } from '@/stores/sessionActions'
import { useUIStore } from '@/stores/uiStore'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import { AdaptiveModal } from '../common/AdaptiveModal'
import { ScalableIcon } from '../common/ScalableIcon'
import { formatRailRelativeTime } from './session-list-helpers'

export interface Props {
  nested?: boolean
  session: SessionMeta
  selected: boolean
}

function SessionItem(props: Props) {
  const { session, selected, nested = false } = props
  const { t } = useTranslation()
  const { folders } = useFolders()
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const isSmallScreen = useIsSmallScreen()
  const onClick = () => {
    switchCurrentSession(session.id)
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }

  const currentScopeId = getEffectiveProjectId(session)
  const [menuOpened, setMenuOpened] = useState(false)
  const [folderModalOpened, setFolderModalOpened] = useState(false)
  const [renameModalOpened, setRenameModalOpened] = useState(false)
  const [renameValue, setRenameValue] = useState(session.name)
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(currentScopeId ?? null)

  const timeLabel = useMemo(() => formatRailRelativeTime(session.updatedAt), [session.updatedAt])

  useEffect(() => {
    setSelectedFolderId(currentScopeId ?? null)
  }, [currentScopeId])

  useEffect(() => {
    if (!renameModalOpened) {
      setRenameValue(session.name)
    }
  }, [renameModalOpened, session.name])

  const actionMenuItems = useMemo<ActionMenuItemProps[]>(
    () => [
      {
        text: t('Rename'),
        icon: IconEdit,
        onClick: () => {
          setRenameModalOpened(true)
          setRenameValue(session.name)
        },
      },
      {
        text: t('Duplicate'),
        icon: IconCopy,
        onClick: () => {
          copyAndSwitchSession(session)
        },
      },
      {
        text: t('Session options'),
        icon: IconSettings,
        onClick: async () => {
          await NiceModal.show('session-settings', {
            session: await getSession(session.id),
          })
        },
      },
      { divider: true },
      {
        text: session.starred ? t('Unstar') : t('Star'),
        icon: session.starred ? IconStarFilled : IconStar,
        onClick: () => {
          void updateSessionStore(session.id, (s) => {
            if (!s) {
              throw new Error(`Session ${session.id} not found`)
            }
            return { ...s, starred: !s?.starred }
          })
        },
      },
      {
        text: t('Move to scope'),
        icon: IconFolder,
        onClick: () => {
          setFolderModalOpened(true)
        },
      },
      {
        text: session.archived ? t('Unarchive') : t('Archive'),
        icon: session.archived ? IconArchive : IconArchive,
        onClick: () => {
          void updateSessionStore(session.id, (s) => {
            if (!s) {
              throw new Error(`Session ${session.id} not found`)
            }
            return { ...s, archived: !s.archived }
          })
        },
      },
      { divider: true },
      {
        doubleCheck: true,
        text: t('Delete'),
        icon: IconTrash,
        color: 'chatbox-error',
        onClick: async () => {
          try {
            await deleteSessionStore(session.id)
            if (selected) {
              router.navigate({ to: '/', replace: true })
            }
          } catch (error) {
            console.error('Failed to delete session:', error)
          }
        },
      },
    ],
    [session, selected, t]
  )

  const folderOptions = useMemo(
    () => [
      { value: '', label: t('None') },
      ...folders.map((folder) => ({
        value: folder.id,
        label: folder.name,
      })),
    ],
    [folders, t]
  )

  const handleSaveFolder = async () => {
    await moveSessionToScope(session.id, selectedFolderId || undefined)
    setFolderModalOpened(false)
  }

  const handleSaveRename = async () => {
    const nextName = renameValue.trim() || session.name
    await updateSessionStore(session.id, (s) => {
      if (!s) {
        throw new Error(`Session ${session.id} not found`)
      }
      return { ...s, name: nextName }
    })
    setRenameModalOpened(false)
  }

  return (
    <>
      <Flex
        align="center"
        className={clsx(
          'cursor-pointer group/session-item studio-rail-row',
          nested && 'rail-session-nested',
          selected && 'studio-rail-row-active'
        )}
        mx={6}
        pl={10}
        pr={6}
        py={6}
        gap={6}
        onClick={onClick}
      >
        <Text
          span
          flex={1}
          lineClamp={1}
          size="sm"
          fw={selected ? 600 : 450}
          c={selected ? 'chatbox-primary' : 'chatbox-secondary'}
          className="tracking-tight min-w-0 rail-session-title"
          style={{ fontSize: '0.8125rem', letterSpacing: '-0.01em' }}
        >
          {session.name}
        </Text>

        {timeLabel && (
          <Text
            span
            size="xs"
            c={selected ? 'chatbox-secondary' : 'chatbox-tertiary'}
            className="tabular-nums shrink-0 rail-session-time"
            style={{ fontSize: '0.625rem', fontFamily: 'var(--chatbox-font-mono)' }}
          >
            {timeLabel}
          </Text>
        )}

        <ActionMenu
          type="desktop"
          items={actionMenuItems}
          position="bottom-start"
          opened={menuOpened}
          onChange={(opened) => setMenuOpened(opened)}
        >
          <ActionIcon
            variant="transparent"
            size={24}
            color={session.starred ? 'chatbox-brand' : 'chatbox-tertiary'}
            className={clsx(
              'active:scale-[0.96] transition-transform shrink-0',
              isSmallScreen || session.starred || menuOpened ? '' : 'group-hover/session-item:visible invisible'
            )}
            onClick={(event) => {
              event.stopPropagation()
              event.preventDefault()
            }}
          >
            {session.starred ? (
              <ScalableIcon icon={IconStarFilled} className="text-inherit" size={13} />
            ) : (
              <ScalableIcon icon={IconDots} className="text-inherit" size={13} />
            )}
          </ActionIcon>
        </ActionMenu>
      </Flex>

      <AdaptiveModal
        opened={renameModalOpened}
        onClose={() => setRenameModalOpened(false)}
        title={t('Rename')}
        centered
        size="sm"
      >
        <TextInput
          label={t('Name')}
          value={renameValue}
          onChange={(e) => setRenameValue(e.currentTarget.value)}
          data-autofocus
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleSaveRename()
            }
          }}
          classNames={{
            input: '!text-chatbox-tint-primary',
          }}
        />
        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={() => setRenameModalOpened(false)} />
          <Button onClick={() => void handleSaveRename()}>{t('Save')}</Button>
        </AdaptiveModal.Actions>
      </AdaptiveModal>

      <AdaptiveModal
        opened={folderModalOpened}
        onClose={() => setFolderModalOpened(false)}
        title={t('Move to scope')}
        centered
      >
        <Select
          data={folderOptions}
          value={selectedFolderId ?? ''}
          onChange={(value) => setSelectedFolderId(value || null)}
          label={t('Scope')}
          comboboxProps={{ withinPortal: true }}
        />

        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={() => setFolderModalOpened(false)} />
          <Button onClick={() => void handleSaveFolder()}>{t('Save')}</Button>
        </AdaptiveModal.Actions>
      </AdaptiveModal>
    </>
  )
}

export default memo(SessionItem)
