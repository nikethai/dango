import { Theme } from '@shared/types'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import Toasts from '@/components/common/Toasts'
import { MemoryMigrationSheet } from '@/components/knowledge/MemoryMigrationSheet'
import ExitFullscreenButton from '@/components/layout/ExitFullscreenButton'
import { registerChangeOpener } from '@/components/review/changeOpener'
import { registerDefaultQuestionOpener } from '@/components/review/questionOpener'
import useAppTheme from '@/hooks/useAppTheme'
import { useSystemLanguageWhenInit } from '@/hooks/useDefaultSystemLanguage'
import { useDesktopShell } from '@/hooks/useDesktopShell'
import { useI18nEffect } from '@/hooks/useI18nEffect'
import useNeedRoomForWinControls from '@/hooks/useNeedRoomForWinControls'
import { useIsSmallScreen, useSidebarEffectiveWidth } from '@/hooks/useScreenChange'
import useShortcut from '@/hooks/useShortcut'
import '@/modals'
import NiceModal from '@ebay/nice-modal-react'
import { MantineProvider, useMantineColorScheme } from '@mantine/core'
import Box from '@mui/material/Box'
import CssBaseline from '@mui/material/CssBaseline'
import Grid from '@mui/material/Grid'
import { ThemeProvider } from '@mui/material/styles'
import { createRootRoute, Outlet, useLocation } from '@tanstack/react-router'
import { useSetAtom } from 'jotai'
import { useEffect, useMemo, useRef, useState } from 'react'
import { navigateToSettings } from '@/modals/Settings'
import { initKnowledge } from '@/packages/knowledge'
import { getOS } from '@/packages/navigator'
import { UndoToast, useUndoHotkey } from '@/packages/undo'
import PictureDialog from '@/pages/PictureDialog'
import RemoteDialogWindow from '@/pages/RemoteDialogWindow'
import SearchDialog from '@/pages/SearchDialog'
import platform from '@/platform'
import { router } from '@/router'
import Sidebar from '@/Sidebar'
import * as atoms from '@/stores/atoms'
import * as settingActions from '@/stores/settingActions'
import { settingsStore, useLanguage, useSettingsStore, useTheme } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { createDangoMantineTheme, dangoCssVariablesResolver } from '@/theme/mantineTheme'

