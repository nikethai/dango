// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  search: {} as { from?: string },
  navigate: vi.fn(),
  resolution: { show: true, step: 1, modelOnly: false } as
    | { show: false }
    | { show: true; step: 1 | 2 | 3 | 4 | 5; modelOnly: boolean },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({ options, useSearch: () => h.search }),
  useNavigate: () => h.navigate,
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, v?: Record<string, unknown>) => k.replace('{{n}}', String(v?.n)) }),
}))
vi.mock('@/components/brand/Mascot', () => ({ Mascot: () => null }))
vi.mock('@/components/first-run/ModelStep', () => ({
  ModelStep: ({ modelOnly, from }: { modelOnly: boolean; from?: string }) => (
    <div data-testid="model-step" data-model-only={String(modelOnly)} data-from={from ?? ''} />
  ),
}))
const steps = vi.hoisted(() => ({
  source: null as null | {
    onNext: (draft: unknown, backgroundReview: boolean) => void
    error?: { text: string }
  },
  scope: null as null | {
    draft: unknown
    backgroundReview: boolean
    onDraftLost?: (error: { text: string }) => void
  },
}))
vi.mock('@/components/first-run/SourceStep', () => ({
  SourceStep: (p: NonNullable<typeof steps.source>) => {
    steps.source = p
    return <div data-testid="source-step" data-error={p.error?.text ?? ''} />
  },
}))
vi.mock('@/components/first-run/ScopeStep', () => ({
  ScopeStep: (p: NonNullable<typeof steps.scope>) => {
    steps.scope = p
    return <div data-testid="scope-step" data-has-draft={String(p.draft !== null)} />
  },
}))
vi.mock('@/packages/first-run', async () => {
  const actual = await vi.importActual<typeof import('@/packages/first-run/firstRun')>('@/packages/first-run/firstRun')
  return {
    firstRunFrom: actual.firstRunFrom,
    useFirstRunResolution: () => h.resolution,
  }
})

import { Route } from './first-run'

beforeEach(() => {
  h.search = {}
  h.navigate.mockReset()
  h.resolution = { show: true, step: 1, modelOnly: false }
})
afterEach(cleanup)

const Page = Route.options.component as () => JSX.Element

describe('/first-run', () => {
  it('validates from as an in-app path', () => {
    const validate = Route.options.validateSearch as (s: Record<string, unknown>) => { from?: string }
    expect(validate({ from: '/session/abc' })).toEqual({ from: '/session/abc' })
    expect(validate({ from: 'https://evil.example' })).toEqual({ from: undefined })
  })

  it('step 1 renders the model step', () => {
    render(<Page />)
    const step = screen.getByTestId('model-step')
    expect(step.getAttribute('data-model-only')).toBe('false')
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('step 1 with modelOnly passes modelOnly and from to the model step', () => {
    h.search = { from: '/session/abc' }
    h.resolution = { show: true, step: 1, modelOnly: true }
    render(<Page />)
    const step = screen.getByTestId('model-step')
    expect(step.getAttribute('data-model-only')).toBe('true')
    expect(step.getAttribute('data-from')).toBe('/session/abc')
  })

  it('shows the resolved step', () => {
    h.resolution = { show: true, step: 4, modelOnly: false }
    render(<Page />)
    expect(screen.getByRole('heading', { level: 1, name: 'How much should it do on its own?' })).toBeTruthy()
    expect(screen.getByLabelText('Step 4 of 5')).toBeTruthy()
  })

  it('step 2 renders the source step, then the scope step with the picked draft (kept in memory only)', () => {
    h.resolution = { show: true, step: 2, modelOnly: false }
    render(<Page />)
    expect(screen.getByTestId('source-step')).toBeTruthy()
    const draft = { kind: 'folder', label: 'dango', config: {} }
    act(() => steps.source?.onNext(draft, true))
    expect(screen.getByTestId('scope-step').getAttribute('data-has-draft')).toBe('true')
    expect(steps.scope?.draft).toBe(draft)
    expect(steps.scope?.backgroundReview).toBe(true)
  })

  it('a draft lost in step 3 goes back to the source step with the error', () => {
    h.resolution = { show: true, step: 2, modelOnly: false }
    render(<Page />)
    act(() => steps.source?.onNext({ kind: 'folder', label: 'dango', config: {} }, true))
    act(() => steps.scope?.onDraftLost?.({ text: 'This folder already belongs to Acme.' }))
    expect(screen.getByTestId('source-step').getAttribute('data-error')).toBe('This folder already belongs to Acme.')
  })

  it('step 3 (source skipped, or a relaunch) renders the scope step without a draft', () => {
    h.resolution = { show: true, step: 3, modelOnly: false }
    render(<Page />)
    expect(screen.getByTestId('scope-step').getAttribute('data-has-draft')).toBe('false')
  })

  it('writes no record itself (the gate in __root does)', () => {
    expect(readFileSync(resolve(__dirname, 'first-run.tsx'), 'utf8')).not.toContain('setFirstRun')
  })

  it('returns where the user was once there is nothing to show', () => {
    h.search = { from: '/session/abc?thread=t1#m2' }
    h.resolution = { show: false }
    const { container } = render(<Page />)
    expect(container.innerHTML).toBe('')
    expect(h.navigate).toHaveBeenCalledWith({ href: '/session/abc?thread=t1#m2', replace: true })
  })

  it('goes to Review when there is no from', () => {
    h.resolution = { show: false }
    render(<Page />)
    expect(h.navigate).toHaveBeenCalledWith({ href: '/', replace: true })
  })
})

describe('__root wiring', () => {
  const root = readFileSync(resolve(__dirname, '__root.tsx'), 'utf8')
  it('gates first run instead of showing the welcome dialog', () => {
    expect(root).toContain('useFirstRunGate(location.pathname, goToFirstRun, firstRunFromPath)')
    expect(root).toContain('location.searchStr')
    expect(root).not.toContain("'welcome'")
    expect(root).not.toContain('needEditSetting')
  })
  it('hides the sidebar on /first-run', () => {
    expect(root).toContain('const hideAppChrome = isSettingsRoute || isFirstRunRoute')
    expect(root).toContain('{!hideAppChrome && <Sidebar />}')
  })
})
