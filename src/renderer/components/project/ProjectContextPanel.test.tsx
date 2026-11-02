/**
 * @vitest-environment jsdom
 */

import type { WorkspaceDescriptor } from '@shared/types/workspace'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ capabilities: vi.fn() }))

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@mantine/core', () => ({
  ActionIcon: ({ children, ...rest }: { children?: ReactNode }) => <button {...rest}>{children}</button>,
  Tooltip: ({ children }: { children?: ReactNode }) => children,
}))
vi.mock('@/platform', () => ({
  default: {
    getWorkspaceSuiteCapabilities: h.capabilities,
    listWorkspaceChildren: vi.fn(async () => ({ entries: [] })),
  },
  platformCapabilities: { supportsProjectWorkspace: true },
}))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/stores/uiStore', () => ({
  uiStore: { getState: () => ({ projectContextDrafts: {}, setProjectContextDraft: vi.fn() }) },
  useUIStore: (pick: (s: unknown) => unknown) => pick({ projectContextDrafts: {} }),
}))
vi.mock('@/packages/model-calls/toolsets/file', () => ({
  getStagedChangeSetId: () => '',
  subscribeStagedChangeSets: () => () => {},
}))
vi.mock('./ProjectChangeReview', () => ({ ProjectChangeReview: () => null }))
vi.mock('./ProjectExportDialog', () => ({ ProjectExportDialog: () => null }))
vi.mock('./QuickRunPanel', () => ({ QuickRunPanel: () => null }))
vi.mock('./SourceControlView', () => ({ SourceControlView: () => null }))

import { ProjectContextPanel } from './ProjectContextPanel'

const descriptor: WorkspaceDescriptor = {
  projectId: 'p1',
  capabilityId: 'cap-1',
  rootGeneration: 'g1',
  displayPath: '/tmp/demo',
  status: 'ready',
}

afterEach(() => {
  cleanup()
  h.capabilities.mockReset()
})

function renderPanel() {
  render(
    <ProjectContextPanel
      sessionId="s1"
      projectId="p1"
      descriptor={descriptor}
      resolved={{ kind: 'ready', projectId: 'p1', descriptor }}
      onDescriptorChange={vi.fn()}
    />
  )
}

const entry = (state: string) => ({ state, reason: 'native-rollout' })

describe('ProjectContextPanel tabs', () => {
  it('shows only Files, with no tab row, when the other features are off', async () => {
    h.capabilities.mockResolvedValue({
      explorer: entry('ready'),
      scm: entry('disabled'),
      staging: entry('disabled'),
      wasi: entry('unavailable'),
    })
    renderPanel()
    await waitFor(() => expect(h.capabilities).toHaveBeenCalled())
    expect(screen.queryByRole('tablist')).toBeNull()
    expect(screen.getByPlaceholderText('Search files')).toBeTruthy()
  })

  it('shows only Files when the capabilities cannot be read', async () => {
    h.capabilities.mockRejectedValue(new Error('UNSUPPORTED_PLATFORM'))
    renderPanel()
    await waitFor(() => expect(h.capabilities).toHaveBeenCalled())
    expect(screen.queryByRole('tablist')).toBeNull()
  })

  it('adds a tab for each ready feature', async () => {
    h.capabilities.mockResolvedValue({ scm: entry('ready'), staging: entry('ready'), wasi: entry('unavailable') })
    renderPanel()
    const tabs = await screen.findAllByRole('tab')
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Files', 'Source Control', 'Change Review'])
    expect(tabs[0].getAttribute('aria-selected')).toBe('true')
  })
})
