/**
 * @vitest-environment jsdom
 */

import type { BackgroundJob } from '@shared/types/background'
import type { ConnectedSource } from '@shared/types/sources'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const interpolate = (key: string, opts?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''))
  return {
    interpolate,
    sources: [] as ConnectedSource[],
    loaded: true,
    jobs: [] as BackgroundJob[],
    paused: false,
    windowLabel: 'main' as string,
  }
})

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: h.interpolate }) }))
vi.mock('@/i18n', () => ({ default: { t: h.interpolate } }))

vi.mock('@/packages/sources', () => {
  const kind = (k: string, name: string, extra: Record<string, unknown> = {}) => ({
    kind: k,
    name,
    hint: '',
    supportsBackgroundReview: k !== 'documents',
    isAvailable: () => true,
    pick: vi.fn(),
    ...extra,
  })
  const kinds = [
    kind('folder', 'Folder', { sync: vi.fn() }),
    kind('gmail', 'Gmail'),
    kind('asana', 'Asana'),
    kind('codex-threads', 'Codex threads', { sync: vi.fn() }),
    kind('documents', 'Documents', { sync: vi.fn() }),
  ]
  return {
    listSourceKinds: () => kinds,
    getSourceKind: (k: string) => kinds.find((d) => d.kind === k),
    useSources: (filter?: { scopeId?: string }) =>
      h.sources.filter((s) => filter?.scopeId === undefined || s.scopeId === filter.scopeId),
    useSourcesLoaded: () => h.loaded,
    updateSource: vi.fn(async () => undefined),
    revokeSource: vi.fn(async () => undefined),
    syncJobLabel: (k: string) => `${k} sync`,
  }
})
vi.mock('@/packages/background', () => ({
  useBackgroundJobs: () => h.jobs,
  startJob: vi.fn(),
  runJobFix: vi.fn(async () => undefined),
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: <T,>(selector: (s: { backgroundPaused: boolean }) => T) => selector({ backgroundPaused: h.paused }),
}))
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn() }))
vi.mock('@/hooks/useScopes', () => ({
  useScopes: () => ({
    scopes: [
      { id: 'dango', name: 'Dango', kind: 'project' },
      { id: 'acme', name: 'Acme Co', kind: 'client' },
    ],
  }),
}))
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

import { runJobFix, startJob } from '@/packages/background'
import { revokeSource, updateSource } from '@/packages/sources'
import { pushUndo } from '@/packages/undo'
import { openAddSourceSheet, openConfiguration } from './AddSourceSheet'
import { _resetPendingRemovalsForTests, sourceStatusLine } from './SourceRow'
import { SourcesSettings } from './SourcesSettings'

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0)

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

async function renderPage() {
  render(<SourcesSettings />)
  // Lets the window-label lookup settle.
  await act(async () => {})
}

