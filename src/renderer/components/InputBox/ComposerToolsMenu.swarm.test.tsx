/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'
import ComposerToolsMenu, { type ComposerToolsMenuProps } from './ComposerToolsMenu'

const h = vi.hoisted(() => ({ smallScreen: false, desktopOnly: true }))

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
vi.mock('@/platform', () => ({
  platformCapabilities: {
    get supportsDesktopOnlySettings() {
      return h.desktopOnly
    },
    supportsMcpStdio: true,
  },
}))
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
  h.desktopOnly = true
})

function renderMenu(overrides: Partial<ComposerToolsMenuProps> = {}) {
  const props: ComposerToolsMenuProps = {
    isOpenClawModel: false,
    sessionType: 'chat',
    webBrowsingMode: false,
    webSearchConfigured: true,
    onWebBrowsingChange: vi.fn(),
    agentMode: false,
    onToggleAgentMode: vi.fn(),
    onWorkspaceRootChange: vi.fn(),
    showRollbackThreadButton: false,
    onImageUploadClick: vi.fn(),
    onFileUploadClick: vi.fn(),
    onAttachLink: vi.fn(),
    toolbarButtonClass: '',
    toolbarIconSize: 18,
    swarmOn: false,
    swarmAgentCount: 0,
    onSwarmChange: vi.fn(),
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

async function rowLabels(): Promise<string[]> {
  const items = await screen.findAllByRole('menuitem')
  return items.map((item) => (item.textContent ?? '').trim())
}

describe.each([
  ['desktop menu', false],
  ['small-screen drawer', true],
])('ComposerToolsMenu Swarm row (%s)', (_name, small) => {
  beforeEach(() => {
    h.smallScreen = small
  })

  it('is the last row of the Mode section, after Project folder', async () => {
    renderMenu()
    const labels = await rowLabels()
    const folderIx = labels.findIndex((l) => l.startsWith('Project folder'))
    expect(folderIx).toBeGreaterThanOrEqual(0)
    expect(labels[folderIx + 1]).toMatch(/^Swarm/)
    expect(screen.getByText('Several agents work on one answer')).toBeTruthy()
  })

  it('the switch reflects swarmOn', async () => {
    renderMenu({ swarmOn: false })
    expect(((await screen.findByRole('switch', { name: 'Swarm' })) as HTMLInputElement).checked).toBe(false)
    cleanup()

    renderMenu({ swarmOn: true, swarmAgentCount: 2 })
    expect(((await screen.findByRole('switch', { name: 'Swarm' })) as HTMLInputElement).checked).toBe(true)
  })

  it('clicking the row turns Swarm on', async () => {
    const props = renderMenu({ swarmOn: false })
    const row = (await screen.findAllByRole('menuitem')).find((i) => i.textContent?.startsWith('Swarm'))
    fireEvent.click(row as HTMLElement)
    expect(props.onSwarmChange).toHaveBeenCalledWith(true)
  })

  it('clicking the switch turns Swarm off', async () => {
    const props = renderMenu({ swarmOn: true, swarmAgentCount: 2 })
    fireEvent.click(await screen.findByRole('switch', { name: 'Swarm' }))
    expect(props.onSwarmChange).toHaveBeenCalledTimes(1)
    expect(props.onSwarmChange).toHaveBeenCalledWith(false)
  })

  it('on with fewer than two agents asks for more', async () => {
    renderMenu({ swarmOn: true, swarmAgentCount: 1 })
    await screen.findByRole('switch', { name: 'Swarm' })
    expect(screen.getByText('Add 2 or 3 agents with @')).toBeTruthy()
    expect(screen.queryByText('Several agents work on one answer')).toBeNull()
  })

  it('OpenClaw hides the row', async () => {
    renderMenu({ isOpenClawModel: true })
    expect((await rowLabels()).some((l) => l.startsWith('Swarm'))).toBe(false)
  })
})

describe('ComposerToolsMenu Swarm row without desktop-only settings', () => {
  it('shows under Mode on web even with no Agent Mode row', async () => {
    h.desktopOnly = false
    renderMenu()
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('Mode')).toBeTruthy()
    const labels = await rowLabels()
    expect(labels.some((l) => l.startsWith('Agent Mode'))).toBe(false)
    expect(labels.some((l) => l.startsWith('Swarm'))).toBe(true)
  })

  it('is hidden outside chats', async () => {
    renderMenu({ sessionType: 'picture' })
    expect((await rowLabels()).some((l) => l.startsWith('Swarm'))).toBe(false)
  })
})

describe('InputBox source', () => {
  it('has no team mode picker and no team room actions', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/renderer/components/InputBox/InputBox.tsx'), 'utf8')
    expect(source).not.toContain('TeamModeSelect')
    expect(source).not.toContain('<TeamRoomActions')
  })
})
