/**
 * @vitest-environment jsdom
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ open: vi.fn(), startNewChat: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts ? key.replace(/\{\{(\w+)\}\}/g, (_, k: string) => opts[k] ?? '') : key,
  }),
}))
vi.mock('@/hooks/useScopes', () => ({
  useScopes: () => ({
    scopes: [
      { id: 'everywhere', name: 'Everywhere' },
      { id: 'p1', name: 'Acme' },
      { id: 'p2', name: 'Beta' },
    ],
  }),
}))
vi.mock('@/components/settings/useTrustSheet', () => ({
  useTrustSheet: () => ({ open: h.open, sheet: <div data-testid="trust-sheet" /> }),
}))
vi.mock('@/lib/startNewChat', () => ({ startNewChat: h.startNewChat }))
// The ⌘N hint must follow the platform: this file runs as Windows, where the shortcut is Ctrl+N.
vi.mock('@/packages/navigator', () => ({ getOS: () => 'Windows' }))
vi.mock('@/stores/settingsStore', async () => {
  const { createStore: create } = await import('zustand/vanilla')
  const { useStore } = await import('zustand')
  const settingsStore = create<{ trustLevel: unknown; setSettings: (v: { trustLevel: unknown }) => void }>((set) => ({
    trustLevel: undefined,
    setSettings: (v) => set(v),
  }))
  return {
    settingsStore,
    useSettingsStore: <U,>(selector: (s: ReturnType<typeof settingsStore.getState>) => U) =>
      useStore(settingsStore, selector),
  }
})

import { settingsStore } from '@/stores/settingsStore'
import { ReviewToolbar } from './ReviewToolbar'

const store = settingsStore as unknown as {
  getState: () => { setSettings: (v: { trustLevel: unknown }) => void }
  setState: (v: { trustLevel: unknown }) => void
}

beforeEach(() => {
  h.open.mockClear()
  h.startNewChat.mockClear()
  store.setState({ trustLevel: undefined })
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('ReviewToolbar', () => {
  it('lists All scopes, Everywhere and the scopes; choosing calls onScopeChange', () => {
    const onScopeChange = vi.fn()
    render(<ReviewToolbar onScopeChange={onScopeChange} />)
    fireEvent.click(screen.getByRole('button', { name: /All scopes/ }))
    const items = screen.getAllByRole('menuitemradio').map((el) => el.textContent?.trim())
    expect(items).toEqual(['All scopes', 'Everywhere', 'Acme', 'Beta'])
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Acme' }))
    expect(onScopeChange).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByRole('button', { name: /All scopes/ }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'All scopes' }))
    expect(onScopeChange).toHaveBeenLastCalledWith(undefined)
  })

  it('the scope button shows the chosen name', () => {
    render(<ReviewToolbar scopeId="p2" onScopeChange={() => {}} />)
    expect(screen.getByRole('button', { name: /Beta/ })).toBeTruthy()
  })

  it('Trust reads Auto with no setting and opens the sheet', () => {
    render(<ReviewToolbar onScopeChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'Trust: Auto' }))
    expect(h.open).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('trust-sheet')).toBeTruthy()
  })

  it('Trust label follows the setting reactively', () => {
    render(<ReviewToolbar onScopeChange={() => {}} />)
    act(() => store.getState().setSettings({ trustLevel: 'ask' }))
    expect(screen.getByRole('button', { name: 'Trust: Ask first' })).toBeTruthy()
  })

  it('New chat passes the current filter', () => {
    render(<ReviewToolbar scopeId="p1" onScopeChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /New chat/ }))
    expect(h.startNewChat).toHaveBeenCalledWith({ scopeId: 'p1' })
  })
})

describe('ReviewToolbar keyboard', () => {
  it('focuses the current item on open and moves with arrows, Home and End', () => {
    render(<ReviewToolbar scopeId="p1" onScopeChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Acme/ }))
    const acme = screen.getByRole('menuitemradio', { name: 'Acme' })
    expect(document.activeElement).toBe(acme)
    fireEvent.keyDown(acme, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Beta' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All scopes' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'End' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Beta' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Home' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'All scopes' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowUp' })
    expect(document.activeElement).toBe(screen.getByRole('menuitemradio', { name: 'Beta' }))
  })

  it('Escape closes from an item and from the trigger and refocuses the trigger', () => {
    render(<ReviewToolbar onScopeChange={() => {}} />)
    const trigger = screen.getByRole('button', { name: /All scopes/ })
    fireEvent.click(trigger)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(document.activeElement).toBe(trigger)
  })
})

describe('ReviewToolbar scope menu semantics (M5, T5)', () => {
  it('items are radios with the current one checked, and only the focused item is a tab stop', () => {
    render(<ReviewToolbar scopeId="p1" onScopeChange={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /Acme/ }))
    const items = screen.getAllByRole('menuitemradio')
    expect(items.map((el) => el.getAttribute('aria-checked'))).toEqual(['false', 'false', 'true', 'false'])
    const stops = () => items.filter((el) => el.tabIndex === 0).map((el) => el.textContent)
    expect(stops()).toEqual(['Acme'])
    fireEvent.keyDown(document.activeElement as Element, { key: 'ArrowDown' })
    expect(stops()).toEqual(['Beta'])
  })

  it('closes when focus tabs out of the menu, and stays open while it moves inside', () => {
    render(
      <>
        <ReviewToolbar onScopeChange={() => {}} />
        <button type="button">After</button>
      </>
    )
    fireEvent.click(screen.getByRole('button', { name: /All scopes/ }))
    const first = screen.getByRole('menuitemradio', { name: 'All scopes' })
    fireEvent.blur(first, { relatedTarget: screen.getByRole('menuitemradio', { name: 'Acme' }) })
    expect(screen.queryByRole('menu')).not.toBeNull()
    // A click that does not move focus (WebKit buttons) has no relatedTarget: the mousedown handler owns that case.
    fireEvent.blur(first, { relatedTarget: null })
    expect(screen.queryByRole('menu')).not.toBeNull()
    fireEvent.blur(first, { relatedTarget: screen.getByRole('button', { name: 'After' }) })
    expect(screen.queryByRole('menu')).toBeNull()
  })
})

describe('ReviewToolbar New chat hint (M6)', () => {
  it('shows the platform modifier, not ⌘, off the Mac', () => {
    render(<ReviewToolbar onScopeChange={() => {}} />)
    const kbd = document.querySelector('.dango-review-toolbar__new kbd')
    expect(kbd?.textContent).toBe('Ctrl+N')
  })
})

describe('ReviewToolbar scope label (M4)', () => {
  it('never says All scopes for a scope id it cannot name yet', () => {
    render(<ReviewToolbar scopeId="not-loaded" onScopeChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /All scopes/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Loading\.\.\./ })).toBeTruthy()
  })
})
