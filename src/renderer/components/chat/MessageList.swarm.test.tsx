/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import type { Message as MessageType, Session } from '@shared/types'
import { act, cleanup, render, screen } from '@testing-library/react'
import i18next from 'i18next'
import type { ReactNode } from 'react'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import { setTeamRoomLive } from '@/stores/session/team-room-state'

vi.mock('./Message', () => ({
  default: (props: { msg: MessageType }) => <div data-testid={`row-${props.msg.id}`} />,
}))
vi.mock('react-virtuoso', () => ({
  Virtuoso: (props: { data: MessageType[]; itemContent: (index: number, msg: MessageType) => ReactNode }) => (
    <div>{props.data.map((msg, index) => props.itemContent(index, msg))}</div>
  ),
}))
vi.mock('@/platform', () => ({
  default: { type: 'web', getPlatform: async () => 'linux' },
  platformCapabilities: { supportsDesktopOnlySettings: true },
}))
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ getScope: () => undefined }) }))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => false }))
vi.mock('@/stores/session/plan-mode', () => ({ turnOnChatPlanMode: vi.fn(async () => {}) }))
vi.mock('@/stores/sessionActions', () => ({
  deleteFork: vi.fn(),
  expandFork: vi.fn(),
  moveThreadToConversations: vi.fn(),
  removeMessage: vi.fn(),
  removeThread: vi.fn(),
  switchFork: vi.fn(),
  switchThread: vi.fn(),
}))

import MessageList from './MessageList'

beforeAll(async () => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  })
  await i18next.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: en } } })
})

afterEach(() => {
  cleanup()
  act(() => setTeamRoomLive(null))
})

function user(id: string): MessageType {
  return { id, role: 'user', contentParts: [{ type: 'text', text: 'Go' }] } as MessageType
}

function turn(id: string, roomRole: 'plan' | 'do' | 'deliver', agent: string, runId: string): MessageType {
  return {
    id,
    role: 'assistant',
    contentParts: [{ type: 'text', text: agent }],
    agentId: agent.toLowerCase(),
    name: agent,
    roomRole,
    swarm: { runId, ...(roomRole === 'do' ? { taskTitle: `${agent} task` } : {}) },
  } as MessageType
}

function chat(messages: MessageType[], extra: Partial<Session> = {}): Session {
  return { id: 's1', name: 'Swarm', type: 'chat', agentIds: ['ana', 'bo'], messages, ...extra } as Session
}

function renderList(session: Session) {
  render(
    <MantineProvider>
      <MessageList currentSession={session} />
    </MantineProvider>
  )
}

describe('MessageList: Swarm runs fold into one answer', () => {
  it('shows the answer and "Worked with" instead of the agent turns', () => {
    renderList(
      chat([
        user('u1'),
        turn('p1', 'plan', 'Ana', 'r1'),
        turn('d1', 'do', 'Bo', 'r1'),
        turn('a1', 'deliver', 'Ana', 'r1'),
      ])
    )
    expect(screen.getByTestId('row-u1')).toBeTruthy()
    expect(screen.getByTestId('row-a1')).toBeTruthy()
    expect(screen.queryByTestId('row-p1')).toBeNull()
    expect(screen.queryByTestId('row-d1')).toBeNull()
    expect(screen.getByText('Worked with 2 agents · 1 round')).toBeTruthy()
  })

  it('shows one live card for the run that is running', () => {
    act(() => setTeamRoomLive({ sessionId: 's1', mode: 'swarm', phase: 'plan', agentCount: 2, runId: 'r1' }))
    renderList(chat([user('u1'), turn('p1', 'plan', 'Ana', 'r1')]))
    expect(screen.queryByTestId('row-p1')).toBeNull()
    expect(screen.getByText('Working with 2 agents · planning')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(1)
  })

  it('keeps the live card under the answer while the captain writes', () => {
    act(() => setTeamRoomLive({ sessionId: 's1', mode: 'swarm', phase: 'deliver', agentCount: 2, runId: 'r1' }))
    renderList(chat([user('u1'), turn('p1', 'plan', 'Ana', 'r1'), turn('a1', 'deliver', 'Ana', 'r1')]))
    expect(screen.getByTestId('row-a1')).toBeTruthy()
    expect(screen.getByText('Working with 2 agents · writing the answer')).toBeTruthy()
    expect(screen.queryByText(/Worked with/)).toBeNull()
  })

  it('an earlier run with no answer is not the live one (R26)', () => {
    act(() => setTeamRoomLive({ sessionId: 's1', mode: 'swarm', phase: 'plan', agentCount: 2, runId: 'r2' }))
    renderList(
      chat([
        user('u1'),
        turn('p1', 'plan', 'Ana', 'r1'),
        turn('d1', 'do', 'Bo', 'r1'),
        user('u2'),
        turn('p2', 'plan', 'Ana', 'r2'),
      ])
    )
    expect(screen.getByText('Worked with 2 agents · stopped before an answer')).toBeTruthy()
    expect(screen.getByText('Working with 2 agents · planning')).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(1)
  })

  it('a Redo of a folded do turn (no answer, nothing live) reads "stopped before an answer"', () => {
    renderList(chat([user('u1'), turn('p1', 'plan', 'Ana', 'r1'), turn('d1b', 'do', 'Bo', 'r1')]))
    expect(screen.getByText('Worked with 2 agents · stopped before an answer')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
  })

  it('moves the fork switcher of a hidden turn onto the run', () => {
    const forks = {
      d1: {
        position: 1,
        lists: [
          { id: 'l1', messages: [] },
          { id: 'l2', messages: [] },
        ],
        createdAt: 1,
      },
    }
    renderList(
      chat(
        [user('u1'), turn('p1', 'plan', 'Ana', 'r1'), turn('d1', 'do', 'Bo', 'r1'), turn('a1', 'deliver', 'Ana', 'r1')],
        { messageForksHash: forks }
      )
    )
    expect(screen.getByText('2 / 2')).toBeTruthy()
  })

  it('leaves chats without Swarm as they were', () => {
    renderList(chat([user('u1'), { ...turn('x1', 'plan', 'Ana', 'r1'), swarm: undefined }]))
    expect(screen.getByTestId('row-x1')).toBeTruthy()
    expect(screen.queryByText(/Worked with/)).toBeNull()
  })
})
