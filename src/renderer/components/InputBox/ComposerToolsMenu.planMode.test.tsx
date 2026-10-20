/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'
import ComposerToolsMenu, { type ComposerToolsMenuProps } from './ComposerToolsMenu'

const h = vi.hoisted(() => ({ smallScreen: false }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => h.smallScreen }))
vi.mock('@/hooks/knowledge-base', () => ({ useKnowledgeBases: () => ({ data: [] }) }))
vi.mock('@/hooks/mcp', () => ({ useMCPServerStatus: () => undefined, useToggleMCPServer: () => vi.fn() }))
vi.mock('@/stores/settingsStore', () => ({
  useMcpSettings: () => ({ servers: [], enabledBuiltinServers: [] }),
}))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: vi.fn() }))
vi.mock('@/packages/mcp/builtin', () => ({ BUILTIN_MCP_SERVERS: [] }))
vi.mock('@/platform', () => ({ platformCapabilities: { supportsDesktopOnlySettings: true, supportsMcpStdio: true } }))
vi.mock('@/utils/feature-flags', () => ({ featureFlags: { mcp: false, knowledgeBase: false } }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children?: ReactNode }) => <a href="#link">{children}</a>,
}))
vi.mock('../mcp/MCPStatus', () => ({ default: () => null }))

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
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
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  h.smallScreen = false
})

function renderMenu(overrides: Partial<ComposerToolsMenuProps> = {}) {
  const props: ComposerToolsMenuProps = {
    isOpenClawModel: false,
    sessionType: 'chat',
    webBrowsingMode: false,
    webSearchConfigured: true,
    onWebBrowsingChange: vi.fn(),
    agentMode: true,
    onToggleAgentMode: vi.fn(),
    planMode: false,
    onPlanModeChange: vi.fn(),
    showPlanMode: true,
    showRollbackThreadButton: false,
    onImageUploadClick: vi.fn(),
    onFileUploadClick: vi.fn(),
    onAttachLink: vi.fn(),
    toolbarButtonClass: '',
    toolbarIconSize: 18,
    ...overrides,
  }
  render(
    <MantineProvider theme={createDangoMantineTheme()}>
      <ComposerToolsMenu {...props} />
    </MantineProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Tools and attachments' }))
  return props
}

/** Menu rows in order, by their first line of text. */
async function rowLabels(): Promise<string[]> {
  const items = await screen.findAllByRole('menuitem')
  return items.map((item) => (item.textContent ?? '').trim())
}

describe.each([
  ['desktop menu', false],
  ['small-screen drawer', true],
])('ComposerToolsMenu plan mode (%s)', (_name, small) => {
  beforeEach(() => {
    h.smallScreen = small
  })

  it('Plan mode shows under Agent Mode only in an agent chat', async () => {
    renderMenu()
    const labels = await rowLabels()
    const agentIx = labels.findIndex((l) => l.startsWith('Agent Mode'))
    expect(agentIx).toBeGreaterThanOrEqual(0)
    expect(labels[agentIx + 1]).toMatch(/^Plan mode/)
    expect(screen.getByText('Propose a plan first. Nothing runs until you choose Run plan.')).toBeTruthy()
    cleanup()

    // Agent Mode off: the row is hidden (the stored value is kept but does nothing).
    renderMenu({ agentMode: false, planMode: true })
    expect((await rowLabels()).some((l) => l.startsWith('Plan mode'))).toBe(false)
    cleanup()

    // Not a chat (e.g. a picture session): no Mode rows at all.
    renderMenu({ sessionType: 'picture' })
    expect((await rowLabels()).some((l) => l.startsWith('Plan mode'))).toBe(false)
  })

  it('Plan mode is hidden in multi-agent rooms and OpenClaw chats', async () => {
    renderMenu({ showPlanMode: false })
    expect((await rowLabels()).some((l) => l.startsWith('Plan mode'))).toBe(false)
    cleanup()

    renderMenu({ isOpenClawModel: true })
    expect((await rowLabels()).some((l) => l.startsWith('Plan mode'))).toBe(false)
  })

  it('toggling Plan mode calls onPlanModeChange with the new value', async () => {
    const off = renderMenu({ planMode: false })
    const row = (await screen.findAllByRole('menuitem')).find((i) => i.textContent?.startsWith('Plan mode'))
    fireEvent.click(row as HTMLElement)
    expect(off.onPlanModeChange).toHaveBeenCalledWith(true)
    cleanup()

    const on = renderMenu({ planMode: true })
    fireEvent.click(await screen.findByRole('switch', { name: 'Plan mode' }))
    expect(on.onPlanModeChange).toHaveBeenCalledTimes(1)
    expect(on.onPlanModeChange).toHaveBeenCalledWith(false)
  })

  it('the Plan mode switch is named for screen readers', async () => {
    renderMenu({ planMode: true })
    const toggle = (await screen.findByRole('switch', { name: 'Plan mode' })) as HTMLInputElement
    expect(toggle.checked).toBe(true)
  })
})

describe('ComposerToolsMenu desktop Mode section (S1)', () => {
  it('desktop menu offers Agent Mode and Plan mode', async () => {
    h.smallScreen = false
    const props = renderMenu({ agentMode: false, onWorkspaceRootChange: vi.fn() })
    const labels = await rowLabels()
    expect(screen.getByText('Mode')).toBeTruthy()
    expect(labels.some((l) => l.startsWith('Agent Mode'))).toBe(true)
    expect(labels.some((l) => l.startsWith('Project folder'))).toBe(true)
    const agentRow = (await screen.findAllByRole('menuitem')).find((i) => i.textContent?.startsWith('Agent Mode'))
    fireEvent.click(agentRow as HTMLElement)
    expect(props.onToggleAgentMode).toHaveBeenCalledTimes(1)
    cleanup()

    renderMenu({ agentMode: true })
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByRole('switch', { name: 'Plan mode' })).toBeTruthy()
  })
})
