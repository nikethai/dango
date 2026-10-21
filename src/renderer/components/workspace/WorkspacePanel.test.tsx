/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'

const exportTextFile = vi.fn(async () => {})

vi.mock('@/platform', () => ({
  default: { exporter: { exportTextFile }, formFactor: 'desktop', type: 'web' },
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  }),
}))
vi.mock('@/packages/navigator', () => ({ copyToClipboard: vi.fn() }))
const addToast = vi.fn()
vi.mock('@/stores/toastActions', () => ({ add: (...args: unknown[]) => addToast(...args) }))
vi.mock('../layout/Toolbar', () => ({ default: () => null }))
vi.mock('../layout/WindowControls', () => ({ default: () => null }))
vi.mock('../Markdown', () => ({ default: () => null }))
vi.mock('../Mermaid', () => ({ MessageMermaid: () => null }))
vi.mock('./HtmlWorkspaceView', () => ({ HtmlWorkspaceView: () => <div data-testid="html-view" /> }))
vi.mock('./WorkspaceCodeView', () => ({ WorkspaceCodeView: () => null }))

const V1 = '<h1>first</h1>'
const V2 = '<h1>second</h1>'

function setWindowWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width })
  window.dispatchEvent(new Event('resize'))
}

async function setup() {
  const { uiStore } = await import('@/stores/uiStore')
  const { default: WorkspacePanel } = await import('./WorkspacePanel')
  uiStore.setState({
    workspaceExpanded: false,
    workspacePanel: {
      kind: 'html',
      content: V2,
      title: 'Pricing Table v2',
      artifactId: 'a2',
      versions: [
        { id: 'a1', kind: 'html', content: V1, title: 'Pricing Table v2', version: 1 },
        { id: 'a2', kind: 'html', content: V2, title: 'Pricing Table v2', version: 2 },
      ],
      versionIndex: 1,
    },
  })
  render(
    <MantineProvider theme={createDangoMantineTheme()}>
      <WorkspacePanel />
    </MantineProvider>
  )
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20))
  })
  return uiStore
}

