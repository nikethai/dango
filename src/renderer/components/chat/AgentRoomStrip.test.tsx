// @vitest-environment jsdom

import { MantineProvider } from '@mantine/core'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { setTeamRoomLive } from '@/stores/session/team-room-state'
import AgentRoomStrip from './AgentRoomStrip'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/hooks/useCopilots', () => ({
  useMyCopilots: () => ({
    copilots: [
      { id: 'ana', name: 'Ana', emojiAvatar: 'A' },
      { id: 'bo', name: 'Bo', emojiAvatar: 'B' },
    ],
  }),
  useRemoteCopilots: () => ({ copilots: [] }),
}))

beforeAll(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
})

afterEach(() => {
  cleanup()
  act(() => setTeamRoomLive(null))
})

function renderStrip() {
  return render(
    <MantineProvider>
      <AgentRoomStrip agentIds={['ana', 'bo']} sessionId="s1" />
    </MantineProvider>
  )
}

describe('AgentRoomStrip', () => {
  it('shows no Swarm progress (the thread card shows it)', () => {
    act(() =>
      setTeamRoomLive({
        sessionId: 's1',
        mode: 'swarm',
        phase: 'do',
        speakerName: 'Bo',
        taskIndex: 1,
        taskTotal: 2,
        taskTitle: 'Draft intro',
        agentCount: 2,
        runId: 'r1',
      })
    )
    const { container } = renderStrip()
    expect(screen.getByText('Ana')).toBeTruthy()
    const text = container.textContent ?? ''
    expect(text).not.toContain('Draft intro')
    expect(text).not.toContain('Working')
    expect(text).not.toContain('Task')
    expect(text).not.toMatch(/1\/2|1 of 2/)
  })
})
