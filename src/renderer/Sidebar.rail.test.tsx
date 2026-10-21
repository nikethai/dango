// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'

const h = vi.hoisted(() => ({
  mode: 'medium' as 'wide' | 'medium' | 'phone',
  pathname: '/',
  navigate: vi.fn(),
  navigateToSettings: vi.fn(),
  setOpenSearchDialog: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => h.navigate,
  useLocation: (opts?: { select?: (l: { pathname: string }) => unknown }) =>
    opts?.select ? opts.select({ pathname: h.pathname }) : { pathname: h.pathname },
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useLayoutMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useLayoutMode')>()
  return { ...actual, useLayoutMode: () => h.mode }
})
vi.mock('./hooks/useScreenChange', () => ({
  SIDEBAR_ICON_RAIL_WIDTH: 56,
  useSidebarWidth: () => 220,
}))
vi.mock('./hooks/useVersion', () => ({ default: () => ({ version: '1.0.0', needCheckUpdate: false }) }))
vi.mock('./hooks/useScopes', () => ({ useScopes: () => ({ addScope: vi.fn() }) }))
vi.mock('./components/session/SessionList', () => ({ default: () => <div data-testid="session-list" /> }))
vi.mock('./components/scope', () => ({ NewScopeSheet: () => null }))
vi.mock('./components/brand/DangoWordmark', () => ({ default: () => <span>Dango</span> }))
vi.mock('./components/dev/ThemeSwitchButton', () => ({ default: () => null }))
vi.mock('./components/common/Avatar', () => ({ UserAvatar: () => <span /> }))
vi.mock('./components/layout/TitleBarRow', () => ({
  default: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}))
vi.mock('./components/review/SidebarReviewRow', async () => {
  const { forwardRef } = await import('react')
  return {
    SidebarReviewRow: forwardRef<HTMLButtonElement, { variant: string }>(function Row({ variant }, ref) {
      return (
        <button ref={ref} type="button" aria-label="Review" data-variant={variant}>
          Review
        </button>
      )
    }),
  }
})
vi.mock('./lib/startNewChat', () => ({ startNewChat: vi.fn() }))
vi.mock('./modals/Settings', () => ({ navigateToSettings: h.navigateToSettings }))
vi.mock('./packages/event', () => ({ trackingEvent: vi.fn() }))
vi.mock('./stores/settingsStore', () => ({
  useLanguage: () => 'en',
  useSettingsStore: (sel: (s: { userAvatarKey?: string }) => unknown) => sel({}),
}))

import Sidebar from './Sidebar'
import { uiStore } from './stores/uiStore'

function renderSidebar() {
  return render(
    <MantineProvider theme={createDangoMantineTheme()}>
      <Sidebar />
    </MantineProvider>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  h.mode = 'medium'
  h.pathname = '/'
  h.navigateToSettings.mockReset()
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }))
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
  uiStore.setState({ railPeek: false, sidebarLayout: 'expanded', showSidebar: true })
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const RAIL_LABELS = ['Review', 'Search', 'Chats', 'Scopes', 'Settings']

describe('Sidebar rail (RS2)', () => {
  it('shows five labelled 40 px rail buttons in order at medium, whatever the saved layout', () => {
    renderSidebar()
    const nav = screen.getByRole('navigation', { name: 'Navigation' })
    const buttons = Array.from(nav.querySelectorAll('button'))
    expect(buttons.map((b) => b.getAttribute('aria-label'))).toEqual(RAIL_LABELS)
    for (const b of buttons.slice(1)) expect(b.classList.contains('rail-icon-btn')).toBe(true)
    expect(screen.queryByTestId('session-list')).toBeNull()
  })

  it('shows the same five at wide when collapsed to the rail', () => {
    h.mode = 'wide'
    uiStore.setState({ sidebarLayout: 'rail' })
    renderSidebar()
    const nav = screen.getByRole('navigation', { name: 'Navigation' })
    expect(Array.from(nav.querySelectorAll('button')).map((b) => b.getAttribute('aria-label'))).toEqual(RAIL_LABELS)
  })

  it('Chats and Scopes open the peek; Settings goes to Settings', () => {
    renderSidebar()
    fireEvent.click(screen.getByRole('button', { name: 'Chats' }))
    expect(uiStore.getState().railPeek).toBe(true)
    act(() => uiStore.setState({ railPeek: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Scopes' }))
    expect(uiStore.getState().railPeek).toBe(true)
    act(() => uiStore.setState({ railPeek: false }))
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(h.navigateToSettings).toHaveBeenCalled()
  })

  it('the peek shows the session list and New chat over the content', () => {
    uiStore.setState({ railPeek: true })
    renderSidebar()
    expect(screen.getByTestId('session-list')).toBeTruthy()
    expect(screen.getByRole('button', { name: /New Chat/ })).toBeTruthy()
    expect(document.querySelector('.dg-rail-peek')).not.toBeNull()
  })

  it('keeps keyboard focus inside the sidebar when Chats opens the peek and when Esc closes it', () => {
    renderSidebar()
    const chats = screen.getByRole('button', { name: 'Chats' })
    chats.focus()
    fireEvent.click(chats)
    const rail = document.querySelector('.studio-rail') as HTMLElement
    expect(document.activeElement).not.toBe(document.body)
    expect(rail.contains(document.activeElement)).toBe(true)
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' })
    expect(uiStore.getState().railPeek).toBe(false)
    expect(rail.contains(document.activeElement)).toBe(true)
  })

  it('opens on hover after 300 ms and closes on mouse leave', () => {
    renderSidebar()
    const rail = document.querySelector('.studio-rail') as HTMLElement
    fireEvent.mouseEnter(rail)
    act(() => vi.advanceTimersByTime(299))
    expect(uiStore.getState().railPeek).toBe(false)
    act(() => vi.advanceTimersByTime(1))
    expect(uiStore.getState().railPeek).toBe(true)
    fireEvent.mouseLeave(document.querySelector('.studio-rail') as HTMLElement)
    expect(uiStore.getState().railPeek).toBe(false)
  })

  it('a quick pass over the rail does not open it', () => {
    renderSidebar()
    const rail = document.querySelector('.studio-rail') as HTMLElement
    fireEvent.mouseEnter(rail)
    act(() => vi.advanceTimersByTime(100))
    fireEvent.mouseLeave(rail)
    act(() => vi.advanceTimersByTime(500))
    expect(uiStore.getState().railPeek).toBe(false)
  })

  it('Esc closes the peek', () => {
    uiStore.setState({ railPeek: true })
    renderSidebar()
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(uiStore.getState().railPeek).toBe(false)
  })

  it('navigation closes the peek', () => {
    const view = renderSidebar()
    act(() => uiStore.setState({ railPeek: true }))
    h.pathname = '/session/abc'
    view.rerender(
      <MantineProvider theme={createDangoMantineTheme()}>
        <Sidebar />
      </MantineProvider>
    )
    expect(uiStore.getState().railPeek).toBe(false)
  })

  it('wide + expanded shows the full sidebar with no peek class even if a peek was left open', () => {
    h.mode = 'wide'
    uiStore.setState({ railPeek: true })
    renderSidebar()
    expect(screen.getByTestId('session-list')).toBeTruthy()
    expect(document.querySelector('.dg-rail-peek')).toBeNull()
  })
})
