// @vitest-environment jsdom
import type { ConnectedSource } from '@shared/types/sources'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  interpolate: (key: string, opts?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? '')),
  role: 'jobs' as string,
}))

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
    kind('gmail', 'Gmail', { sync: vi.fn() }),
    kind('asana', 'Asana', { sync: vi.fn() }),
    kind('codex-threads', 'Codex threads', { sync: vi.fn() }),
    kind('documents', 'Documents', { sync: vi.fn() }),
  ]
  return {
    getSourceKind: (k: string) => kinds.find((d) => d.kind === k),
    updateSource: vi.fn(async () => undefined),
    revokeSource: vi.fn(async () => undefined),
    syncJobLabel: (k: string) => `${k} sync`,
    BACKGROUND_REVIEW_LINE: 'Background review line',
  }
})
vi.mock('@/packages/background', () => ({
  useBackgroundJobs: () => [],
  startJob: vi.fn(),
  runJobFix: vi.fn(async () => undefined),
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: <T,>(selector: (s: { backgroundPaused: boolean }) => T) => selector({ backgroundPaused: false }),
}))
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn() }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/hooks/useWindowRole', () => ({ useWindowRole: () => h.role }))
vi.mock('@/hooks/useNow', () => ({ useNow: () => 0 }))
vi.mock('./AddSourceSheet', () => ({
  SOURCES_SETTINGS_ROUTE: '/settings/sources',
  openConfiguration: vi.fn(async () => undefined),
}))

import { updateSource } from '@/packages/sources'
import { openConfiguration } from './AddSourceSheet'
import { SourceRow } from './SourceRow'

const LABEL = 'Keep on this device only'
const HELP = 'Emails and tasks from this source are never sent to a cloud model'

const source = (over: Partial<ConnectedSource> = {}): ConnectedSource => ({
  id: 's1',
  kind: 'gmail',
  scopeId: 'acme',
  label: 'pm@agency.com',
  backgroundReview: false,
  localOnly: false,
  config: {},
  connectedAt: 0,
  ...over,
})

async function renderRow(s: ConnectedSource) {
  render(
    <ul>
      <SourceRow source={s} />
    </ul>
  )
  await act(async () => {})
}

beforeEach(() => {
  h.role = 'jobs'
  vi.clearAllMocks()
})

afterEach(() => cleanup())

describe('SourceRow local-only switch', () => {
  it('the switch shows for Gmail and Asana only', async () => {
    for (const kind of ['gmail', 'asana'] as const) {
      await renderRow(source({ kind }))
      const toggle = screen.getByRole('switch', { name: LABEL })
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      expect(toggle.getAttribute('aria-describedby')).toBe(screen.getByText(HELP).id)
      cleanup()
    }
    for (const kind of ['folder', 'codex-threads', 'documents'] as const) {
      await renderRow(source({ kind }))
      expect(screen.queryByRole('switch', { name: LABEL })).toBeNull()
      expect(screen.queryByText(HELP)).toBeNull()
      cleanup()
    }
  })

  it('toggling it calls updateSource with localOnly', async () => {
    await renderRow(source())
    fireEvent.click(screen.getByRole('switch', { name: LABEL }))
    await act(async () => {})
    expect(updateSource).toHaveBeenCalledWith('s1', { localOnly: true })
    cleanup()

    await renderRow(source({ kind: 'asana', localOnly: true }))
    const on = screen.getByRole('switch', { name: LABEL })
    expect(on.getAttribute('aria-checked')).toBe('true')
    fireEvent.click(on)
    await act(async () => {})
    expect(updateSource).toHaveBeenLastCalledWith('s1', { localOnly: false })
  })

  it('outside the jobs window it opens Sources in the main window instead', async () => {
    h.role = 'quick'
    await renderRow(source())
    fireEvent.click(screen.getByRole('switch', { name: LABEL }))
    await act(async () => {})
    expect(updateSource).not.toHaveBeenCalled()
    expect(openConfiguration).toHaveBeenCalledWith('/settings/sources')
  })
})
