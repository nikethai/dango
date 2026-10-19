/**
 * @vitest-environment jsdom
 */

import type { Scope } from '@shared/types'
import type { BackgroundJob } from '@shared/types/background'
import type { ConnectedSource } from '@shared/types/sources'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const interpolate = (key: string, opts?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''))
  return {
    interpolate,
    sources: [] as ConnectedSource[],
    jobs: [] as BackgroundJob[],
    paused: false,
    windowLabel: 'main' as string,
  }
})

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: h.interpolate }) }))
vi.mock('@/i18n', () => ({ default: { t: h.interpolate } }))
vi.mock('@/packages/sources', () => {
  const kinds = [
    { kind: 'folder', name: 'Folder', hint: '', supportsBackgroundReview: true, sync: vi.fn() },
    { kind: 'gmail', name: 'Gmail', hint: '', supportsBackgroundReview: true },
  ]
  return {
    getSourceKind: (k: string) => kinds.find((d) => d.kind === k),
    getSource: (id: string) => h.sources.find((s) => s.id === id),
    useSources: (filter?: { scopeId?: string }) =>
      h.sources.filter((s) => filter?.scopeId === undefined || s.scopeId === filter.scopeId),
    useSourcesLoaded: () => true,
    updateSource: vi.fn(async () => undefined),
    revokeSource: vi.fn(async () => undefined),
    syncJobLabel: (k: string) => `${k} sync`,
  }
})
vi.mock('@/packages/background', () => ({
  useBackgroundJobs: (scopeId?: string) => h.jobs.filter((j) => scopeId === undefined || j.scopeId === scopeId),
  startJob: vi.fn(),
  stopJob: vi.fn(async () => undefined),
  runJobFix: vi.fn(async () => undefined),
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: <T,>(selector: (s: { backgroundPaused: boolean }) => T) => selector({ backgroundPaused: h.paused }),
}))
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn() }))
vi.mock('@/platform', () => ({
  default: {
    getWindowLabel: vi.fn(async () => h.windowLabel),
    openInMain: vi.fn(async () => undefined),
  },
  platformCapabilities: { supportsDesktopOnlySettings: true },
}))
vi.mock('./AddSourceSheet', () => ({
  SOURCES_SETTINGS_ROUTE: '/settings/sources',
  openAddSourceSheet: vi.fn(async () => null),
  openConfiguration: vi.fn(async () => undefined),
}))
vi.mock('@/lib/startNewChat', () => ({ startNewChat: vi.fn() }))
vi.mock('@/components/layout/Page', () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))
vi.mock('@/components/knowledge/KnowledgeTab', () => ({ KnowledgeTab: () => null }))

import { runJobFix, startJob, stopJob } from '@/packages/background'
import { pushUndo } from '@/packages/undo'
import { ScopePageView } from '../scope/ScopePage'
import { ScopeSourcesTab } from '../scope/ScopeSourcesTab'
import { openAddSourceSheet, openConfiguration } from './AddSourceSheet'
import { BackgroundWork } from './BackgroundWork'
import { _resetPendingRemovalsForTests } from './SourceRow'

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)
const scope = { id: 'dango', name: 'Dango', kind: 'project' } as Scope

const source = (over: Partial<ConnectedSource> = {}): ConnectedSource => ({
  id: 's1',
  kind: 'folder',
  scopeId: 'dango',
  label: 'chaeboxi',
  backgroundReview: false,
  localOnly: false,
  config: {},
  connectedAt: NOW - 86_400_000,
  ...over,
})

const job = (over: Partial<BackgroundJob> = {}): BackgroundJob => ({
  id: 'j1',
  scopeId: 'dango',
  kind: 'sync',
  label: 'Folder sync',
  status: 'running',
  attempts: 0,
  startedAt: NOW - 1000,
  sourceId: 's1',
  ...over,
})

async function settle() {
  // Lets the window-label lookup settle.
  await act(async () => {})
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(NOW)
  h.sources = []
  h.jobs = []
  h.paused = false
  h.windowLabel = 'main'
  vi.clearAllMocks()
})

afterEach(() => {
  _resetPendingRemovalsForTests()
  cleanup()
  vi.useRealTimers()
})

