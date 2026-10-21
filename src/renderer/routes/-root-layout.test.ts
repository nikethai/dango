import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('__root layout wiring (RS1, RS2)', () => {
  const root = read('routes/__root.tsx')

  it('gives the content box id="main" and tabIndex -1 (sheet focus fallback)', () => {
    expect(root).toMatch(/<Box id="main" tabIndex=\{-1\}/)
  })

  it('insets the content from the sidebar presentation in at most 150 ms, with no motion when reduced', () => {
    // dg-content: dango-layout.css stops its transition under reduced motion too (A11Y1 rule 2).
    expect(root).toContain('className="dg-content h-full w-full min-h-0"')
    expect(root).toContain('useSidebarEffectiveWidth()')
    expect(root).toContain("transition: 'padding 150ms")
    expect(root).toContain("'@media (prefers-reduced-motion: reduce)': { transition: 'none' }")
    expect(root).not.toContain('220ms')
  })

  it('turns data-layout off in the Quick Chat window only; first run keeps it (44 px phone targets)', () => {
    expect(root).toContain('useLayoutMode()')
    expect(root).toContain('const suppressLayoutAttribute = isQuickRoute')
    expect(root).not.toContain('isQuickRoute || isFirstRunRoute')
    expect(root).toContain('setLayoutAttributeSuppressed(suppressLayoutAttribute)')
  })
})

describe('first run without a Review flash (M1)', () => {
  const root = read('routes/__root.tsx')

  it('paints nothing in place of the page, and no chrome, while the redirect is pending or its route loads', () => {
    expect(root).toContain('const firstRunPending = useFirstRunGate(location.pathname, goToFirstRun, firstRunFromPath)')
    expect(root).toContain('useRouterState({ select: (s) => s.matches.some((m) => m.routeId === FIRST_RUN_PATH) })')
    expect(root).toContain('const holdForFirstRun = firstRunPending || (isFirstRunRoute && !firstRunMatched)')
    expect(root).toContain('{holdForFirstRun ? null : <Outlet />}')
    expect(root).toContain('const hideAppChrome = isSettingsRoute || isFirstRunRoute || holdForFirstRun')
    expect(root).toContain('{!isFirstRunRoute && !holdForFirstRun && <PhoneTabBar />}')
  })

  it('preloads the first-run route while the redirect is pending', () => {
    expect(root).toMatch(/if \(firstRunPending\) void router\.preloadRoute\(\{ to: FIRST_RUN_PATH \}\)/)
  })
})

describe('sidebar toggles', () => {
  it('⌘\\ does nothing where no sidebar is shown (first run, Settings, Quick Chat, phone) (M8)', () => {
    const root = read('routes/__root.tsx')
    expect(root).toContain('setSidebarShown(!isQuickRoute && !hideAppChrome && !isPhoneLayout)')
  })

  it('Header, Page and the rail foot share one toggle label (M3)', () => {
    for (const file of ['components/layout/Header.tsx', 'components/layout/Page.tsx', 'Sidebar.tsx']) {
      const src = read(file)
      expect(src, file).toContain('sidebarToggleLabel(t, ')
      expect(src, file).not.toMatch(/railPeek \? t\('Hide sidebar'\)/)
    }
  })

  it('Header and Page show the toggle at medium and wide-rail only, never at phone', () => {
    for (const file of ['components/layout/Header.tsx', 'components/layout/Page.tsx']) {
      const src = read(file)
      expect(src, file).toContain("layoutMode === 'medium' || (layoutMode === 'wide' && sidebarLayout === 'rail')")
      expect(src, file).toContain('toggleSidebar(layoutMode)')
      // Hidden where no sidebar is shown (Settings at medium had a toggle that did nothing).
      expect(src, file).toContain('const sidebarShown = useSidebarShown()')
      expect(src, file).toMatch(/sidebarShown &&/)
      expect(src, file).not.toContain('getSidebarToggleResult')
    }
  })

  it('⌘\\ toggles the sidebar', () => {
    const src = read('hooks/useShortcut.tsx')
    expect(src).toContain("(e.key === '\\\\' || e.code === 'Backslash') && ctrlKey")
    expect(src).toContain('toggleSidebar()')
  })

  it('useIsSmallScreen follows the layout mode, not the MUI sm breakpoint', () => {
    const src = read('hooks/useScreenChange.ts')
    expect(src).not.toMatch(/breakpoints\.down\('sm'\)/)
    expect(src).toContain("return useLayoutMode() === 'phone'")
  })
})

describe('phone shell (RS3)', () => {
  const root = read('routes/__root.tsx')

  it('drops the sidebar at phone and renders the tab bar after the content box, never on first run', () => {
    expect(root).toContain("const isPhoneLayout = layoutMode === 'phone'")
    expect(root).toContain('{!hideAppChrome && !isPhoneLayout && <Sidebar />}')
    const content = root.indexOf('<Box id="main"')
    const tabBar = root.indexOf('{!isFirstRunRoute && !holdForFirstRun && <PhoneTabBar />}')
    expect(content).toBeGreaterThan(-1)
    expect(tabBar).toBeGreaterThan(content)
    // Only in the main-window branch: the Quick Chat branch comes first and never gets it.
    expect(root.indexOf('<PhoneTabBar />')).toBeGreaterThan(root.indexOf('isQuickRoute ? ('))
  })

  it('marks the on-screen keyboard on <html> beside the existing safe-area writes', () => {
    const capacitor = read('setup/mobile_safe_area.ts')
    expect(capacitor).toMatch(/keyboardWillShow[\s\S]{0,200}document\.documentElement\.dataset\.keyboard = 'open'/)
    expect(capacitor).toMatch(/keyboardWillHide[\s\S]{0,120}delete document\.documentElement\.dataset\.keyboard/)
    // Behaviour (focus only, baseline reset on rotation, cleared on blur) is in setup/tauri_android_keyboard.test.ts.
    const android = read('setup/tauri_android_keyboard.ts')
    expect(android).toContain("root.dataset.keyboard = 'open'")
    expect(android).toContain('delete root.dataset.keyboard')
  })
})

describe('Sidebar is medium and wide only (RS3)', () => {
  it('keeps no phone drawer: never temporary, no swipe drawer, no phone-only header', () => {
    const src = read('Sidebar.tsx')
    expect(src).not.toContain('SwipeableDrawer')
    expect(src).not.toContain("'temporary'")
    expect(src).not.toContain('closeSidebarIfMobile')
    expect(src).not.toContain('rail-mobile-title')
    expect(src).toContain('variant="persistent"')
  })
})
