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
    const items = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim())
    expect(items).toEqual(['All scopes', 'Everywhere', 'Acme', 'Beta'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Acme' }))
    expect(onScopeChange).toHaveBeenCalledWith('p1')
    fireEvent.click(screen.getByRole('button', { name: /All scopes/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'All scopes' }))
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
