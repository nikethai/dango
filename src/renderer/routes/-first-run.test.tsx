// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen } from '@testing-library/react'
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

  it('shows the step card', () => {
    render(<Page />)
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in to a model' })).toBeTruthy()
    expect(screen.getByLabelText('Step 1 of 5')).toBeTruthy()
    expect(h.navigate).not.toHaveBeenCalled()
  })

  it('shows the resolved step', () => {
    h.resolution = { show: true, step: 3, modelOnly: false }
    render(<Page />)
    expect(screen.getByRole('heading', { level: 1, name: 'Name this scope' })).toBeTruthy()
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