function Root() {
  const location = useLocation()
  const spellCheck = useSettingsStore((state) => state.spellCheck)
  const language = useLanguage()
  const initialized = useRef(false)
  const [isQuickWindow, setIsQuickWindow] = useState(false)

  const setOpenAboutDialog = useUIStore((s) => s.setOpenAboutDialog)

  const setRemoteConfig = useSetAtom(atoms.remoteConfigAtom)

  useDesktopShell()

  useEffect(() => {
    void initKnowledge()
  }, [])
  // Review's default 'question' opener, app-wide (slice 10 may replace it).
  useEffect(() => registerDefaultQuestionOpener(), [])
  // Change rows from a finished plan open the chat they came from (slice 6a).
  useEffect(() => registerChangeOpener(), [])

  useEffect(() => {
    void platform.getWindowLabel?.().then((label) => {
      setIsQuickWindow(label === 'quick')
    })
  }, [])

  useEffect(() => {
    if (initialized.current) {
      return
    }
    // Delay startup until async settings storage has loaded
    const tid = setTimeout(() => {
      // biome-ignore lint/nursery/noFloatingPromises: inline call
      ;(async () => {
        setRemoteConfig((conf) => ({ ...conf }))
        // (legacy comment removed)
        initialized.current = true
        if (settingActions.needEditSetting() && location.pathname !== '/settings/mcp') {
          await NiceModal.show('welcome')
          return
        }
        // (legacy comment removed)
        // (legacy comment removed)
        const shouldShowAboutDialogWhenStartUp = await platform.shouldShowAboutDialogWhenStartUp()
        if (shouldShowAboutDialogWhenStartUp) {
          setOpenAboutDialog(true)
          return
        }
      })()
    }, 2000)

    return () => clearTimeout(tid)
  }, [setOpenAboutDialog, setRemoteConfig, location.pathname])

  const showSidebar = useUIStore((s) => s.showSidebar)
  const sidebarWidth = useSidebarEffectiveWidth()
  const isSmallScreen = useIsSmallScreen()
  const isSettingsRoute = location.pathname === '/settings' || location.pathname.startsWith('/settings/')
  // Settings owns its own navigation; keep the global chat sidebar out of this page.
  const offsetMainForSidebar = !isSettingsRoute && (isSmallScreen ? showSidebar : true)

  // Legacy deep links used ?settings=/settings/...; rewrite to full-page /settings/* routes
  useEffect(() => {
    const settingsPath = (location.search as { settings?: string })?.settings
    if (typeof settingsPath === 'string' && settingsPath.length > 0) {
      const path = settingsPath.startsWith('/') ? settingsPath : `/${settingsPath}`
      void router.navigate({
        to: path.startsWith('/settings') ? path : `/settings${path}`,
        replace: true,
      })
    }
  }, [location.search])

  const _theme = useTheme()
  const { setColorScheme } = useMantineColorScheme()
  // biome-ignore lint/correctness/useExhaustiveDependencies: setColorScheme is stable
  useEffect(() => {
    if (_theme === Theme.Dark) {
      setColorScheme('dark')
    } else if (_theme === Theme.Light) {
      setColorScheme('light')
    } else {
      setColorScheme('auto')
    }
  }, [_theme])

  useEffect(() => {
    ;(() => {
      const { startupPage } = settingsStore.getState()
      const sid = JSON.parse(localStorage.getItem('_currentSessionIdCachedAtom') || '""') as string
      if (sid && startupPage === 'session') {
        router.navigate({
          to: `/session/${sid}`,
          replace: true,
        })
      }
    })()
  }, [])

  useEffect(() => {
    if (platform.onNavigate) {
      // (legacy comment)
      return platform.onNavigate((path) => {
        // Keep platform navigations aligned with in-app settings entry (full-page routes)
        if (path.startsWith('/settings')) {
          const settingsPath = path.substring('/settings'.length)
          navigateToSettings(settingsPath || '/')
        } else {
          router.navigate({ to: path })
        }
      })
    }
  }, [])

  const { needRoomForMacWindowControls } = useNeedRoomForWinControls()
  useEffect(() => {
    if (needRoomForMacWindowControls) {
      document.documentElement.setAttribute('data-need-room-for-mac-controls', 'true')
    } else {
      document.documentElement.removeAttribute('data-need-room-for-mac-controls')
    }
  }, [needRoomForMacWindowControls])

  const isQuickRoute = isQuickWindow || location.pathname === '/quick'

  return (
    <Box
      className="box-border App"
      spellCheck={spellCheck}
      dir={language === 'ar' ? 'rtl' : 'ltr'}
      sx={{
        height: '100%',
        backgroundColor: 'var(--chatbox-background-primary)',
        color: 'var(--chatbox-tint-primary)',
      }}
    >
      {platform.type === 'desktop' && !isQuickRoute && (getOS() === 'Windows' || getOS() === 'Linux') && (
        <ExitFullscreenButton />
      )}
      {isQuickRoute ? (
        <ErrorBoundary name="quick">
          <Box className="h-full min-h-0 flex flex-col flex-1">
            <Outlet />
          </Box>
        </ErrorBoundary>
      ) : (
        <Grid container className="h-full" sx={{ minHeight: 0 }}>
          {!isSettingsRoute && <Sidebar />}
          <Box
            className="h-full w-full min-h-0"
            sx={{
              flexGrow: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              backgroundColor: 'var(--chatbox-background-primary)',
              ...(offsetMainForSidebar
                ? language === 'ar'
                  ? {
                      paddingRight: { sm: `${sidebarWidth}px` },
                      transition: 'padding 220ms cubic-bezier(0.2, 0, 0, 1)',
                    }
                  : { paddingLeft: { sm: `${sidebarWidth}px` }, transition: 'padding 220ms cubic-bezier(0.2, 0, 0, 1)' }
                : {}),
            }}
          >
            <ErrorBoundary name="main">
              <Box className="h-full min-h-0 flex flex-col flex-1">
                <Outlet />
              </Box>
            </ErrorBoundary>
          </Box>
        </Grid>
      )}
      {/* Session settings */}
      {/* <AppStoreRatingDialog /> */}
      {/* Code preview */}
      {/* <ArtifactDialog /> */}
      {/* Session list cleanup */}
      {/* <ChatConfigWindow /> */}
      {/* Possibly unused */}
      {/* <CleanWidnow /> */}
      {/* Session list cleanup */}
      {/* <ClearConversationListWindow /> */}
      {/* Export chat */}
      {/* <ExportChatDialog /> */}
      {/* Edit message */}
      {/* <MessageEditDialog /> */}
      {/* Add link */}
      {/* <OpenAttachLinkDialog /> */}
      {/* Image preview */}
      <PictureDialog />
      {/* Remote dialog config */}
      <RemoteDialogWindow />
      {/* Mobile report content */}
      {/* <ReportContentDialog /> */}
      {/* Search */}
      <SearchDialog />
      {/* One-time move of old memory into knowledge (not in Quick Chat) */}
      {isQuickRoute ? null : <MemoryMigrationSheet />}
      {/* Welcome when no model configured */}
      {/* <WelcomeDialog /> */}
      <Toasts /> {/* mui */}
      <UndoToast />
    </Box>
  )
}

export const Route = createRootRoute({
  component: () => {
    useI18nEffect()
    useSystemLanguageWhenInit()
    useShortcut()
    useUndoHotkey()
    const theme = useAppTheme()
    const _theme = useTheme()
    const fontSize = useSettingsStore((state) => state.fontSize)
    const scale = fontSize / 14
    const mantineTheme = useMemo(() => createDangoMantineTheme(scale), [scale])

    // Brand accent is locked to the Dango design tokens (green). Do not apply user accentColor overrides.

    return (
      <MantineProvider
        theme={mantineTheme}
        cssVariablesResolver={dangoCssVariablesResolver}
        defaultColorScheme={_theme === Theme.Dark ? 'dark' : _theme === Theme.Light ? 'light' : 'auto'}
      >
        <ThemeProvider theme={theme}>
          <CssBaseline />
          <NiceModal.Provider>
            <ErrorBoundary>
              <Root />
            </ErrorBoundary>
          </NiceModal.Provider>
        </ThemeProvider>
      </MantineProvider>
    )
  },
})
