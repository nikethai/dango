import { ActionIcon, Box, Flex, Image, Menu, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core'
import SwipeableDrawer from '@mui/material/SwipeableDrawer'
import {
  IconChevronUp,
  IconCode,
  IconEdit,
  IconInfoCircle,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPhotoPlus,
  IconSearch,
  IconSettings,
  IconX,
} from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DangoWordmark from './components/brand/DangoWordmark'
import { UserAvatar } from './components/common/Avatar'
import ThemeSwitchButton from './components/dev/ThemeSwitchButton'
import TitleBarRow from './components/layout/TitleBarRow'
import { NewScopeSheet } from './components/scope'
import SessionList from './components/session/SessionList'
import { FORCE_ENABLE_DEV_PAGES } from './dev/devToolsConfig'
import {
  SIDEBAR_ICON_RAIL_WIDTH,
  useIsSmallScreen,
  useSidebarEffectiveWidth,
  useSidebarWidth,
} from './hooks/useScreenChange'
import { useScopes } from './hooks/useScopes'
import useVersion from './hooks/useVersion'
import { startNewChat } from './lib/startNewChat'
import { navigateToSettings } from './modals/Settings'
import { trackingEvent } from './packages/event'
import appIcon from './static/icon.png'
import { useLanguage, useSettingsStore } from './stores/settingsStore'
import { useUIStore } from './stores/uiStore'
import { CHATBOX_BUILD_PLATFORM } from './variables'

export default function Sidebar() {
  const { t } = useTranslation()
  const versionHook = useVersion()
  const language = useLanguage()
  const navigate = useNavigate()
  const { addScope } = useScopes()
  const userAvatarKey = useSettingsStore((s) => s.userAvatarKey)
  const showSidebar = useUIStore((s) => s.showSidebar)
  const setShowSidebar = useUIStore((s) => s.setShowSidebar)
  const sidebarLayout = useUIStore((s) => s.sidebarLayout)
  const setSidebarLayout = useUIStore((s) => s.setSidebarLayout)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)

  const sessionListViewportRef = useRef<HTMLDivElement>(null)

  const expandedSidebarWidth = useSidebarWidth()
  const effectiveSidebarWidth = useSidebarEffectiveWidth()
  const isSmallScreen = useIsSmallScreen()
  const isIconRail = !isSmallScreen && sidebarLayout === 'rail'

  const [isResizing, setIsResizing] = useState(false)
  const [showArchived, setShowArchived] = useState(false)
  const [folderModalOpened, setFolderModalOpened] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [accountMenuWidth, setAccountMenuWidth] = useState<number | undefined>(undefined)
  const accountTriggerRef = useRef<HTMLButtonElement>(null)
  const resizeStartX = useRef<number>(0)
  const resizeStartWidth = useRef<number>(0)

  const syncAccountMenuWidth = useCallback(() => {
    const el = accountTriggerRef.current
    if (el) {
      // Match dropdown to trigger / rail foot content width (full container)
      setAccountMenuWidth(Math.round(el.getBoundingClientRect().width))
    }
  }, [])

  const closeSidebarIfMobile = useCallback(() => {
    if (isSmallScreen) {
      setShowSidebar(false)
    }
  }, [isSmallScreen, setShowSidebar])

  const displayName = useMemo(() => {
    // Local-first CE — no cloud account; product name as workspace identity
    return 'Dango'
  }, [])

  const displaySubtitle = useMemo(() => t('On this device'), [t])

  const handleCreateNewSession = useCallback(() => {
    startNewChat()

    if (isSmallScreen) {
      setShowSidebar(false)
    }
    trackingEvent('create_new_conversation', { event_category: 'user' })
  }, [setShowSidebar, isSmallScreen])

  const handleCreateNewPictureSession = useCallback(() => {
    navigate({ to: '/image-creator' })
    if (isSmallScreen) {
      setShowSidebar(false)
    }
    trackingEvent('open_image_creator', { event_category: 'user' })
  }, [isSmallScreen, setShowSidebar, navigate])

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (isSmallScreen || isIconRail) return
      e.preventDefault()
      e.stopPropagation()
      setIsResizing(true)
      resizeStartX.current = e.clientX
      resizeStartWidth.current = expandedSidebarWidth
    },
    [isSmallScreen, isIconRail, expandedSidebarWidth]
  )

  useEffect(() => {
    if (!isResizing) return

    const handleMouseMove = (e: MouseEvent) => {
      const isRTL = language === 'ar'
      const deltaX = isRTL ? resizeStartX.current - e.clientX : e.clientX - resizeStartX.current
      const newWidth = Math.max(200, Math.min(500, resizeStartWidth.current + deltaX))
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      setIsResizing(false)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isResizing, language, setSidebarWidth])

  // Desktop never fully hides — collapse to icon-only rail.
  const handleCollapseSidebar = useCallback(() => {
    if (isSmallScreen) {
      setShowSidebar(false)
      return
    }
    setSidebarLayout('rail')
  }, [isSmallScreen, setShowSidebar, setSidebarLayout])

  const handleExpandSidebar = useCallback(() => {
    if (isSmallScreen) {
      setShowSidebar(true)
      return
    }
    setSidebarLayout('expanded')
    setShowSidebar(true)
  }, [isSmallScreen, setShowSidebar, setSidebarLayout])

  // Desktop drawer stays open (rail or expanded); mobile uses temporary open/close.
  const drawerOpen = isSmallScreen ? showSidebar : true
  // Mobile: near-full intentional Chats panel (not a squeezed 75% desktop rail).
  const drawerWidth = isSmallScreen
    ? 'min(100vw - 1.25rem, 22.5rem)'
    : isIconRail
      ? SIDEBAR_ICON_RAIL_WIDTH
      : effectiveSidebarWidth

  return (
    <>
      <SwipeableDrawer
        anchor={language === 'ar' ? 'right' : 'left'}
        variant={isSmallScreen ? 'temporary' : 'persistent'}
        open={drawerOpen}
        onClose={() => setShowSidebar(false)}
        onOpen={() => setShowSidebar(true)}
        ModalProps={{
          keepMounted: true, // Better open performance on mobile.
        }}
        sx={{
          '& .MuiDrawer-paper': {
            backgroundImage: 'none',
            backgroundColor: 'var(--chatbox-background-rail)',
            boxSizing: 'border-box',
            width: drawerWidth,
            maxWidth: isSmallScreen ? 'min(100vw - 1.25rem, 22.5rem)' : undefined,
            // Soft studio edge (no hard double border with .studio-rail)
            borderRight: 'none',
            boxShadow: 'var(--chatbox-rail-edge-shadow)',
            overflowX: 'hidden',
            transition: 'width 220ms cubic-bezier(0.2, 0, 0, 1)',
            '@media (prefers-reduced-motion: reduce)': {
              transition: 'none',
            },
          },
        }}
        SlideProps={language === 'ar' ? { direction: 'left' } : undefined}
        PaperProps={
          language === 'ar'
            ? {
                sx: {
                  direction: 'rtl',
                  overflowY: 'initial',
                  borderLeft: 'none',
                  boxShadow: 'var(--chatbox-rail-edge-shadow-rtl)',
                },
              }
            : { sx: { overflowY: 'initial' } }
        }
        disableSwipeToOpen={CHATBOX_BUILD_PLATFORM !== 'ios'} // iOSSwipeToOpen
        disableEnforceFocus={true} // focus trap， modal input
      >
        <Stack
          h="100%"
          gap={0}
          pt="var(--mobile-safe-area-inset-top, 0px)"
          pb="var(--mobile-safe-area-inset-bottom, 0px)"
          className={clsx('relative studio-rail', isIconRail && 'studio-rail--icon')}
        >
          {/* Brand / mobile Chats header */}
          <TitleBarRow
            heightMode="desktop"
            macTrafficInset={false}
            justify={isIconRail ? 'center' : 'flex-start'}
            className={clsx('rail-head', isSmallScreen && 'rail-head--mobile')}
          >
            {isIconRail ? (
              <Tooltip label="Dango" position="right" withArrow openDelay={300}>
                <Image
                  src={appIcon}
                  w={28}
                  h={28}
                  alt="Dango"
                  className="rounded-[6px] active:scale-[0.96] transition-transform"
                />
              </Tooltip>
            ) : isSmallScreen ? (
              <Flex align="center" gap={8} miw={0} justify="space-between" className="controls min-w-0 w-full">
                <Text component="span" className="rail-mobile-title">
                  {t('Chats')}
                </Text>
                <ActionIcon
                  variant="subtle"
                  color="chatbox-secondary"
                  size={40}
                  radius="md"
                  className="active:scale-[0.96] transition-transform"
                  aria-label={t('Hide sidebar')}
                  onClick={() => setShowSidebar(false)}
                >
                  <IconX size={18} stroke={1.75} />
                </ActionIcon>
              </Flex>
            ) : (
              <Flex align="center" gap={8} miw={0} justify="flex-start" className="controls min-w-0 w-full">
                <DangoWordmark size="rail" />
                {FORCE_ENABLE_DEV_PAGES && <ThemeSwitchButton size="xs" />}
              </Flex>
            )}
          </TitleBarRow>

          {/* Nav — labels when expanded; icon-only tooltips in rail */}
          <nav
            className={clsx('rail-nav', isIconRail && 'rail-nav--icon', isSmallScreen && 'rail-nav--mobile')}
            aria-label={t('Navigation')}
          >
            {isIconRail ? (
              <>
                <Tooltip label={`${t('Search')} ⌘K`} position="right" withArrow openDelay={300}>
                  <button
                    type="button"
                    className="rail-icon-btn active:scale-[0.96]"
                    onClick={() => {
                      setOpenSearchDialog(true, true)
                      closeSidebarIfMobile()
                    }}
                    aria-label={t('Search')}
                  >
                    <IconSearch size={18} stroke={1.5} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t('New Chat')} position="right" withArrow openDelay={300}>
                  <button
                    type="button"
                    className="rail-icon-btn active:scale-[0.96]"
                    onClick={handleCreateNewSession}
                    aria-label={t('New Chat')}
                  >
                    <IconEdit size={18} stroke={1.5} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t('Imagine')} position="right" withArrow openDelay={300}>
                  <button
                    type="button"
                    className="rail-icon-btn active:scale-[0.96]"
                    onClick={handleCreateNewPictureSession}
                    aria-label={t('Imagine')}
                  >
                    <IconPhotoPlus size={18} stroke={1.5} aria-hidden />
                  </button>
                </Tooltip>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="rail-nav-item"
                  onClick={() => {
                    setOpenSearchDialog(true, true)
                    closeSidebarIfMobile()
                  }}
                >
                  <IconSearch size={18} stroke={1.5} aria-hidden />
                  <span>{t('Search')}</span>
                  {!isSmallScreen && <kbd className="rail-nav-kbd">⌘K</kbd>}
                </button>
                <button type="button" className="rail-nav-item rail-nav-item--primary" onClick={handleCreateNewSession}>
                  <IconEdit size={18} stroke={1.5} aria-hidden />
                  <span>{t('New Chat')}</span>
                  {!isSmallScreen && <kbd className="rail-nav-kbd">⌘N</kbd>}
                </button>
                <button type="button" className="rail-nav-item" onClick={handleCreateNewPictureSession}>
                  <IconPhotoPlus size={18} stroke={1.5} aria-hidden />
                  <span>{t('Imagine')}</span>
                </button>
              </>
            )}
          </nav>

          {!isIconRail && (
            <Box className="flex-1 min-h-0 flex flex-col overflow-hidden rail-session-list">
              <SessionList
                sessionListViewportRef={sessionListViewportRef}
                showArchived={showArchived}
                onShowArchivedChange={setShowArchived}
                onCreateProject={() => setFolderModalOpened(true)}
                density={isSmallScreen ? 'mobile' : 'desktop'}
              />
            </Box>
          )}

          {isIconRail && <Box className="flex-1 min-h-0" />}

          {/* Account footer — expand sits above user (chrome control, then identity) */}
          <div className={clsx('rail-foot', isIconRail && 'rail-foot--icon')}>
            {isIconRail && (
              <Tooltip label={t('Expand sidebar')} position="right" withArrow openDelay={300}>
                <button
                  type="button"
                  className="rail-icon-btn rail-expand-btn active:scale-[0.96]"
                  onClick={handleExpandSidebar}
                  aria-label={t('Expand sidebar')}
                >
                  <IconLayoutSidebarLeftExpand size={18} stroke={1.5} aria-hidden />
                </button>
              </Tooltip>
            )}
            <Menu
              shadow="md"
              width={isIconRail ? 240 : (accountMenuWidth ?? 'target')}
              position={isIconRail ? 'right-end' : 'top'}
              withinPortal
              offset={isIconRail ? 10 : 6}
              middlewares={
                isIconRail ? { flip: true, shift: true, size: false } : { flip: true, shift: false, size: true }
              }
              opened={accountMenuOpen}
              onChange={(open) => {
                if (open && !isIconRail) {
                  syncAccountMenuWidth()
                }
                setAccountMenuOpen(open)
              }}
              classNames={{
                dropdown: clsx('user-menu-dropdown user-menu-dropdown-full', isIconRail && 'user-menu-dropdown--rail'),
              }}
            >
              <Menu.Target>
                {isIconRail ? (
                  <UnstyledButton
                    ref={accountTriggerRef}
                    className="rail-icon-btn user-trigger-icon active:scale-[0.96]"
                    data-expanded={accountMenuOpen ? 'true' : 'false'}
                    aria-expanded={accountMenuOpen}
                    aria-haspopup="menu"
                    aria-label={displayName}
                  >
                    <UserAvatar size={28} avatarKey={userAvatarKey} />
                  </UnstyledButton>
                ) : (
                  <UnstyledButton
                    ref={accountTriggerRef}
                    className="user-trigger"
                    data-expanded={accountMenuOpen ? 'true' : 'false'}
                    aria-expanded={accountMenuOpen}
                    aria-haspopup="menu"
                    onMouseEnter={syncAccountMenuWidth}
                  >
                    <span className="user-avatar" aria-hidden>
                      <UserAvatar size={32} avatarKey={userAvatarKey} />
                    </span>
                    <span className="user-meta">
                      <strong>{displayName}</strong>
                      <span>{displaySubtitle}</span>
                    </span>
                    <span className="user-chevron" aria-hidden>
                      <IconChevronUp size={16} stroke={1.75} />
                    </span>
                  </UnstyledButton>
                )}
              </Menu.Target>

              <Menu.Dropdown>
                <div className="user-menu-identity">
                  <span className="user-menu-identity-avatar" aria-hidden>
                    <UserAvatar size={36} avatarKey={userAvatarKey} />
                  </span>
                  <span className="user-menu-identity-meta">
                    <strong>{displayName}</strong>
                    <span>{displaySubtitle}</span>
                  </span>
                </div>

                <Menu.Divider />

                <Menu.Item
                  leftSection={<IconPhotoPlus size={15} stroke={1.5} />}
                  rightSection={<em className="user-menu-badge">{t('Beta')}</em>}
                  onClick={() => {
                    handleCreateNewPictureSession()
                    closeSidebarIfMobile()
                  }}
                >
                  {t('Image studio')}
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconSettings size={15} stroke={1.5} />}
                  rightSection={<em className="user-menu-kbd">⌘,</em>}
                  onClick={() => {
                    navigateToSettings()
                    closeSidebarIfMobile()
                  }}
                >
                  {t('Settings')}
                </Menu.Item>
                <Menu.Item
                  leftSection={<IconInfoCircle size={15} stroke={1.5} />}
                  rightSection={
                    CHATBOX_BUILD_PLATFORM === 'android' && versionHook.needCheckUpdate ? (
                      <Box w={6} h={6} bg="chatbox-brand" style={{ borderRadius: '50%' }} />
                    ) : (
                      <em className="user-menu-badge">
                        {/\d/.test(versionHook.version) ? `v${versionHook.version}` : ''}
                      </em>
                    )
                  }
                  onClick={() => {
                    navigate({ to: '/about' })
                    closeSidebarIfMobile()
                  }}
                >
                  {t('About')}
                </Menu.Item>

                {!isSmallScreen && (
                  <>
                    <Menu.Divider />
                    <Menu.Item
                      leftSection={
                        isIconRail ? (
                          <IconLayoutSidebarLeftExpand size={15} stroke={1.5} />
                        ) : (
                          <IconLayoutSidebarLeftCollapse size={15} stroke={1.5} />
                        )
                      }
                      onClick={isIconRail ? handleExpandSidebar : handleCollapseSidebar}
                    >
                      {isIconRail ? t('Expand sidebar') : t('Collapse to icons')}
                    </Menu.Item>
                  </>
                )}

                {FORCE_ENABLE_DEV_PAGES && (
                  <>
                    <Menu.Divider />
                    <Menu.Item
                      leftSection={<IconCode size={15} stroke={1.5} />}
                      onClick={() => {
                        navigate({ to: '/dev' })
                        closeSidebarIfMobile()
                      }}
                    >
                      {t('Dev Tools')}
                    </Menu.Item>
                  </>
                )}
              </Menu.Dropdown>
            </Menu>
          </div>
          {!isSmallScreen && !isIconRail && (
            <Box
              onMouseDown={handleResizeStart}
              onDoubleClick={handleCollapseSidebar}
              title={t('Drag to resize · double-click to collapse to icons')}
              className={clsx('sidebar-resizer', isResizing && 'is-resizing', language === 'ar' ? 'left-0' : 'right-0')}
            />
          )}
        </Stack>
      </SwipeableDrawer>

      <NewScopeSheet
        opened={folderModalOpened}
        onClose={() => setFolderModalOpened(false)}
        onCreate={(input) => {
          const scope = addScope(input)
          setFolderModalOpened(false)
          // TODO(slice 03 Task 6): the /scope/$scopeId route does not exist yet, so `to` is cast until it lands.
          void navigate({ to: `/scope/${scope.id}` as string } as never)
        }}
      />
    </>
  )
}
