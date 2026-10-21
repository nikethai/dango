// @vitest-environment jsdom

import { ToolRiskTier } from '@shared/types/mcp'
import { act, cleanup, fireEvent, render, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { create } from 'zustand'
import { ToolPermissionSheet } from '@/components/permission/ToolPermissionSheet'
import { useSheetFocus } from '@/components/ui/useSheetFocus'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? name)),
}))

const mockStore = create<{ openSearchDialog: boolean; setOpenSearchDialog: (open: boolean) => void }>((set) => ({
  openSearchDialog: false,
  setOpenSearchDialog: (openSearchDialog) => set({ openSearchDialog }),
}))

vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => mockStore.getState(),
  },
}))
vi.mock('@/lib/startNewChat', () => ({ startNewChat: vi.fn() }))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: vi.fn() }))
vi.mock('@/projects/scope-navigation', () => ({ newChatScopeId: vi.fn() }))
vi.mock('@/router', () => ({ router: { state: { location: { pathname: '/', search: {} } }, navigate: vi.fn() } }))
const os = vi.hoisted(() => ({ value: 'Mac' }))
vi.mock('@/packages/navigator', () => ({ getOS: () => os.value }))
vi.mock('@/platform', () => ({
  default: { onWindowFocused: () => () => {}, onWindowShow: () => () => {} },
}))
vi.mock('@/stores/atoms', () => ({ currentSessionIdAtom: {} }))
vi.mock('@/stores/sessionActions', () => ({
  startNewThread: vi.fn(),
  switchToIndex: vi.fn(),
  switchToNext: vi.fn(),
}))
vi.mock('@/hooks/dom', () => ({ focusMessageInput: vi.fn() }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
const toggleSidebar = vi.hoisted(() => vi.fn())
vi.mock('./useLayoutMode', () => ({ toggleSidebar }))

import useShortcut from './useShortcut'

const isOpen = () => mockStore.getState().openSearchDialog
const cmdK = () => fireEvent.keyDown(window, { key: 'k', metaKey: true })

function FakeOverlay() {
  const ref = useRef<HTMLElement>(null)
  useSheetFocus(ref, { onClose: () => {} })
  return (
    <section ref={ref} className="dg-qc dg-search" role="dialog">
      <input aria-label="Search" />
    </section>
  )
}

function PermissionSheet() {
  return (
    <ToolPermissionSheet
      request={{
        id: 'permission-a',
        sessionId: 's1',
        scopeId: 'scope-1',
        toolName: 'write_note',
        riskTier: ToolRiskTier.MEDIUM,
        summary: { what: 'Edit docs/a.md', touches: [] },
        allowAlways: true,
      }}
      onChoose={() => {}}
    />
  )
}

afterEach(() => {
  os.value = 'Mac'
  cleanup()
  act(() => mockStore.getState().setOpenSearchDialog(false))
  document.body.innerHTML = ''
})

describe('useShortcut ⌘K', () => {
  it('opens the search overlay when no sheet is open, and closes it again', () => {
    renderHook(() => useShortcut())
    act(() => cmdK())
    expect(isOpen()).toBe(true)
    act(() => cmdK())
    expect(isOpen()).toBe(false)
  })

  it('does nothing while a permission sheet is open', () => {
    renderHook(() => useShortcut())
    render(<PermissionSheet />)
    act(() => cmdK())
    expect(isOpen()).toBe(false)
  })

  it('closes the overlay when the overlay is the top layer', () => {
    renderHook(() => useShortcut())
    act(() => mockStore.getState().setOpenSearchDialog(true))
    render(<FakeOverlay />)
    act(() => cmdK())
    expect(isOpen()).toBe(false)
  })

  it('leaves the overlay open when a sheet sits on top of it', () => {
    renderHook(() => useShortcut())
    act(() => mockStore.getState().setOpenSearchDialog(true))
    render(<FakeOverlay />)
    render(<PermissionSheet />)
    act(() => cmdK())
    expect(isOpen()).toBe(true)
  })
})

describe('useShortcut ⌘\\', () => {
  it('toggles the sidebar by key or by the physical Backslash key (layouts where \\ needs AltGr)', () => {
    toggleSidebar.mockClear()
    renderHook(() => useShortcut())
    act(() => {
      fireEvent.keyDown(window, { key: '\\', code: 'Backslash', metaKey: true })
    })
    expect(toggleSidebar).toHaveBeenCalledTimes(1)
    act(() => {
      fireEvent.keyDown(window, { key: '#', code: 'Backslash', metaKey: true })
    })
    expect(toggleSidebar).toHaveBeenCalledTimes(2)
    act(() => {
      fireEvent.keyDown(window, { key: '\\', code: 'IntlBackslash', metaKey: true, altKey: true })
    })
    expect(toggleSidebar).toHaveBeenCalledTimes(3)
  })

  it('ignores \\ without the command key', () => {
    toggleSidebar.mockClear()
    renderHook(() => useShortcut())
    act(() => {
      fireEvent.keyDown(window, { key: '\\', code: 'Backslash' })
    })
    expect(toggleSidebar).not.toHaveBeenCalled()
  })

  it('off Mac, leaves AltGr (Ctrl+Alt) alone so it types a backslash', () => {
    os.value = 'Windows'
    toggleSidebar.mockClear()
    renderHook(() => useShortcut())
    // German layout: AltGr+ß reports key '\\' with Ctrl and Alt held.
    const altGr = new KeyboardEvent('keydown', {
      key: '\\',
      code: 'Minus',
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      window.dispatchEvent(altGr)
    })
    expect(altGr.defaultPrevented).toBe(false)
    expect(toggleSidebar).not.toHaveBeenCalled()
    // AltGraph reported without altKey (some browsers) is ignored too.
    const altGraph = new KeyboardEvent('keydown', {
      key: '\\',
      code: 'Minus',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    Object.defineProperty(altGraph, 'getModifierState', { value: (k: string) => k === 'AltGraph' })
    act(() => {
      window.dispatchEvent(altGraph)
    })
    expect(altGraph.defaultPrevented).toBe(false)
    expect(toggleSidebar).not.toHaveBeenCalled()
  })

  it('off Mac, Ctrl+\\ and Ctrl plus the physical Backslash key still toggle', () => {
    os.value = 'Windows'
    toggleSidebar.mockClear()
    renderHook(() => useShortcut())
    const plain = new KeyboardEvent('keydown', {
      key: '\\',
      code: 'Backslash',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    })
    act(() => {
      window.dispatchEvent(plain)
    })
    expect(plain.defaultPrevented).toBe(true)
    expect(toggleSidebar).toHaveBeenCalledTimes(1)
    act(() => {
      fireEvent.keyDown(window, { key: '#', code: 'Backslash', ctrlKey: true })
    })
    expect(toggleSidebar).toHaveBeenCalledTimes(2)
  })
})
