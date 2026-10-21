// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  mode: 'phone' as 'wide' | 'medium' | 'phone',
  pathname: '/',
  sessions: undefined as Array<{ id: string }> | undefined,
}))

vi.mock('@tanstack/react-router', () => ({
  useLocation: (opts?: { select?: (l: { pathname: string }) => unknown }) =>
    opts?.select ? opts.select({ pathname: h.pathname }) : { pathname: h.pathname },
  Link: ({
    to,
    params,
    children,
    ...rest
  }: {
    to: string
    params?: Record<string, string>
    children?: ReactNode
  } & Record<string, unknown>) => {
    let href = to
    for (const [k, v] of Object.entries(params ?? {})) href = href.replace(`$${k}`, v)
    return (
      <a href={href} {...rest}>
        {children}
      </a>
    )
  },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? '')),
  }),
}))
vi.mock('@/hooks/useLayoutMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useLayoutMode')>()
  return { ...actual, useLayoutMode: () => h.mode }
})
vi.mock('@/packages/review/hooks', () => ({ useReviewWaitingCount: () => 2 }))
vi.mock('@/stores/chatStore', () => ({ useSessionList: () => ({ sessionMetaList: h.sessions }) }))

import { PHONE_TABS, PhoneTabBar } from './PhoneTabBar'

beforeEach(() => {
  h.mode = 'phone'
  h.pathname = '/'
  h.sessions = undefined
})
afterEach(cleanup)

const nav = () => screen.getByRole('navigation', { name: 'Main' })
const link = (name: string | RegExp) => within(nav()).getByRole('link', { name })

describe('PhoneTabBar (RS3)', () => {
  it('marks <html> with data-tabbar only while it shows (phone), and clears it on unmount', () => {
    const root = document.documentElement
    const { unmount } = render(<PhoneTabBar />)
    expect(root.dataset.tabbar).toBe('1')
    unmount()
    expect(root.dataset.tabbar).toBeUndefined()
    h.mode = 'medium'
    render(<PhoneTabBar />)
    expect(root.dataset.tabbar).toBeUndefined()
  })

  it('is a nav named Main with Review, Chat, Scopes and Settings in that order', () => {
    render(<PhoneTabBar />)
    const names = within(nav())
      .getAllByRole('link')
      .map((a) => a.getAttribute('aria-label') ?? a.textContent)
    expect(names).toEqual(['Review, 2 waiting', 'Chat', 'Scopes', 'Settings'])
  })

  it('marks Chat current at /session/abc and at /new', () => {
    h.pathname = '/session/abc'
    const { unmount } = render(<PhoneTabBar />)
    expect(link('Chat').getAttribute('aria-current')).toBe('page')
    expect(link(/^Review/).getAttribute('aria-current')).toBeNull()
    unmount()
    h.pathname = '/new'
    render(<PhoneTabBar />)
    expect(link('Chat').getAttribute('aria-current')).toBe('page')
  })

  it('marks Scopes current at /scope/acme', () => {
    h.pathname = '/scope/acme'
    render(<PhoneTabBar />)
    expect(link('Scopes').getAttribute('aria-current')).toBe('page')
    expect(link('Chat').getAttribute('aria-current')).toBeNull()
  })

  it('shows the waiting count on Review, whose name is "Review, 2 waiting"', () => {
    render(<PhoneTabBar />)
    const review = link('Review, 2 waiting')
    expect(review.textContent).toContain('2')
    expect(review.getAttribute('aria-current')).toBe('page')
  })

  it('renders nothing at medium', () => {
    h.mode = 'medium'
    const { container } = render(<PhoneTabBar />)
    expect(container.innerHTML).toBe('')
  })

  describe('Chat target', () => {
    // The last chat is module state seeded once from storage; each case loads a fresh module.
    const freshBar = async () => {
      vi.resetModules()
      return (await import('./PhoneTabBar')).PhoneTabBar
    }
    afterEach(() => localStorage.clear())

    it('is /new with no chat yet, then the chat this window last showed', async () => {
      const Bar = await freshBar()
      const { rerender } = render(<Bar />)
      expect(link('Chat').getAttribute('href')).toBe('/new')
      h.pathname = '/session/abc'
      rerender(<Bar />)
      h.pathname = '/'
      rerender(<Bar />)
      expect(link('Chat').getAttribute('href')).toBe('/session/abc')
    })

    it('starts from the stored chat (what the window reopens with)', async () => {
      localStorage.setItem('_currentSessionIdCachedAtom', JSON.stringify('stored1'))
      const Bar = await freshBar()
      render(<Bar />)
      expect(link('Chat').getAttribute('href')).toBe('/session/stored1')
    })

    it('ignores a Quick Chat session written later from the quick window', async () => {
      const Bar = await freshBar()
      h.pathname = '/session/abc'
      const { rerender } = render(<Bar />)
      // The quick window writes the shared atom's storage key.
      localStorage.setItem('_currentSessionIdCachedAtom', JSON.stringify('quick1'))
      window.dispatchEvent(new StorageEvent('storage', { key: '_currentSessionIdCachedAtom' }))
      h.pathname = '/'
      rerender(<Bar />)
      expect(link('Chat').getAttribute('href')).toBe('/session/abc')
    })

    it('falls back to /new once the last chat is deleted', async () => {
      const Bar = await freshBar()
      h.pathname = '/session/abc'
      const { rerender } = render(<Bar />)
      h.pathname = '/'
      h.sessions = [{ id: 'other' }]
      rerender(<Bar />)
      expect(link('Chat').getAttribute('href')).toBe('/new')
    })
  })

  it('PHONE_TABS match their paths', () => {
    const tab = (id: string) => {
      const found = PHONE_TABS.find((t) => t.id === id)
      if (!found) throw new Error(`no tab ${id}`)
      return found
    }
    expect(PHONE_TABS.map((t) => [t.id, t.to])).toEqual([
      ['review', '/'],
      ['chat', '/new'],
      ['scopes', '/scopes'],
      ['settings', '/settings'],
    ])
    expect(tab('review').match('/')).toBe(true)
    expect(tab('review').match('/scopes')).toBe(false)
    expect(tab('chat').match('/session/x')).toBe(true)
    expect(tab('chat').match('/new')).toBe(true)
    expect(tab('scopes').match('/scopes')).toBe(true)
    expect(tab('scopes').match('/scope/acme')).toBe(true)
    expect(tab('settings').match('/settings')).toBe(true)
    expect(tab('settings').match('/settings/provider')).toBe(true)
  })
})
