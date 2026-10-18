import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex } from '@mantine/core'
import type { Session } from '@shared/types'
import { IconClearAll, IconDeviceFloppy, IconDots, IconSettings, IconTrash } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'
import { router } from '@/router'
import { deleteSession } from '@/stores/chatStore'
import { clear as clearSession } from '@/stores/sessionActions'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import Broom from '../icons/Broom'
import UpdateAvailableButton from '../UpdateAvailableButton'

/**
 * Thread header overflow — one ⋯ for session options + export + destructive actions.
 * Global search lives in the sidebar only (not duplicated here).
 */
export default function Toolbar({ session, compact }: { session: Session; compact?: boolean }) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const sessionId = session.id

  const [showUpdateNotification, setShowUpdateNotification] = useState(false)

  useEffect(() => {
    // Updates show the in-app button only; they never raise an OS notification.
    const offUpdateDownloaded = platform.onUpdateDownloaded(() => {
      setShowUpdateNotification(true)
    })
    return () => {
      offUpdateDownloaded()
    }
  }, [])

  const overflowItems = useMemo<ActionMenuItemProps[]>(() => {
    return [
      {
        text: t('Session options'),
        icon: IconSettings,
        onClick: () => {
          void NiceModal.show('session-settings', { session })
        },
      },
      {
        text: t('Export Chat'),
        icon: IconDeviceFloppy,
        onClick: () => {
          void NiceModal.show('export-chat')
        },
      },
      { divider: true },
      {
        doubleCheck: { color: 'chatbox-error' },
        text: t('Clear All Messages'),
        icon: isSmallScreen ? IconClearAll : Broom,
        onClick: () => {
          void clearSession(sessionId)
        },
      },
      {
        doubleCheck: { color: 'chatbox-error' },
        text: t('Delete Current Session'),
        icon: IconTrash,
        color: 'chatbox-error',
        onClick: async () => {
          try {
            await deleteSession(sessionId)
            router.navigate({ to: '/', replace: true })
          } catch (error) {
            console.error('Failed to delete session:', error)
          }
        },
      },
    ]
  }, [isSmallScreen, session, sessionId, t])

  return (
    <Flex align="center" gap={compact ? 0 : isSmallScreen ? 'xs' : 'sm'} className="controls">
      {showUpdateNotification && <UpdateAvailableButton />}

      <ActionMenu position="bottom-end" items={overflowItems}>
        <ActionIcon
          variant="subtle"
          size={compact ? 26 : isSmallScreen ? 30 : 32}
          color={compact ? 'gray' : 'chatbox-secondary'}
          radius={compact ? 'md' : undefined}
          className={compact ? 'workspace-action-btn active:scale-[0.96]' : 'active:scale-[0.96] transition-transform'}
          aria-label={t('More actions')}
        >
          <IconDots size={compact ? 16 : undefined} strokeWidth={1.8} />
        </ActionIcon>
      </ActionMenu>
    </Flex>
  )
}
