/**
 * @vitest-environment jsdom
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ agents: [] as unknown[], navigate: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}))
vi.mock('@/hooks/useCopilots', () => ({
  useMyCopilots: () => ({ copilots: state.agents, addOrUpdate: vi.fn(), remove: vi.fn() }),
  useRemoteCopilots: () => ({ copilots: [] }),
}))
vi.mock('@/stores/uiStore', () => ({
  useUIStore: (sel: (s: unknown) => unknown) =>
    sel({ showCopilotsInNewSession: true, setShowCopilotsInNewSession: vi.fn() }),
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => state.navigate }))
vi.mock('@/packages/event', () => ({ trackingEvent: vi.fn() }))
vi.mock('@/packages/remote', () => ({ recordCopilotShare: vi.fn() }))
vi.mock('@/platform', () => ({ default: { getConfig: async () => ({ uuid: 'u' }) } }))

import { AgentsSettings } from './AgentsSettings'

const src = (p: string) => readFileSync(resolve(process.cwd(), 'src/renderer', p), 'utf8')
const renderIt = () =>
  render(
    <MantineProvider>
      <AgentsSettings />
    </MantineProvider>
  )

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
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  state.agents = []
  state.navigate.mockClear()
})

describe('AgentsSettings', () => {
  it('shows the empty state', () => {
    renderIt()
    expect(screen.getByText('Agents')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'New agent' })).toBeTruthy()
    expect(screen.getByText('No agents yet. Create one, or add a featured agent below.')).toBeTruthy()
  })

  it('keeps a truncated agent name readable through its title', () => {
    state.agents = [{ id: 'a', name: 'Deep Research Assistant', prompt: 'p', starred: false, usedCount: 0 }]
    renderIt()
    expect(screen.getByText('Deep Research Assistant').getAttribute('title')).toBe('Deep Research Assistant')
  })

  it('lists an agent and opens its editor', () => {
    state.agents = [{ id: 'a', name: 'Researcher', prompt: 'p', starred: false, usedCount: 0 }]
    renderIt()
    expect(screen.getByRole('button', { name: /Researcher/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'edit' }))
    expect(screen.getByText('Edit agent')).toBeTruthy()
  })

  it('starts a chat with an agent when its tile is clicked', () => {
    state.agents = [{ id: 'a', name: 'Researcher', prompt: 'p', starred: false, usedCount: 0 }]
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: /Researcher/ }))
    expect(state.navigate).toHaveBeenCalledWith({ to: '/new', search: { copilotId: 'a' } })
  })
})

describe('agent tiles (A11Y1, Task 12 walk)', () => {
  it('no button inside a button: the tile opens a chat and its star, edit and delete are siblings', () => {
    state.agents = [{ id: 'a', name: 'Researcher', prompt: 'p', starred: false, usedCount: 0 }]
    const { container } = renderIt()
    expect(container.querySelectorAll('button button')).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Researcher' })).toBeTruthy()
    for (const name of ['star', 'edit', 'delete']) expect(screen.getByRole('button', { name })).toBeTruthy()
  })
})

describe('Copilots is only a redirect', () => {
  it('route files', () => {
    const c = src('routes/copilots.tsx')
    expect(c).toContain("throw redirect({ to: '/settings/agents' })")
    expect(c).not.toContain('export function')
    expect(src('routes/settings/agents.tsx')).toContain("from '@/components/settings/agents'")
  })
  it('nothing imports @/routes/copilots', () => {
    const walk = (d: string): string[] =>
      readdirSync(d).flatMap((f) => {
        const p = join(d, f)
        return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : []
      })
    const offenders = walk(resolve(process.cwd(), 'src/renderer')).filter(
      (f) => !f.endsWith('AgentsSettings.test.tsx') && readFileSync(f, 'utf8').includes('@/routes/copilots')
    )
    expect(offenders).toEqual([])
  })
})
