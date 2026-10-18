/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import type { WorkspaceDescriptor } from '@shared/types/workspace'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import platform from '@/platform'
import { createDangoMantineTheme } from '@/theme/mantineTheme'
import { ScopeFilesTab, shouldShowFilesTab } from './ScopeFilesTab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock('@/platform', () => ({
  default: {
    listWorkspaceChildren: vi.fn(),
    relinkProject: vi.fn(),
  },
  platformCapabilities: { supportsProjectWorkspace: true },
}))

vi.mock('@/components/project/SourceControlView', () => ({
  SourceControlView: ({ capabilityId }: { capabilityId: string }) => <div data-testid="scm">{capabilityId}</div>,
}))

const descriptor = (over: Partial<WorkspaceDescriptor> = {}): WorkspaceDescriptor => ({
  projectId: 'p1',
  capabilityId: 'cap-1',
  rootGeneration: 'g1',
  displayPath: '/Users/n/dango',
  status: 'ready',
  ...over,
})

function renderTab(d: WorkspaceDescriptor, onDescriptorChange = vi.fn()) {
  return render(
    <MantineProvider theme={createDangoMantineTheme()}>
      <ScopeFilesTab scopeId="p1" descriptor={d} onDescriptorChange={onDescriptorChange} />
    </MantineProvider>
  )
}

beforeEach(() => {
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
  vi.mocked(platform.listWorkspaceChildren as NonNullable<typeof platform.listWorkspaceChildren>).mockResolvedValue({
    entries: [
      { name: 'src', relativePath: 'src', kind: 'directory' },
      { name: 'README.md', relativePath: 'README.md', kind: 'file' },
    ],
  } as never)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('shouldShowFilesTab', () => {
  it('is false without a descriptor', () => {
    expect(shouldShowFilesTab(null, true)).toBe(false)
  })
  it('is false when the platform has no workspace support', () => {
    expect(shouldShowFilesTab(descriptor(), false)).toBe(false)
  })
  it('is true for ready, missing, relink-required and permission-denied on desktop', () => {
    for (const status of ['ready', 'missing', 'relink-required', 'permission-denied'] as const) {
      expect(shouldShowFilesTab(descriptor({ status }), true)).toBe(true)
    }
  })
  it('is false for chat-only', () => {
    expect(shouldShowFilesTab(descriptor({ status: 'chat-only' }), true)).toBe(false)
  })
})

describe('ScopeFilesTab', () => {
  it('shows folder name, source control and the tree', async () => {
    renderTab(descriptor())
    expect(screen.getByText('dango')).toBeTruthy()
    expect(screen.getByTestId('scm').textContent).toBe('cap-1')
    await waitFor(() => expect(screen.getByText('README.md')).toBeTruthy())
    expect(screen.getByText('src')).toBeTruthy()
  })

  it('offers relink when the folder is missing', async () => {
    const next = descriptor({ status: 'ready' })
    vi.mocked(platform.relinkProject as NonNullable<typeof platform.relinkProject>).mockResolvedValue(next)
    const onChange = vi.fn()
    renderTab(descriptor({ status: 'missing' }), onChange)
    expect(screen.getByText("Dango can't open this folder.")).toBeTruthy()
    fireEvent.click(screen.getByText('Relink folder'))
    expect(platform.relinkProject).toHaveBeenCalledWith('p1')
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(next))
  })
})
