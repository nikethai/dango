import { Box, Flex, Stack } from '@mantine/core'
import '@/components/settings/settings-surfaces.css'
import { createFileRoute, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'
import Page from '@/components/layout/Page'
import { SettingsBackButton, SettingsCloseButton } from '@/components/settings/SettingsChromeControls'
import { SettingsNav } from '@/components/settings/SettingsNav'
import { SettingsTabs } from '@/components/settings/SettingsTabs'
import { buildSettingsNav, findSettingsEntry } from '@/components/settings/settingsNav'
import { currentSettingsNavAvailability } from '@/components/settings/settingsNavAvailability'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { closeSettings } from '@/modals/Settings'
import { getSettingsParentPath } from '@/utils/settings-navigation'

export const Route = createFileRoute('/settings')({
  component: RouteComponent,
})

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false
  }
  const tag = target.tagName
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') {
    return true
  }
  if (target.isContentEditable) {
    return true
  }
  return Boolean(target.closest('[contenteditable="true"]'))
}

function hasOpenOverlay(): boolean {
  return Boolean(
    document.querySelector(
      '.mantine-Modal-root[data-mounted], .mantine-Drawer-root[data-mounted], [role="dialog"][aria-modal="true"]'
    )
  )
}

export function RouteComponent() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const routerState = useRouterState()
  const isSmallScreen = useIsSmallScreen()
  const pathname = routerState.location.pathname
  const parentPath = getSettingsParentPath(pathname)
  const showMobileBack = isSmallScreen && parentPath !== null

  const nav = useMemo(() => buildSettingsNav(currentSettingsNavAvailability()), [])
  const found = useMemo(() => findSettingsEntry(nav, pathname), [nav, pathname])
  const sectionLabel = found?.page.label ?? null

  const handleClose = useCallback(() => {
    closeSettings()
  }, [])

  const handleMobileBack = useCallback(() => {
    if (!parentPath) {
      closeSettings()
      return
    }
    void navigate({ to: parentPath as never })
  }, [navigate, parentPath])

  // ESC exits settings when not editing and no overlay is open
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) {
        return
      }
      if (isEditableTarget(e.target) || hasOpenOverlay()) {
        return
      }
      e.preventDefault()
      closeSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const title = (
    <div className="settings-chrome-title min-w-0">
      <span className="settings-chrome-title-main">{t('Settings')}</span>
      {sectionLabel && !isSmallScreen && (
        <>
          <span className="settings-chrome-title-sep" aria-hidden>
            /
          </span>
          <span className="settings-chrome-title-section">{t(sectionLabel)}</span>
        </>
      )}
    </div>
  )

  return (
    <Page
      title={title}
      className="settings-shell"
      headerClassName="settings-chrome-header"
      left={
        showMobileBack ? (
          <Flex align="center" mr="xs" className="controls">
            <SettingsBackButton onClick={handleMobileBack} />
          </Flex>
        ) : undefined
      }
      right={
        <Flex align="center" className="controls">
          <SettingsCloseButton onClick={handleClose} showEscHint={!isSmallScreen} />
        </Flex>
      }
    >
      <SettingsRoot />
      <Toaster richColors position="bottom-center" />
    </Page>
  )
}

export function SettingsRoot() {
  const routerState = useRouterState()
  const isSmallScreen = useIsSmallScreen()
  const pathname = routerState.location.pathname
  const nav = useMemo(() => buildSettingsNav(currentSettingsNavAvailability()), [])
  const entry = useMemo(() => findSettingsEntry(nav, pathname)?.entry ?? null, [nav, pathname])

  return (
    <Flex flex={1} h="100%" miw={isSmallScreen ? undefined : 0} className="settings-page min-h-0">
      {(!isSmallScreen || routerState.location.pathname === '/settings') && (
        <Stack
          p={isSmallScreen ? 0 : 'sm'}
          gap={isSmallScreen ? 0 : 2}
          w={isSmallScreen ? '100%' : 220}
          miw={isSmallScreen ? undefined : 200}
          maw={isSmallScreen ? undefined : 240}
          className={clsx(
            'settings-nav border-solid border-0 overflow-auto bg-[var(--chatbox-background-rail)]',
            isSmallScreen ? 'w-full border-r-0' : 'flex-none settings-nav-edge'
          )}
        >
          <SettingsNav nav={nav} pathname={pathname} compact={isSmallScreen} />
        </Stack>
      )}
      {!(isSmallScreen && routerState.location.pathname === '/settings') && (
        <Box flex="1 1 auto" miw={0} className="overflow-auto settings-content bg-[var(--chatbox-background-primary)]">
          {entry && <SettingsTabs entry={entry} pathname={pathname} />}
          <Outlet />
        </Box>
      )}
    </Flex>
  )
}
