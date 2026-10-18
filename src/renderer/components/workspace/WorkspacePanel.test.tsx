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
vi.mock('../layout/Toolbar', () => ({ default: () => null }))
vi.mock('../layout/WindowControls', () => ({ default: () => null }))
vi.mock('../Markdown', () => ({ default: () => null }))
vi.mock('../Mermaid', () => ({ MessageMermaid: () => null }))
vi.mock('./HtmlWorkspaceView', () => ({ HtmlWorkspaceView: () => <div data-testid="html-view" /> }))
vi.mock('./WorkspaceCodeView', () => ({ WorkspaceCodeView: () => null }))

const V1 = '<h1>first</h1>'
const V2 = '<h1>second</h1>'

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
  exportTextFile.mockClear()
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
