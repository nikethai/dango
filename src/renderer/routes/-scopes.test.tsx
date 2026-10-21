// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import type { ComponentType } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  mode: 'phone' as 'wide' | 'medium' | 'phone',
  navigate: vi.fn(),
  density: undefined as string | undefined,
  scopesOpen: undefined as boolean | undefined,
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
  default: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <section>
      <h1>{title}</h1>
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

import { Route } from './scopes'

const ScopesPage = Route.options.component as ComponentType

beforeEach(() => {
  h.mode = 'phone'
  h.density = undefined
})
afterEach(cleanup)

describe('/scopes (the phone Scopes tab)', () => {
  it('at phone shows the session list (Everywhere, scopes, chats) at mobile density', () => {
    render(<ScopesPage />)
    expect(screen.getByRole('heading', { name: 'Scopes' })).toBeTruthy()
    expect(screen.getByTestId('session-list')).toBeTruthy()
    expect(h.density).toBe('mobile')
    // Everywhere and the scopes are the point of this tab: their section starts open.
    expect(h.scopesOpen).toBe(true)
    expect(screen.queryByTestId('redirect')).toBeNull()
  })

  it.each(['medium', 'wide'] as const)('redirects to / at %s', (mode) => {
    h.mode = mode
    render(<ScopesPage />)
    expect(screen.getByTestId('redirect').textContent).toBe('/')
    expect(screen.queryByTestId('session-list')).toBeNull()
  })
})
