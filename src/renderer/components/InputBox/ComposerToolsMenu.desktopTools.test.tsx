/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'
import ComposerToolsMenu, { type ComposerToolsMenuProps } from './ComposerToolsMenu'

const h = vi.hoisted(() => ({ flags: { mcp: true, knowledgeBase: true } }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('@/hooks/knowledge-base', () => ({ useKnowledgeBases: () => ({ data: [] }) }))
vi.mock('@/hooks/mcp', () => ({ useMCPServerStatus: () => undefined, useToggleMCPServer: () => vi.fn() }))
vi.mock('@/stores/settingsStore', () => ({
  useMcpSettings: () => ({ servers: [], enabledBuiltinServers: [] }),
}))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: vi.fn() }))
vi.mock('@/packages/mcp/builtin', () => ({ BUILTIN_MCP_SERVERS: [] }))
vi.mock('@/platform', () => ({
  platformCapabilities: { supportsDesktopOnlySettings: true, supportsMcpStdio: true },
}))
vi.mock('@/utils/feature-flags', () => ({ featureFlags: h.flags }))
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
  vi.restoreAllMocks()
  h.flags.mcp = true
  h.flags.knowledgeBase = true
})

function renderDesktopMenu(overrides: Partial<ComposerToolsMenuProps> = {}) {
  const props: ComposerToolsMenuProps = {
    isOpenClawModel: false,
    sessionType: 'chat',
    webBrowsingMode: false,
    webSearchConfigured: true,
    onWebBrowsingChange: vi.fn(),
    agentMode: false,
    onToggleAgentMode: vi.fn(),
    showRollbackThreadButton: false,
    onImageUploadClick: vi.fn(),
    onFileUploadClick: vi.fn(),
    onAttachLink: vi.fn(),
    toolbarButtonClass: '',
    toolbarIconSize: 18,
    browserArmed: false,
    onBrowserArmedChange: vi.fn(),
    browserMasterEnabled: true,
    computerArmed: false,
    onComputerArmedChange: vi.fn(),
    computerMasterEnabled: true,
    ...overrides,
  }
  render(
    <MantineProvider theme={createDangoMantineTheme()}>
      <ComposerToolsMenu {...props} />
    </MantineProvider>
  )
  fireEvent.click(screen.getByRole('button', { name: 'Tools and attachments' }))
}

describe('ComposerToolsMenu desktop tools rows', () => {
  it('shows Dango Browser, Computer Use, Extensions and Knowledge when their flags are on', async () => {
    renderDesktopMenu()
    const menu = await screen.findByRole('menu')

    expect(menu.textContent).toContain('Dango Browser')
    expect(menu.textContent).toContain('Computer Use')
    expect(menu.textContent).toContain('Extensions')
    expect(menu.textContent).toContain('Knowledge')
  })

  it('hides those rows when their flags are off', async () => {
    h.flags.mcp = false
    h.flags.knowledgeBase = false
    renderDesktopMenu({ onBrowserArmedChange: undefined, onComputerArmedChange: undefined })
    const menu = await screen.findByRole('menu')

    expect(menu.textContent).not.toContain('Dango Browser')
    expect(menu.textContent).not.toContain('Computer Use')
    expect(menu.textContent).not.toContain('Extensions')
    expect(menu.textContent).not.toContain('Knowledge')
  })

  it('caps the menu height at 28rem in a tall window', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 2000 } as DOMRect)
    renderDesktopMenu()
    const menu = await screen.findByRole('menu')

    expect(menu.style.maxHeight).toBe('448px')
  })

  it('keeps a 240px floor when there is little space above the trigger', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 100 } as DOMRect)
    renderDesktopMenu()
    const menu = await screen.findByRole('menu')

    expect(menu.style.maxHeight).toBe('240px')
  })
})
