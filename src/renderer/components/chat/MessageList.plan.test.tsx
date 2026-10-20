/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import type { Message as MessageType, Session } from '@shared/types'
import { cleanup, render, screen, within } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ capabilities: { supportsDesktopOnlySettings: true } }))

// The row stub shows the card's offer exactly when MessageList hands it the handler.
vi.mock('./Message', () => ({
  default: (props: { msg: MessageType; onTurnOnPlanMode?: () => Promise<void> }) => (
    <div data-testid={`row-${props.msg.id}`}>
      {props.onTurnOnPlanMode ? <button type="button">Turn on plan mode</button> : null}
    </div>
  ),
}))
vi.mock('react-virtuoso', () => ({
  Virtuoso: (props: { data: MessageType[]; itemContent: (index: number, msg: MessageType) => ReactNode }) => (
    <div>{props.data.map((msg, index) => props.itemContent(index, msg))}</div>
  ),
}))
vi.mock('@/platform', () => ({
  default: { type: 'web', getPlatform: async () => 'linux' },
  platformCapabilities: h.capabilities,
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
  const i18n = createInstance()
  await i18n.use(initReactI18next).init({ lng: 'en', resources: { en: { translation: {} } } })
})

afterEach(() => {
  cleanup()
  h.capabilities.supportsDesktopOnlySettings = true
})

/** A chat whose stopped plan's Continue is blocked by plan mode being off. */
function chat(agentIds?: string[]): Session {
  return {
    id: 's1',
    name: 'Plan',
    type: 'chat',
    agentIds,
    messages: [
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Tidy the docs' }] },
      {
        id: 'a1',
        role: 'assistant',
        contentParts: [{ type: 'plan', planText: '1. One', status: 'approved', version: 1, startedAt: 1 }],
      },
    ],
  } as Session
}

function renderList(session: Session) {
  render(
    <MantineProvider>
      <MessageList currentSession={session} />
    </MantineProvider>
  )
}

describe('MessageList: Turn on plan mode on a stopped plan', () => {
  it('is offered in a one-agent chat with desktop settings', () => {
    renderList(chat(['agent-a']))
    expect(within(screen.getByTestId('row-a1')).getByRole('button', { name: 'Turn on plan mode' })).toBeTruthy()
  })

  it('is not offered in a room of two or more agents', () => {
    renderList(chat(['agent-a', 'agent-b']))
    expect(screen.getByTestId('row-a1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Turn on plan mode' })).toBeNull()
  })

  it('is not offered without desktop-only settings (web, mobile)', () => {
    h.capabilities.supportsDesktopOnlySettings = false
    renderList(chat())
    expect(screen.getByTestId('row-a1')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Turn on plan mode' })).toBeNull()
  })
})