async function openMenu(label: string) {
  fireEvent.click(screen.getByRole('button', { name: `Actions for ${label}` }))
  await act(async () => {})
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  vi.setSystemTime(NOW)
  h.sources = []
  h.loaded = true
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

describe('sourceStatusLine', () => {
  it('paused with a waiting job says Paused', () => {
    const line = sourceStatusLine(source(), [job({ nextRetryAt: NOW + 60_000 })], NOW, true)
    expect(line.text).toBe('Paused')
    expect(line.fix).toBeUndefined()
  })

  it('running shows the progress, else Syncing… or Reviewing…', () => {
    expect(sourceStatusLine(source(), [job({ progress: 'Reading 3 of 40 files' })], NOW, false).text).toBe(
      'Reading 3 of 40 files'
    )
    expect(sourceStatusLine(source(), [job()], NOW, false).text).toBe('Syncing…')
    expect(sourceStatusLine(source(), [job({ kind: 'review' })], NOW, false).text).toBe('Reviewing…')
  })

  it('needs-you shows "{label} stopped: {error}" with the fix', () => {
    const fix = { action: 'relink-folder' as const, label: 'Find the folder' }
    const line = sourceStatusLine(
      source({ lastSyncAt: NOW - 3_600_000 }),
      [job({ status: 'needs-you', error: 'the folder is gone', fix, finishedAt: NOW - 10 })],
      NOW,
      false
    )
    expect(line).toEqual({ text: 'Folder sync stopped: the folder is gone', fix, jobId: 'j1' })
  })

  it('synced 5 min ago', () => {
    const done = job({ status: 'done', finishedAt: NOW - 300_000 })
    expect(sourceStatusLine(source({ lastSyncAt: NOW - 300_000 }), [done], NOW, false).text).toBe('Synced 5 min ago')
  })

  it('never synced says Connected', () => {
    expect(sourceStatusLine(source(), [], NOW, false)).toEqual({ text: 'Connected' })
  })

  it('ignores other sources’ jobs', () => {
    expect(sourceStatusLine(source(), [job({ sourceId: 'other' })], NOW, false).text).toBe('Connected')
  })
})

describe('SourcesSettings', () => {
  it('groups rows by scope name with kind and label', async () => {
    h.sources = [
      source(),
      source({ id: 's2', kind: 'gmail', scopeId: 'acme', label: 'me@acme.com' }),
      source({ id: 's3', kind: 'documents', scopeId: 'everywhere', label: 'Handbook' }),
    ]
    await renderPage()
    const headings = screen.getAllByRole('heading', { level: 3 }).map((el) => el.textContent)
    expect(headings).toEqual(['Everywhere', 'Dango', 'Acme Co'])
    expect(screen.getByText('chaeboxi')).toBeTruthy()
    expect(screen.getByText('me@acme.com')).toBeTruthy()
    expect(screen.getByText('Gmail')).toBeTruthy()
  })

  it('turning the switch on saves backgroundReview', async () => {
    h.sources = [source()]
    await renderPage()
    const toggle = screen.getByRole('switch', { name: 'Background review' })
    expect(toggle.getAttribute('aria-checked')).toBe('false')
    expect(
      screen.getByText(
        'Lets Dango read this source on a schedule to propose knowledge. Reading never makes anything authoritative.'
      )
    ).toBeTruthy()
    fireEvent.click(toggle)
    await act(async () => {})
    expect(updateSource).toHaveBeenCalledWith('s1', { backgroundReview: true })
  })

  it('kinds without background review have no switch', async () => {
    h.sources = [source({ kind: 'documents', label: 'Handbook' })]
    await renderPage()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  it('remove waits 5 s and Undo keeps the source', async () => {
    h.sources = [source()]
    await renderPage()
    await openMenu('chaeboxi')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    expect(screen.queryByText('chaeboxi')).toBeNull()
    expect(pushUndo).toHaveBeenCalledTimes(1)
    const input = vi.mocked(pushUndo).mock.calls[0][0]
    expect(input.message).toBe('Removed chaeboxi. Approved knowledge stays.')
    expect(input.group).toBe('other')
    await act(async () => {
      await input.undo()
    })
    await act(() => vi.advanceTimersByTimeAsync(6000))
    expect(revokeSource).not.toHaveBeenCalled()
    expect(screen.getByText('chaeboxi')).toBeTruthy()

    await openMenu('chaeboxi')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Remove' }))
    await act(() => vi.advanceTimersByTimeAsync(4999))
    expect(revokeSource).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(revokeSource).toHaveBeenCalledTimes(1)
    expect(revokeSource).toHaveBeenCalledWith('s1')
  })

  it('a needs-you row shows the fix as its button and no retry count', async () => {
    h.sources = [source({ lastSyncAt: NOW - 3_600_000 })]
    h.jobs = [
      job({
        status: 'needs-you',
        attempts: 4,
        error: 'the folder is gone',
        fix: { action: 'relink-folder', label: 'Find the folder' },
        finishedAt: NOW - 10,
      }),
    ]
    await renderPage()
    expect(screen.getByText('Folder sync stopped: the folder is gone')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Find the folder' }))
    await act(async () => {})
    expect(runJobFix).toHaveBeenCalledWith('j1')
    expect(document.body.textContent ?? '').not.toMatch(/attempt|retry|\d+ of \d+/i)
  })

  it('Sync now starts a sync, also for a source that never synced', async () => {
    h.sources = [source()]
    await renderPage()
    await openMenu('chaeboxi')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Sync now' }))
    expect(startJob).toHaveBeenCalledWith({
      kind: 'sync',
      label: 'folder sync',
      scopeId: 'dango',
      sourceId: 's1',
      sourceLabel: 'chaeboxi',
    })
  })

  it('kinds that cannot sync have no Sync now', async () => {
    h.sources = [source({ kind: 'gmail', label: 'me@acme.com' })]
    await renderPage()
    await openMenu('me@acme.com')
    expect(screen.queryByRole('menuitem', { name: 'Sync now' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Remove' })).toBeTruthy()
  })

  it('the quick window never offers Sync now and sends fixes to the main window', async () => {
    h.windowLabel = 'quick'
    h.sources = [source()]
    h.jobs = [
      job({
        status: 'needs-you',
        error: 'the folder is gone',
        fix: { action: 'relink-folder', label: 'Find the folder' },
        finishedAt: NOW - 10,
      }),
    ]
    await renderPage()
    await openMenu('chaeboxi')
    expect(screen.queryByRole('menuitem', { name: 'Sync now' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Find the folder' }))
    await act(async () => {})
    expect(runJobFix).not.toHaveBeenCalled()
    expect(openConfiguration).toHaveBeenCalledWith('/settings/sources')
  })

  it('Add a source opens the sheet with no scope', async () => {
    h.sources = [source()]
    await renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))
    await act(async () => {})
    expect(openAddSourceSheet).toHaveBeenCalledWith({})
  })

  it('empty state copy', async () => {
    await renderPage()
    expect(screen.getByText('No sources yet.')).toBeTruthy()
    expect(
      screen.getByText('Connect a folder, Gmail, Asana, Codex threads or documents so Dango can learn about your work.')
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))
    await act(async () => {})
    expect(openAddSourceSheet).toHaveBeenCalledWith({})
  })

  it('shows nothing before sources have loaded', async () => {
    h.loaded = false
    await renderPage()
    expect(screen.queryByText('No sources yet.')).toBeNull()
  })
})
