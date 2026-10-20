// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import { setTeamRoomLive } from '@/stores/session/team-room-state'
import type { SwarmRun } from './foldSwarmRuns'
import { SwarmLiveCard } from './SwarmLiveCard'
import { SwarmWorkedWith } from './SwarmWorkedWith'

const h = vi.hoisted(() => ({
  requestSwarmStop: vi.fn(async (_sessionId: string) => {}),
  stopChatIfRunning: vi.fn(async (_sessionId: string) => true),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, vars?: Record<string, unknown>) => i18next.t(key, vars ?? {}) }),
}))
vi.mock('@/stores/session/team-room-state', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/stores/session/team-room-state')>()
  return { ...actual, requestSwarmStop: h.requestSwarmStop }
})
vi.mock('@/stores/session/stop-generation', () => ({ stopChatIfRunning: h.stopChatIfRunning }))

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: { en: { translation: en } } })
})

afterEach(() => {
  cleanup()
  act(() => setTeamRoomLive(null))
  h.requestSwarmStop.mockClear()
  h.stopChatIfRunning.mockClear()
})

function goLive(over: Record<string, unknown> = {}) {
  act(() =>
    setTeamRoomLive({
      sessionId: 's1',
      mode: 'swarm',
      phase: 'do',
      agentCount: 3,
      taskIndex: 1,
      taskTotal: 2,
      runId: 'r1',
      ...over,
    })
  )
}

describe('SwarmLiveCard', () => {
  it('renders nothing when no Swarm runs in this chat', () => {
    const { container } = render(<SwarmLiveCard sessionId="s1" />)
    expect(container.innerHTML).toBe('')
  })

  it('shows the phase and the working mascot', () => {
    goLive()
    render(<SwarmLiveCard sessionId="s1" />)
    expect(screen.getByText('Working with 3 agents · round 1 of 2')).toBeTruthy()
    expect(document.querySelector('.dg-mascot[data-state="working"]')).toBeTruthy()
  })

  it('Stop stops the run and turns disabled', () => {
    goLive()
    render(<SwarmLiveCard sessionId="s1" />)
    const stop = screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement
    expect(stop.disabled).toBe(false)
    act(() => {
      fireEvent.click(stop)
    })
    expect(h.requestSwarmStop).toHaveBeenCalledWith('s1')
    expect(h.stopChatIfRunning).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('Stop while the captain writes is an ordinary stop of that answer', async () => {
    goLive({ phase: 'deliver' })
    render(<SwarmLiveCard sessionId="s1" />)
    expect(screen.getByText('Working with 3 agents · writing the answer')).toBeTruthy()
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    })
    await waitFor(() => expect(h.stopChatIfRunning).toHaveBeenCalledWith('s1'))
    expect(h.requestSwarmStop).not.toHaveBeenCalled()
  })

  it('shows only for the run that is live (R26)', () => {
    goLive({ runId: 'r2' })
    const { container } = render(<SwarmLiveCard sessionId="s1" runId="r1" />)
    expect(container.innerHTML).toBe('')
  })

  it('ignores a Swarm running in another chat', () => {
    goLive({ sessionId: 's2' })
    const { container } = render(<SwarmLiveCard sessionId="s1" />)
    expect(container.innerHTML).toBe('')
  })
})

function makeRun(over: Partial<SwarmRun> = {}): SwarmRun {
  return {
    runId: 'r1',
    agents: [
      {
        agentId: 'ana',
        name: 'Ana',
        provider: 'team-proxy',
        model: 'gpt-5',
        captain: true,
        contribution: ['Planned the work', 'Wrote the answer'],
      },
      { agentId: 'bo', name: 'Bo', captain: false, contribution: ['Draft intro'] },
      { agentId: 'cy', name: 'Cy', captain: false, contribution: ['Check numbers'] },
    ],
    rounds: 2,
    tokens: 12_400,
    stoppedEarly: false,
    answerId: 'a1',
    ...over,
  }
}

describe('SwarmWorkedWith', () => {
  it('is collapsed by default and opens to one row per agent', () => {
    render(<SwarmWorkedWith run={makeRun()} />)
    const details = document.querySelector('details') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
    fireEvent.click(screen.getByText('Worked with 3 agents · 2 rounds · 12.4k tokens'))
    expect(details.open).toBe(true)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('Ana')
    expect(rows[0].textContent).toContain('captain')
    expect(rows[0].textContent).toContain('team-proxy · gpt-5')
    expect(rows[0].textContent).toContain('Planned the work; Wrote the answer')
    expect(rows[1].textContent).not.toContain('captain')
    expect(rows[1].textContent).not.toContain(' · gpt')
  })

  it('says "Stopped early" when the run was stopped', () => {
    render(<SwarmWorkedWith run={makeRun({ stoppedEarly: true })} />)
    expect(screen.getByText('Stopped early')).toBeTruthy()
  })

  it('does not say "Stopped early" for a finished run', () => {
    render(<SwarmWorkedWith run={makeRun()} />)
    expect(screen.queryByText('Stopped early')).toBeNull()
  })

  it('a run with no answer reads "stopped before an answer"', () => {
    render(<SwarmWorkedWith run={makeRun({ answerId: undefined })} />)
    expect(screen.getByText('Worked with 3 agents · stopped before an answer')).toBeTruthy()
  })
})