beforeEach(() => {
  // The docked pane is the wide layout (slice 9); jsdom's default 1024 px is medium.
  setWindowWidth(1280)
  exportTextFile.mockClear()
  addToast.mockClear()
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0))
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WorkspacePanel', () => {
  it('labels the panel, tabs and toolbar', async () => {
    await setup()
    const panel = screen.getByRole('complementary', { name: 'Artifact' })
    expect(panel).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Preview' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Code' })).toBeTruthy()
    expect(screen.getByRole('tablist', { name: 'Artifact view' })).toBeTruthy()
    expect(screen.getByRole('toolbar', { name: 'Artifact actions' })).toBeTruthy()
    for (const name of ['Full screen', 'Copy', 'Download', 'Close']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('toggles full screen', async () => {
    await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    expect(screen.getByRole('button', { name: 'Exit full screen' })).toBeTruthy()
  })

  it('downloads the version on screen, named from the title', async () => {
    await setup()
    expect(screen.getByText('v2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(exportTextFile).toHaveBeenLastCalledWith('pricing-table-v2.html', V2)

    fireEvent.click(screen.getByRole('button', { name: 'Previous version' }))
    await act(async () => {})
    expect(screen.getByText('v1')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    expect(exportTextFile).toHaveBeenLastCalledWith('pricing-table-v2.html', V1)
  })

  it('a failed download says so', async () => {
    await setup()
    exportTextFile.mockRejectedValueOnce(new Error('disk full'))
    fireEvent.click(screen.getByRole('button', { name: 'Download' }))
    await act(async () => {})
    expect(addToast).toHaveBeenCalledWith('Download failed')
  })

  it('the store and the panel share one width range', async () => {
    const store = await import('@/stores/uiStore')
    const panel = await import('./WorkspacePanel')
    expect(store.WORKSPACE_MIN_WIDTH_PX).toBe(380)
    expect(store.WORKSPACE_MAX_WIDTH_PX).toBe(460)
    expect(panel.WORKSPACE_MIN_WIDTH_PX).toBe(store.WORKSPACE_MIN_WIDTH_PX)
    expect(panel.WORKSPACE_MAX_WIDTH_PX).toBe(store.WORKSPACE_MAX_WIDTH_PX)
  })

  it('clamps the width to 380-460 on read and for the resizer', async () => {
    const store = await setup()
    store.setState({ workspaceWidthPx: 520 })
    await act(async () => {})
    const resizer = screen.getByRole('separator')
    expect(resizer.getAttribute('aria-valuemin')).toBe('380')
    expect(resizer.getAttribute('aria-valuemax')).toBe('460')
    expect(resizer.getAttribute('aria-valuenow')).toBe('460')
    store.getState().setWorkspaceWidthPx(200)
    expect(store.getState().workspaceWidthPx).toBe(380)
    store.getState().setWorkspaceWidthPx(900)
    expect(store.getState().workspaceWidthPx).toBe(460)
  })
})

describe('WorkspacePanel by window size (slice 9 RS1, RS2)', () => {
  it('wide: docked at 380-460 px, not a dialog', async () => {
    const store = await setup()
    store.setState({ workspaceWidthPx: 200 })
    await act(async () => {})
    const panel = screen.getByRole('complementary', { name: 'Artifact' })
    expect(panel.style.minWidth).toBe('380px')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('separator').getAttribute('aria-valuenow')).toBe('380')
  })

  it('medium: a right sheet named by the title, without resizer or full screen', async () => {
    setWindowWidth(1000)
    await setup()
    const dialog = screen.getByRole('dialog', { name: 'Pricing Table v2' })
    expect(dialog.classList.contains('dango-sheet--right')).toBe(true)
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.queryByRole('separator')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Full screen' })).toBeNull()
    for (const name of ['Preview', 'Code']) expect(screen.getByRole('tab', { name })).toBeTruthy()
    for (const name of ['Copy', 'Download', 'Close']) expect(screen.getByRole('button', { name })).toBeTruthy()
    expect(document.querySelector('.dg-sheet-scrim')).toBeTruthy()
  })

  it('medium: Esc closes the panel once and leaves no scrim', async () => {
    setWindowWidth(1000)
    const { uiStore } = await import('@/stores/uiStore')
    const original = uiStore.getState().setWorkspacePanel
    const setPanel = vi.fn(original)
    uiStore.setState({ setWorkspacePanel: setPanel })
    try {
      const store = await setup()
      fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
      await act(async () => {})
      expect(store.getState().workspacePanel).toBeNull()
      expect(setPanel.mock.calls.filter(([v]) => v === null)).toHaveLength(1)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.querySelector('.dg-sheet-scrim')).toBeNull()
    } finally {
      uiStore.setState({ setWorkspacePanel: original })
    }
  })

  it('phone: a bottom sheet with the full-height class', async () => {
    setWindowWidth(390)
    await setup()
    const dialog = screen.getByRole('dialog', { name: 'Pricing Table v2' })
    expect(dialog.classList.contains('dango-sheet--right')).toBe(false)
    expect(dialog.classList.contains('dango-inspector-sheet')).toBe(true)
  })

  it('resizing medium to wide while open docks it again with no scrim; wide to phone makes a sheet', async () => {
    setWindowWidth(1000)
    await setup()
    expect(screen.getByRole('dialog')).toBeTruthy()
    await act(async () => setWindowWidth(1280))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.dg-sheet-scrim')).toBeNull()
    const panel = screen.getByRole('complementary', { name: 'Artifact' })
    expect(panel.classList.contains('is-open')).toBe(true)
    expect(screen.getByRole('separator')).toBeTruthy()
    await act(async () => setWindowWidth(390))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(document.querySelectorAll('.dg-sheet-scrim')).toHaveLength(1)
  })

  it('full screen from wide does not carry into the sheet', async () => {
    const store = await setup()
    fireEvent.click(screen.getByRole('button', { name: 'Full screen' }))
    expect(store.getState().workspaceExpanded).toBe(true)
    await act(async () => setWindowWidth(1000))
    expect(screen.getByRole('dialog', { name: 'Pricing Table v2' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Exit full screen' })).toBeNull()
  })
})

describe('session route shell classes', () => {
  it('only the wide layout reserves room for the docked inspector', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const src = readFileSync(resolve(__dirname, '../../routes/session/$sessionId.tsx'), 'utf8')
    expect(src).toMatch(/useLayoutMode\(\)/)
    expect(src).toMatch(/layoutMode === 'wide' && workspaceChromeActive/)
    expect(src).toMatch(/layoutMode === 'wide' && workspaceExpanded/)
  })
})
