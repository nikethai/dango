// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ui = vi.hoisted(() => {
  const state = {
    railPeek: false,
    sidebarLayout: 'expanded' as 'expanded' | 'rail',
    setRailPeek: (v: boolean) => {
      state.railPeek = v
    },
    setSidebarLayout: (v: 'expanded' | 'rail') => {
      state.sidebarLayout = v
    },
  }
  return state
})
vi.mock('@/stores/uiStore', () => ({ uiStore: { getState: () => ui } }))

import {
  setLayoutAttributeSuppressed,
  setSidebarShown,
  toggleSidebar,
  useLayoutMode,
  useSidebarShown,
} from './useLayoutMode'

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
}

function Probe() {
  const mode = useLayoutMode()
  return <span data-testid="mode">{mode}</span>
}

const root = document.documentElement

beforeEach(() => {
  setWidth(1300)
  ui.railPeek = false
  ui.sidebarLayout = 'expanded'
  setLayoutAttributeSuppressed(false)
  setSidebarShown(true)
  delete root.dataset.quickChat
})

afterEach(() => {
  cleanup()
})

describe('useLayoutMode', () => {
  it('follows the window width and writes data-layout on <html>', () => {
    const view = render(<Probe />)
    expect(view.getByTestId('mode').textContent).toBe('wide')
    expect(root.dataset.layout).toBe('wide')
    setWidth(960)
    expect(view.getByTestId('mode').textContent).toBe('medium')
    expect(root.dataset.layout).toBe('medium')
    setWidth(390)
    expect(view.getByTestId('mode').textContent).toBe('phone')
    expect(root.dataset.layout).toBe('phone')
  })

  it('never writes data-layout in the Quick Chat window', () => {
    delete root.dataset.layout
    root.dataset.quickChat = '1'
    render(<Probe />)
    setWidth(960)
    expect(root.dataset.layout).toBeUndefined()
  })

  it('removes data-layout while suppressed (Quick Chat window found late)', () => {
    render(<Probe />)
    expect(root.dataset.layout).toBe('wide')
    setLayoutAttributeSuppressed(true)
    expect(root.dataset.layout).toBeUndefined()
    setWidth(960)
    expect(root.dataset.layout).toBeUndefined()
    setLayoutAttributeSuppressed(false)
    expect(root.dataset.layout).toBe('medium')
  })

  it('closes the rail peek when the width crosses 1200 px (no orphan overlay)', () => {
    render(<Probe />)
    setWidth(960)
    ui.railPeek = true
    setWidth(1300)
    expect(ui.railPeek).toBe(false)
  })

  it('closes the rail peek when the width drops below 760 px', () => {
    render(<Probe />)
    setWidth(960)
    ui.railPeek = true
    setWidth(700)
    expect(ui.railPeek).toBe(false)
  })

  it('keeps the peek while resizing inside one mode', () => {
    render(<Probe />)
    setWidth(960)
    ui.railPeek = true
    setWidth(1000)
    expect(ui.railPeek).toBe(true)
  })
})

describe('toggleSidebar', () => {
  it('opens the peek at medium and collapses to the rail at wide', () => {
    render(<Probe />)
    setWidth(960)
    toggleSidebar()
    expect(ui.railPeek).toBe(true)
    expect(ui.sidebarLayout).toBe('expanded')
    setWidth(1300)
    toggleSidebar()
    expect(ui.sidebarLayout).toBe('rail')
    expect(ui.railPeek).toBe(false)
  })

  it('does nothing at phone', () => {
    render(<Probe />)
    setWidth(390)
    toggleSidebar()
    expect(ui).toMatchObject({ railPeek: false, sidebarLayout: 'expanded' })
  })

  it('does nothing while no sidebar is shown (first run, Settings, Quick Chat) (M8)', () => {
    render(<Probe />)
    setSidebarShown(false)
    toggleSidebar()
    expect(ui).toMatchObject({ railPeek: false, sidebarLayout: 'expanded' })
    setWidth(960)
    toggleSidebar()
    expect(ui.railPeek).toBe(false)
    setSidebarShown(true)
    toggleSidebar()
    expect(ui.railPeek).toBe(true)
  })
})

describe('useSidebarShown', () => {
  it('follows what the root reports, so page toggles hide where there is no sidebar', () => {
    const { result } = renderHook(() => useSidebarShown())
    expect(result.current).toBe(true)
    act(() => setSidebarShown(false))
    expect(result.current).toBe(false)
    act(() => setSidebarShown(true))
    expect(result.current).toBe(true)
  })
})
