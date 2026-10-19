import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex } from '@mantine/core'
import type { Session } from '@shared/types'
import { IconClearAll, IconDots, IconSettings } from '@tabler/icons-react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'
import { clear as clearSession } from '@/stores/sessionActions'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import Broom from '../icons/Broom'
import { useChatMenu } from '../session/useChatMenu'
import UpdateAvailableButton from '../UpdateAvailableButton'

/**
 * Thread header overflow — one ⋯: Session options, the chat menu (CM1), then Clear All Messages.
 * Global search lives in the sidebar only (not duplicated here).
 */
export default function Toolbar({
  session,
  compact,
  onRename,
}: {
  session: Session
  compact?: boolean
  /** Starts the header's inline rename. Without it (compact workspace toolbar) the menu has no Rename row. */
  onRename?: () => void
}) {
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

  const chatMenu = useChatMenu(session, { selected: true, onRename })

  const overflowItems = useMemo<ActionMenuItemProps[]>(() => {
    return [
      {
        text: t('Session options'),
        icon: IconSettings,
        onClick: () => {
          void NiceModal.show('session-settings', { session })
        },
      },
      { divider: true },
      ...chatMenu.items,
      { divider: true },
      {
        doubleCheck: { color: 'chatbox-error' },
        text: t('Clear All Messages'),
        icon: isSmallScreen ? IconClearAll : Broom,
        onClick: () => {
          void clearSession(sessionId)
        },
      },
    ]
  }, [chatMenu.items, isSmallScreen, session, sessionId, t])

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
      {chatMenu.sheet}
    </Flex>
  )
}