describe('BackgroundWork', () => {
  it('shows a running sync with Stop', async () => {
    h.jobs = [job({ progress: 'Reading 3 of 40 files' })]
    render(<BackgroundWork scopeId="dango" />)
    await settle()
    expect(screen.getByRole('heading', { name: 'Background work' })).toBeTruthy()
    expect(screen.getByText('Folder sync')).toBeTruthy()
    expect(screen.getByText('Reading 3 of 40 files')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Stop/ })).toBeTruthy()
    cleanup()
    h.jobs = [job()]
    render(<BackgroundWork scopeId="dango" />)
    await settle()
    expect(screen.getByText('Starting…')).toBeTruthy()
  })

  it('Stop calls stopJob and its undo restarts the job', async () => {
    h.sources = [source()]
    h.jobs = [job()]
    render(<BackgroundWork scopeId="dango" />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    await settle()
    expect(stopJob).toHaveBeenCalledWith('j1')
    expect(pushUndo).toHaveBeenCalledTimes(1)
    const input = vi.mocked(pushUndo).mock.calls[0][0]
    expect(input.message).toBe('Stopped Folder sync')
    expect(input.group).toBe('other')
    await act(async () => {
      await input.undo()
    })
    expect(startJob).toHaveBeenCalledWith({
      scopeId: 'dango',
      kind: 'sync',
      label: 'Folder sync',
      sourceId: 's1',
      sourceLabel: 'chaeboxi',
    })
  })

  it('a waiting retry says Trying again shortly and no count', async () => {
    h.jobs = [job({ attempts: 2, nextRetryAt: NOW + 60_000 })]
    render(<BackgroundWork scopeId="dango" />)
    await settle()
    expect(screen.getByText('Trying again shortly')).toBeTruthy()
    expect(document.body.textContent ?? '').not.toMatch(/attempt|\d+ of \d+|\b2\b/i)
    cleanup()
    h.paused = true
    render(<BackgroundWork scopeId="dango" />)
    await settle()
    expect(screen.getByText('Paused')).toBeTruthy()
  })

  it('needs-you shows the fix button that calls runJobFix', async () => {
    h.jobs = [
      job({
        id: 'j2',
        status: 'needs-you',
        error: 'sign in again',
        fix: { action: 'reconnect', label: 'Sign in again' },
        finishedAt: NOW - 10,
      }),
    ]
    render(<BackgroundWork scopeId="dango" />)
    await settle()
    expect(screen.getByText('Folder sync stopped: sign in again')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }))
    await settle()
    expect(runJobFix).toHaveBeenCalledWith('j2')
  })

  it('lists the five newest finished jobs: done outcome, Stopped', async () => {
    h.jobs = [
      job({ id: 'a', status: 'done', outcome: 'Read 12 files', startedAt: NOW - 100, finishedAt: NOW - 50 }),
      job({ id: 'b', status: 'failed', stoppedAt: NOW - 200, startedAt: NOW - 300, finishedAt: NOW - 200 }),
      ...[1, 2, 3, 4].map((n) =>
        job({
          id: `old${n}`,
          status: 'done',
          outcome: `Old ${n}`,
          startedAt: NOW - 1000 * n,
          finishedAt: NOW - 900 * n,
        })
      ),
    ]
    render(<BackgroundWork scopeId="dango" />)
    await settle()
    expect(screen.getByText('Read 12 files')).toBeTruthy()
    expect(screen.getByText('Stopped')).toBeTruthy()
    expect(screen.getByText('Old 3')).toBeTruthy()
    expect(screen.queryByText('Old 4')).toBeNull()
  })

  it('renders nothing for a scope without jobs', async () => {
    h.jobs = [job({ scopeId: 'other' })]
    const { container } = render(<BackgroundWork scopeId="dango" />)
    await settle()
    expect(container.innerHTML).toBe('')
  })

  it('announces status changes, not progress ticks', async () => {
    h.jobs = [job()]
    const { rerender } = render(<BackgroundWork scopeId="dango" />)
    await settle()
    const live = document.querySelector('[aria-live="polite"]') as HTMLElement
    expect(live).toBeTruthy()
    expect(live.textContent).toBe('')
    h.jobs = [job({ progress: 'Reading 3 of 40 files' })]
    rerender(<BackgroundWork scopeId="dango" />)
    expect(live.textContent).toBe('')
    expect(live.contains(screen.getByText('Reading 3 of 40 files'))).toBe(false)
    h.jobs = [job({ status: 'done', outcome: 'Read 40 files', finishedAt: NOW })]
    rerender(<BackgroundWork scopeId="dango" />)
    expect(live.textContent).toBe('Folder sync done')
  })

  it('the quick window never stops or fixes jobs and opens the scope in the main window', async () => {
    h.windowLabel = 'quick'
    h.jobs = [
      job({ id: 'run', kind: 'review', label: 'Background review of chaeboxi' }),
      job({
        id: 'stuck',
        status: 'needs-you',
        error: 'the folder is gone',
        fix: { action: 'relink-folder', label: 'Find the folder' },
        startedAt: NOW - 5000,
        finishedAt: NOW - 10,
      }),
    ]
    render(<BackgroundWork scopeId="dango" />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: /Stop/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Find the folder' }))
    await settle()
    expect(stopJob).not.toHaveBeenCalled()
    expect(runJobFix).not.toHaveBeenCalled()
    expect(startJob).not.toHaveBeenCalled()
    expect(openConfiguration).toHaveBeenCalledWith('/scope/dango')
  })
})

