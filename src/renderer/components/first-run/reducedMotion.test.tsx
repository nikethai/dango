// @vitest-environment jsdom
// A11Y1 rule 2 (slice 09 Task 10): with reduced motion, the screens this slice adds hold the mascot still (idle pose,
// no animated parts) and write its state. Uses the real Mascot.
import type { BackgroundJob } from '@shared/types/background'
import type { ConnectedSource } from '@shared/types/sources'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_: string, name: string) => String(vars?.[name] ?? name)),
  }),
}))

const h = vi.hoisted(() => ({
  state: {
    firstRun: { step: 5, sourceSkipped: false, firstReadJobId: 'j1', firstReadSourceId: 'src1', completedAt: 5 },
    shortcuts: { quickToggle: 'CommandOrControl+Shift+Space' },
  },
  jobs: [] as BackgroundJob[],
  sources: [] as ConnectedSource[],
}))

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: typeof h.state) => unknown) => sel(h.state),
}))
vi.mock('@/packages/background', () => ({ useBackgroundJobs: () => h.jobs, stopJob: vi.fn(async () => {}) }))
vi.mock('@/packages/sources', () => ({ useSources: () => h.sources }))
vi.mock('@/platform', () => ({ default: { type: 'desktop' } }))
vi.mock('@/components/Shortcut', () => ({ formatShortcutLabel: (k: string) => k }))
vi.mock('@/packages/navigator', () => ({ getOS: () => 'Windows' }))

import { FirstReadCard } from './FirstReadCard'
import { FirstRunCard } from './FirstRunCard'

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal('matchMedia', (media: string) => ({
    matches: media === '(prefers-reduced-motion: reduce)' ? matches : false,
    media,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

/** Mascot parts that animate (the working ring spins, thinking and replying dots pulse). */
const ANIMATED_PARTS = '.ring, .dots'

function expectStill(container: HTMLElement) {
  const mascots = Array.from(container.querySelectorAll('svg.dg-mascot'))
  expect(mascots.length).toBeGreaterThan(0)
  for (const svg of mascots) {
    expect(svg.getAttribute('data-pose')).toBe('idle')
    expect(svg.getAttribute('class')).toBe('dg-mascot')
    expect(svg.querySelector(ANIMATED_PARTS)).toBeNull()
  }
  for (const el of Array.from(container.querySelectorAll('[class]'))) {
    expect(el.getAttribute('class') ?? '').not.toMatch(/anim|spin|pulse|bounce|shimmer/)
  }
}

beforeEach(() => {
  stubReducedMotion(true)
  h.jobs = [
    {
      id: 'j1',
      scopeId: 's1',
      kind: 'sync',
      label: 'Folder sync',
      status: 'running',
      attempts: 0,
      startedAt: 10,
      sourceId: 'src1',
      progress: 'Reading your folder · 12 files',
    },
  ]
  h.sources = [
    {
      id: 'src1',
      kind: 'folder',
      scopeId: 's1',
      label: 'dango',
      backgroundReview: true,
      localOnly: false,
      config: {},
      connectedAt: 1,
    },
  ]
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('reduced motion on first-run screens', () => {
  it('FirstRunCard: the mascot holds its idle pose with no animated parts', () => {
    const { container } = render(
      <FirstRunCard step={2} title="Connect a source" footer={null}>
        {null}
      </FirstRunCard>
    )
    expectStill(container)
  })

  it('FirstReadCard: the working mascot holds still and writes "Working"', () => {
    const { container } = render(<FirstReadCard />)
    expectStill(container)
    const svg = container.querySelector('svg.dg-mascot')
    expect(svg?.getAttribute('data-state')).toBe('working')
    expect(screen.getByText('Working', { exact: true }).className).toBe('dango-mascot__state')
  })

  it('without reduced motion, FirstReadCard shows the working pose (the check above is not vacuous)', () => {
    stubReducedMotion(false)
    const { container } = render(<FirstReadCard />)
    expect(container.querySelector('svg.dg-mascot')?.getAttribute('data-pose')).toBe('working')
    expect(container.querySelector('svg.dg-mascot .ring')).not.toBeNull()
    expect(screen.queryByText('Working', { exact: true })).toBeNull()
  })
})
