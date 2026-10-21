import { Box, Flex, Image, Menu, Stack, Tooltip, UnstyledButton } from '@mantine/core'
import Drawer from '@mui/material/Drawer'
import {
  IconChevronUp,
  IconCode,
  IconEdit,
  IconInfoCircle,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconMessages,
  IconSearch,
  IconSettings,
  IconStack2,
} from '@tabler/icons-react'
import { useLocation, useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import DangoWordmark from './components/brand/DangoWordmark'
import { UserAvatar } from './components/common/Avatar'
import ThemeSwitchButton from './components/dev/ThemeSwitchButton'
import TitleBarRow from './components/layout/TitleBarRow'
import { SidebarReviewRow } from './components/review/SidebarReviewRow'
import { NewScopeSheet } from './components/scope'
import SessionList from './components/session/SessionList'
import { hasOpenSheet } from './components/ui/useSheetFocus'
import { FORCE_ENABLE_DEV_PAGES } from './dev/devToolsConfig'
import { sidebarPresentation, toggleSidebar, useLayoutMode } from './hooks/useLayoutMode'
import { useScopes } from './hooks/useScopes'
import { useSidebarWidth } from './hooks/useScreenChange'
import useVersion from './hooks/useVersion'
import { startNewChat } from './lib/startNewChat'
import { navigateToSettings } from './modals/Settings'
import { trackingEvent } from './packages/event'
import appIcon from './static/icon.png'
import { useLanguage, useSettingsStore } from './stores/settingsStore'
import { useUIStore } from './stores/uiStore'
import { sidebarToggleLabel } from './utils/sidebarToggle'
import { CHATBOX_BUILD_PLATFORM } from './variables'

// The Review row closes nothing on navigate: the sidebar is never a temporary drawer now (phone has the tab bar).
const noNavigateEffect = () => {}

function containsFocus(el: HTMLElement | null): boolean {
  return !!el?.contains(document.activeElement)
}

export default function Sidebar() {
  const { t } = useTranslation()
  const versionHook = useVersion()
  const language = useLanguage()
  const navigate = useNavigate()
  const { addScope } = useScopes()
  const userAvatarKey = useSettingsStore((s) => s.userAvatarKey)
  const sidebarLayout = useUIStore((s) => s.sidebarLayout)
  const setSidebarLayout = useUIStore((s) => s.setSidebarLayout)
  const setSidebarWidth = useUIStore((s) => s.setSidebarWidth)
  const setOpenSearchDialog = useUIStore((s) => s.setOpenSearchDialog)
  const railPeek = useUIStore((s) => s.railPeek)
  const setRailPeek = useUIStore((s) => s.setRailPeek)
  const pathname = useLocation({ select: (l) => l.pathname })

  const sessionListViewportRef = useRef<HTMLDivElement>(null)

  const mode = useLayoutMode()
  const expandedSidebarWidth = useSidebarWidth()
  const presentation = sidebarPresentation({ mode, sidebarLayout, railPeek, expandedWidth: expandedSidebarWidth })
  const isIconRail = presentation.show === 'rail'
  // The rail's expanded sidebar laid over the content (medium, or wide collapsed to the rail).
  const isPeek = presentation.show === 'overlay'
  const peekIntentTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const railRef = useRef<HTMLDivElement>(null)
  // Opening or closing the peek swaps the rail's buttons for the expanded nav (and back); keep keyboard focus inside.
  const refocusAfterPeekChange = useRef(false)

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

  const displayName = useMemo(() => {
    // Local-first CE — no cloud account; product name as workspace identity
    return 'Dango'
  }, [])

  const displaySubtitle = useMemo(() => t('On this device'), [t])

  const handleCreateNewSession = useCallback(() => {
    startNewChat()
    trackingEvent('create_new_conversation', { event_category: 'user' })
  }, [])

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (presentation.show !== 'expanded') return
      e.preventDefault()
      e.stopPropagation()
      setIsResizing(true)
      resizeStartX.current = e.clientX
      resizeStartWidth.current = expandedSidebarWidth
    },
    [presentation.show, expandedSidebarWidth]
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

  const cancelPeekIntent = useCallback(() => {
    if (peekIntentTimer.current) {
      clearTimeout(peekIntentTimer.current)
      peekIntentTimer.current = null
    }
  }, [])

  // Hovering the rail opens the peek after a 300 ms intent delay; leaving it closes the peek.
  const handleRailMouseEnter = useCallback(() => {
    if (!isIconRail) return
    cancelPeekIntent()
    peekIntentTimer.current = setTimeout(() => {
      peekIntentTimer.current = null
      setRailPeek(true)
    }, 300)
  }, [isIconRail, cancelPeekIntent, setRailPeek])

  const handleRailMouseLeave = useCallback(() => {
    cancelPeekIntent()
    // The account menu lives in a portal; keep the peek while it is open.
    if (railPeek && !accountMenuOpen) setRailPeek(false)
  }, [cancelPeekIntent, railPeek, accountMenuOpen, setRailPeek])

  useEffect(() => cancelPeekIntent, [cancelPeekIntent])

  // Navigation closes the peek.
  const lastPathname = useRef(pathname)
  useEffect(() => {
    if (lastPathname.current === pathname) return
    lastPathname.current = pathname
    cancelPeekIntent()
    setRailPeek(false)
  }, [pathname, cancelPeekIntent, setRailPeek])

  // Esc closes the peek, unless a sheet or an inner control already handled it.
  useEffect(() => {
    if (!railPeek) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || hasOpenSheet()) return
      refocusAfterPeekChange.current = containsFocus(railRef.current)
      setRailPeek(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [railPeek, setRailPeek])

  // A click outside the peek closes it (the account menu's portal and the sidebar toggles count as inside).
  useEffect(() => {
    if (!railPeek) return
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target
      if (!(target instanceof Element)) return
      if (railRef.current?.contains(target)) return
      if (target.closest('.user-menu-dropdown, [data-sidebar-toggle]')) return
      setRailPeek(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [railPeek, setRailPeek])

  const openPeek = useCallback(() => {
    cancelPeekIntent()
    refocusAfterPeekChange.current = containsFocus(railRef.current)
    setRailPeek(true)
  }, [cancelPeekIntent, setRailPeek])

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the peek opens or closes
  useEffect(() => {
    if (!refocusAfterPeekChange.current) return
    refocusAfterPeekChange.current = false
    railRef.current?.querySelector<HTMLElement>('.rail-nav button')?.focus()
  }, [isPeek])

  // Desktop never fully hides — collapse to icon-only rail.
  const handleCollapseSidebar = useCallback(() => {
    setSidebarLayout('rail')
  }, [setSidebarLayout])

  // At wide this expands in place; at medium (always the rail) it opens the peek instead.
  const handleExpandSidebar = useCallback(() => {
    toggleSidebar(mode)
  }, [mode])

  // Same wording as the Header toggle: medium opens the peek, wide expands in place.
  const railToggleLabel = sidebarToggleLabel(t, mode, railPeek)

  return (
    <>
      {/* Medium and wide only: at phone the root mounts no sidebar (the tab bar navigates, RS3). Always open: the rail,
          the expanded sidebar or the peek. */}
      <Drawer
        anchor={language === 'ar' ? 'right' : 'left'}
        variant="persistent"
        open
        sx={{
          '& .MuiDrawer-paper': {
            backgroundImage: 'none',
            backgroundColor: 'var(--chatbox-background-rail)',
            boxSizing: 'border-box',
            width: presentation.drawerWidth,
            // Soft studio edge (no hard double border with .studio-rail)
            borderRight: 'none',
            // The peek floats above the content like a popover.
            boxShadow: isPeek ? 'var(--dango-shadow-popover)' : 'var(--chatbox-rail-edge-shadow)',
            overflowX: 'hidden',
            transition: 'width 150ms cubic-bezier(0.2, 0, 0, 1)',
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
      >
        <Stack
          h="100%"
          gap={0}
          pt="var(--mobile-safe-area-inset-top, 0px)"
          pb="var(--mobile-safe-area-inset-bottom, 0px)"
          ref={railRef}
          className={clsx('relative studio-rail', isIconRail && 'studio-rail--icon', isPeek && 'dg-rail-peek')}
          onMouseEnter={handleRailMouseEnter}
          onMouseLeave={handleRailMouseLeave}
        >
          {/* Brand header */}
          <TitleBarRow
            heightMode="desktop"
            macTrafficInset={false}
            justify={isIconRail ? 'center' : 'flex-start'}
            className="rail-head"
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
            ) : (
              <Flex align="center" gap={8} miw={0} justify="flex-start" className="controls min-w-0 w-full">
                <DangoWordmark size="rail" />
                {FORCE_ENABLE_DEV_PAGES && <ThemeSwitchButton size="xs" />}
              </Flex>
            )}
          </TitleBarRow>

          {/* Nav — labels when expanded; icon-only tooltips in rail */}
          <nav className={clsx('rail-nav', isIconRail && 'rail-nav--icon')} aria-label={t('Navigation')}>
            {isIconRail ? (
              <>
                <Tooltip label={t('Review')} position="right" withArrow openDelay={300}>
                  <SidebarReviewRow variant="rail" onNavigate={noNavigateEffect} />
                </Tooltip>
                <Tooltip label={`${t('Search')} ⌘K`} position="right" withArrow openDelay={300}>
                  <button
                    type="button"
                    className="rail-icon-btn active:scale-[0.96]"
                    onClick={() => {
                      setOpenSearchDialog(true)
                    }}
                    aria-label={t('Search')}
                  >
                    <IconSearch size={18} stroke={1.5} aria-hidden />
                  </button>
                </Tooltip>
                {/* Chats and Scopes open the peek (session list and scopes); New chat is ⌘N and in the peek. */}
                <Tooltip label={t('Chats')} position="right" withArrow openDelay={300}>
                  <button
                    type="button"
                    className="rail-icon-btn active:scale-[0.96]"
                    onClick={openPeek}
                    aria-label={t('Chats')}
                  >
                    <IconMessages size={18} stroke={1.5} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t('Scopes')} position="right" withArrow openDelay={300}>
                  <button
                    type="button"
                    className="rail-icon-btn active:scale-[0.96]"
                    onClick={openPeek}
                    aria-label={t('Scopes')}
                  >
                    <IconStack2 size={18} stroke={1.5} aria-hidden />
                  </button>
                </Tooltip>
                <Tooltip label={t('Settings')} position="right" withArrow openDelay={300}>
                  <button
                    type="button"
                    className="rail-icon-btn active:scale-[0.96]"
                    onClick={() => navigateToSettings()}
                    aria-label={t('Settings')}
                  >
                    <IconSettings size={18} stroke={1.5} aria-hidden />
                  </button>
                </Tooltip>
              </>
            ) : (
              <>
                <SidebarReviewRow variant="expanded" onNavigate={noNavigateEffect} />
                <button
                  type="button"
                  className="rail-nav-item"
                  onClick={() => {
                    setOpenSearchDialog(true)
                  }}
                >
                  <IconSearch size={18} stroke={1.5} aria-hidden />
                  <span>{t('Search')}</span>
                  <kbd className="rail-nav-kbd">⌘K</kbd>
                </button>
                <button type="button" className="rail-nav-item rail-nav-item--primary" onClick={handleCreateNewSession}>
                  <IconEdit size={18} stroke={1.5} aria-hidden />
                  <span>{t('New Chat')}</span>
                  <kbd className="rail-nav-kbd">⌘N</kbd>
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
                density="desktop"
              />
            </Box>
          )}

          {isIconRail && <Box className="flex-1 min-h-0" />}

          {/* Account footer — expand sits above user (chrome control, then identity) */}
          <div className={clsx('rail-foot', isIconRail && 'rail-foot--icon')}>
            {isIconRail && (
              <Tooltip label={railToggleLabel} position="right" withArrow openDelay={300}>
                <button
                  type="button"
                  className="rail-icon-btn rail-expand-btn active:scale-[0.96]"
                  onClick={handleExpandSidebar}
                  aria-label={railToggleLabel}
                  data-sidebar-toggle
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
                  leftSection={<IconSettings size={15} stroke={1.5} />}
                  rightSection={<em className="user-menu-kbd">⌘,</em>}
                  onClick={() => {
                    navigateToSettings()
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
                  }}
                >
                  {t('About')}
                </Menu.Item>

                {mode === 'wide' && (
                  <>
                    <Menu.Divider />
                    <Menu.Item
                      leftSection={
                        sidebarLayout === 'rail' ? (
                          <IconLayoutSidebarLeftExpand size={15} stroke={1.5} />
                        ) : (
                          <IconLayoutSidebarLeftCollapse size={15} stroke={1.5} />
                        )
                      }
                      onClick={sidebarLayout === 'rail' ? handleExpandSidebar : handleCollapseSidebar}
                    >
                      {sidebarLayout === 'rail' ? t('Expand sidebar') : t('Collapse to icons')}
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
                      }}
                    >
                      {t('Dev Tools')}
                    </Menu.Item>
                  </>
                )}
              </Menu.Dropdown>
            </Menu>
          </div>
          {presentation.show === 'expanded' && (
            <Box
              onMouseDown={handleResizeStart}
              onDoubleClick={handleCollapseSidebar}
              title={t('Drag to resize · double-click to collapse to icons')}
              className={clsx('sidebar-resizer', isResizing && 'is-resizing', language === 'ar' ? 'left-0' : 'right-0')}
            />
          )}
        </Stack>
      </Drawer>

      <NewScopeSheet
        opened={folderModalOpened}
        onClose={() => setFolderModalOpened(false)}
        onCreate={(input) => {
          const scope = addScope(input)
          setFolderModalOpened(false)
          void navigate({ to: '/scope/$scopeId', params: { scopeId: scope.id }, search: { tab: 'overview' } })
        }}
      />
    </>
  )
}
