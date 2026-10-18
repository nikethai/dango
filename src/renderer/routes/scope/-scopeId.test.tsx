/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ scopeId: 'everywhere', workspaceIds: [] as string[] }))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: Record<string, unknown>) => ({
    options: opts,
    useParams: () => ({ scopeId: state.scopeId }),
    useSearch: () => ({ tab: 'overview' }),
  }),
  useNavigate: () => vi.fn(),
}))
vi.mock('@/components/scope/EverywherePage', () => ({ EverywherePage: () => <div>everywhere-page</div> }))
vi.mock('@/components/scope/ScopePage', () => ({
  ScopePageView: ({ files }: { files: unknown }) => <div>scope-view {files ? 'has-files' : 'no-files'}</div>,
}))
vi.mock('@/components/scope/ScopeFilesTab', () => ({
  ScopeFilesTab: () => null,
  shouldShowFilesTab: (d: unknown) => !!d,
}))
vi.mock('@/components/scope/ScopeSettingsTab', () => ({ NO_AGENT_VALUE: '', ScopeSettingsTab: () => null }))
vi.mock('@/components/scope/useScopeKnowledgeCount', () => ({ useScopeKnowledgeCount: () => 0 }))
vi.mock('@/components/session/session-list-helpers', () => ({ groupSessionsByScope: () => ({ groups: [] }) }))
vi.mock('@/hooks/useCopilots', () => ({
  useMyCopilots: () => ({ copilots: [] }),
  useRemoteCopilots: () => ({ copilots: [] }),
}))
vi.mock('@/hooks/useProjectWorkspace', async () => {
  const React = await import('react')
  return {
    useProjectWorkspace: ({ projectId }: { projectId: string }) => {
      state.workspaceIds.push(projectId)
      // Descriptor only for scope "a", set asynchronously like the real hook.
      const [descriptor, setDescriptor] = React.useState<unknown>(null)
      React.useEffect(() => {
        if (projectId === 'a') setDescriptor({ bound: true })
      }, [projectId])
      return { descriptor, setDescriptor }
    },
  }
})
vi.mock('@/hooks/useScopes', () => ({
  useScopes: () => ({
    scopes: [],
    getScope: () => undefined,
    updateScope: vi.fn(),
    removeScope: vi.fn(),
    putScope: vi.fn(),
  }),
}))
vi.mock('@/platform', () => ({ platformCapabilities: { supportsProjectWorkspace: true } }))
vi.mock('@/lib/startNewChat', () => ({ startNewChat: vi.fn() }))
vi.mock('@/projects/scope-feedback', () => ({ deleteScopeOrToast: vi.fn() }))
vi.mock('@/stores/chatStore', () => ({ useSessionList: () => ({ sessionMetaList: [] }) }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))

import { Route } from './$scopeId'

afterEach(() => {
  cleanup()
  state.workspaceIds = []
})

const Component = (Route as unknown as { options: { component: () => JSX.Element } }).options.component

describe('scope route', () => {
  it('renders EverywherePage for everywhere without loading a workspace', () => {
    state.scopeId = 'everywhere'
    render(<Component />)
    expect(screen.getByText('everywhere-page')).toBeTruthy()
    expect(state.workspaceIds).toEqual([])
  })

  it('does not carry one scope workspace descriptor into another', () => {
    state.scopeId = 'a'
    const { rerender } = render(<Component />)
    expect(screen.getByText('scope-view has-files')).toBeTruthy()
    state.scopeId = 'b'
    rerender(<Component />)
    expect(screen.getByText('scope-view no-files')).toBeTruthy()
  })
})