describe('ScopeSourcesTab', () => {
  it("the Sources tab lists only this scope's sources and opens the sheet preselected", async () => {
    h.sources = [source(), source({ id: 's2', kind: 'gmail', scopeId: 'acme', label: 'me@acme.com' })]
    render(<ScopeSourcesTab scope={scope} />)
    await settle()
    expect(screen.getByText('chaeboxi')).toBeTruthy()
    expect(screen.queryByText('me@acme.com')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add a source…' }))
    await settle()
    expect(openAddSourceSheet).toHaveBeenCalledWith({ scopeId: 'dango' })
  })

  it('shows Background work under the sources', async () => {
    h.sources = [source()]
    h.jobs = [job({ progress: 'Reading 3 of 40 files' })]
    render(<ScopeSourcesTab scope={scope} />)
    await settle()
    expect(screen.getByRole('heading', { name: 'Background work' })).toBeTruthy()
  })

  it('empty says No sources yet., also while the only source waits out its undo', async () => {
    render(<ScopeSourcesTab scope={scope} />)
    await settle()
    expect(screen.getByText('No sources yet.')).toBeTruthy()
    cleanup()
    h.sources = [source()]
    render(<ScopeSourcesTab scope={scope} />)
    await settle()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for chaeboxi' }))
    await settle()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await settle()
    expect(screen.queryByText('chaeboxi')).toBeNull()
    expect(screen.getByText('No sources yet.')).toBeTruthy()
  })
})

describe('ScopePageView folder drop', () => {
  const pageProps = {
    scope,
    chats: [],
    knowledgeCount: 0,
    tab: 'overview' as const,
    folderBound: false,
    onTabChange: vi.fn(),
    onNewChat: vi.fn(),
    onOpenChat: vi.fn(),
    settings: null,
    files: null,
  }

  const dataTransfer = (isDirectory: boolean) => ({
    types: ['Files'],
    files: [{ name: 'chaeboxi', path: '/Users/me/chaeboxi' }],
    items: [{ kind: 'file', webkitGetAsEntry: () => ({ isDirectory, isFile: !isDirectory }) }],
  })

  it('dropping a folder opens the sheet at Folder without passing a path', async () => {
    render(<ScopePageView {...pageProps} />)
    const target = screen.getByRole('heading', { level: 2, name: 'Dango' })
    fireEvent.dragOver(target, { dataTransfer: dataTransfer(true) })
    fireEvent.drop(target, { dataTransfer: dataTransfer(true) })
    await settle()
    expect(openAddSourceSheet).toHaveBeenCalledTimes(1)
    expect(vi.mocked(openAddSourceSheet).mock.calls[0]).toEqual([{ scopeId: 'dango', kind: 'folder' }])
  })

  it('dropping a file does nothing', async () => {
    render(<ScopePageView {...pageProps} />)
    fireEvent.drop(screen.getByRole('heading', { level: 2, name: 'Dango' }), { dataTransfer: dataTransfer(false) })
    await settle()
    expect(openAddSourceSheet).not.toHaveBeenCalled()
  })
})
