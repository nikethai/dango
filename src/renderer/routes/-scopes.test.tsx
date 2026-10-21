// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  mode: 'phone' as 'wide' | 'medium' | 'phone',
  navigate: vi.fn(),
  density: undefined as string | undefined,
  scopesOpen: undefined as boolean | undefined,
  setOpenSearchDialog: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({ options: opts }),
  Navigate: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
  useNavigate: () => h.navigate,
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@/hooks/useLayoutMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useLayoutMode')>()
  return { ...actual, useLayoutMode: () => h.mode }
})
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ addScope: vi.fn() }) }))
vi.mock('@/components/layout/Page', () => ({
  default: ({
    title,
    left,
    right,
    children,
  }: {
    title: string
    left?: React.ReactNode
    right?: React.ReactNode
    children: React.ReactNode
  }) => (
    <section>
      {left}
      <h1>{title}</h1>
      {right}
      {children}
    </section>
  ),
}))
vi.mock('@/components/session/SessionList', () => ({
  default: ({ density, scopesOpen }: { density?: string; scopesOpen?: boolean }) => {
    h.density = density
    h.scopesOpen = scopesOpen
    return <div data-testid="session-list" />
  },
}))
vi.mock('@/components/scope', () => ({ NewScopeSheet: () => null }))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (sel: (s: { setOpenSearchDialog: (open: boolean) => void }) => unknown) =>
    sel({ setOpenSearchDialog: h.setOpenSearchDialog }),
}))
vi.mock('@/hooks/useVersion', () => ({ default: () => ({ version: '1.0.0', needCheckUpdate: false }) }))

import { createDangoMantineTheme } from '@/theme/mantineTheme'
import { Route } from './scopes'

const ScopesPage = Route.options.component as ComponentType

const renderPage = () =>
  render(
    <MantineProvider theme={createDangoMantineTheme()}>
      <ScopesPage />
    </MantineProvider>
  )

beforeEach(() => {
  // Mantine's colour scheme reads matchMedia, which jsdom lacks.
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
  h.navigate.mockReset()
  h.setOpenSearchDialog.mockReset()
  h.mode = 'phone'
  h.density = undefined
})
afterEach(cleanup)

describe('/scopes (the phone Scopes tab)', () => {
  it('at phone shows the session list (Everywhere, scopes, chats) at mobile density', () => {
    renderPage()
    expect(screen.getByRole('heading', { name: 'Scopes' })).toBeTruthy()
    expect(screen.getByTestId('session-list')).toBeTruthy()
    expect(h.density).toBe('mobile')
    // Everywhere and the scopes are the point of this tab: their section starts open.
    expect(h.scopesOpen).toBe(true)
    expect(screen.queryByTestId('redirect')).toBeNull()
  })

  it('Search in the header opens the search overlay (the old drawer had it; RS3 has no Search tab)', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(h.setOpenSearchDialog).toHaveBeenCalledWith(true)
  })

  it('About in the header opens /about (version, updates, source link)', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'About' }))
    expect(h.navigate).toHaveBeenCalledWith({ to: '/about' })
  })

  it.each(['medium', 'wide'] as const)('redirects to / at %s', (mode) => {
    h.mode = mode
    renderPage()
    expect(screen.getByTestId('redirect').textContent).toBe('/')
    expect(screen.queryByTestId('session-list')).toBeNull()
  })
})
