// @vitest-environment jsdom
import type { BackgroundJob } from '@shared/types/background'
import type { ConnectedSource, SourceKind } from '@shared/types/sources'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))

const h = vi.hoisted(() => ({
  state: {
    firstRun: undefined as unknown,
    shortcuts: { quickToggle: 'CommandOrControl+Shift+Space' },
  },
  jobs: [] as BackgroundJob[],
  sources: [] as ConnectedSource[],
  stopJob: vi.fn(async () => {}),
  platformType: 'desktop',
  mascot: vi.fn(),
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: typeof h.state) => unknown) => sel(h.state),
}))
vi.mock('@/packages/background', () => ({
  useBackgroundJobs: () => h.jobs,
  stopJob: h.stopJob,
}))
vi.mock('@/packages/sources', () => ({ useSources: () => h.sources }))
vi.mock('@/platform', () => ({
  default: {
    get type() {
      return h.platformType
    },
  },
}))
vi.mock('@/components/Shortcut', () => ({
  formatShortcutLabel: (k: string) => ({ CommandOrControl: 'Ctrl', Shift: 'Shift', Space: 'Space' })[k] ?? k,
}))
vi.mock('@/packages/navigator', () => ({ getOS: () => 'Windows' }))
vi.mock('@/components/brand/Mascot', () => ({
  Mascot: (p: { state: string }) => {
    h.mascot(p.state)
    return <svg data-testid="mascot" data-state={p.state} />
  },
}))

import { FirstReadCard } from './FirstReadCard'

function source(kind: SourceKind = 'folder', patch: Partial<ConnectedSource> = {}): ConnectedSource {
  return {
    id: 'src1',
    kind,
    scopeId: 's1',
    label: 'dango',
    backgroundReview: true,
    localOnly: false,
    config: {},
    connectedAt: 1,
    ...patch,
  }
}

function job(patch: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id: 'j1',
    scopeId: 's1',
    kind: 'sync',
    label: 'Folder sync',
    status: 'running',
    attempts: 0,
    startedAt: 10,
    sourceId: 'src1',
    ...patch,
  }
}

beforeEach(() => {
  h.state.firstRun = { step: 5, sourceSkipped: false, firstReadJobId: 'j1', firstReadSourceId: 'src1', completedAt: 5 }
  h.state.shortcuts = { quickToggle: 'CommandOrControl+Shift+Space' }
  h.jobs = [job({ progress: 'Reading your folder · 12 files' })]
  h.sources = [source()]
  h.stopJob.mockClear()
  h.platformType = 'desktop'
  h.mascot.mockClear()
})
afterEach(cleanup)

describe('FirstReadCard (FR5)', () => {
  it('renders nothing without firstReadJobId (skipped source or upgrade)', () => {
    h.state.firstRun = { step: 5, sourceSkipped: true, completedAt: 5 }
    expect(render(<FirstReadCard />).container.innerHTML).toBe('')
    cleanup()
    h.state.firstRun = undefined
    expect(render(<FirstReadCard />).container.innerHTML).toBe('')
  })

  it('renders nothing when the job is done, failed, stopped or missing', () => {
    h.sources = [source('folder', { backgroundReview: false })]
    for (const jobs of [
      [job({ status: 'done' })],
      [job({ status: 'failed' })],
      [job({ status: 'failed', stoppedAt: 20 })],
      [],
    ]) {
      h.jobs = jobs
      expect(render(<FirstReadCard />).container.innerHTML).toBe('')
      cleanup()
    }
  })

  it('renders "Reading your folder…" and the job’s progress for a running folder job', () => {
    render(<FirstReadCard />)
    expect(screen.getByRole('heading', { name: 'Reading your folder…' })).toBeTruthy()
    expect(
      screen.getByText('Reading your folder · 12 files. Items appear here as they are found.', { exact: true })
    ).toBeTruthy()
  })

  it('without progress, the sub is the fixed line', () => {
    h.jobs = [job()]
    render(<FirstReadCard />)
    expect(screen.getByText('Items appear here as they are found.', { exact: true })).toBeTruthy()
  })

  it.each([
    ['gmail', 'Reading your Gmail…'],
    ['asana', 'Reading your Asana tasks…'],
    ['codex-threads', 'Reading your Codex threads…'],
    ['documents', 'Reading your documents…'],
  ] as const)('titles a %s source "%s"', (kind, title) => {
    h.sources = [source(kind)]
    render(<FirstReadCard />)
    expect(screen.getByRole('heading', { name: title })).toBeTruthy()
  })

  it('"Stop" calls stopJob(id) on the running job', () => {
    render(<FirstReadCard />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(h.stopJob).toHaveBeenCalledWith('j1')
  })

  it('stays through the first background review, and Stop stops the review', () => {
    h.jobs = [
      job({ id: 'r1', kind: 'review', startedAt: 30, progress: 'Reviewed 2 of 9 items' }),
      job({ status: 'done', finishedAt: 25 }),
    ]
    render(<FirstReadCard />)
    expect(screen.getByRole('heading', { name: 'Reading your folder…' })).toBeTruthy()
    expect(screen.getByText('Reviewed 2 of 9 items. Items appear here as they are found.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(h.stopJob).toHaveBeenCalledWith('r1')
  })

  it('has no live region (its line changes as files are counted)', () => {
    const { container } = render(<FirstReadCard />)
    expect(container.querySelector('[aria-live]')).toBeNull()
    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[role="alert"]')).toBeNull()
  })

  it('shows "Ask anything meanwhile" with the Quick Chat hotkey and the working mascot under the card', () => {
    const { container } = render(<FirstReadCard />)
    expect(screen.getByText('Ask anything meanwhile: Ctrl+Shift+Space.')).toBeTruthy()
    expect(h.mascot).toHaveBeenCalledWith('working')
    const card = container.querySelector('section') as HTMLElement
    const meanwhile = screen.getByText('Ask anything meanwhile: Ctrl+Shift+Space.')
    expect(card.contains(meanwhile)).toBe(false)
    expect(card.compareDocumentPosition(meanwhile) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('leaves out the hotkey line without a Quick Chat hotkey (none set, or not desktop)', () => {
    h.state.shortcuts = { quickToggle: '' }
    render(<FirstReadCard />)
    expect(screen.queryByText(/Ask anything meanwhile/)).toBeNull()
    expect(screen.getByTestId('mascot').getAttribute('data-state')).toBe('working')
    cleanup()
    h.state.shortcuts = { quickToggle: 'CommandOrControl+Shift+Space' }
    h.platformType = 'web'
    render(<FirstReadCard />)
    expect(screen.queryByText(/Ask anything meanwhile/)).toBeNull()
  })
})
