/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import type { MessageContentParts, Message as MessageType } from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'

const h = vi.hoisted(() => ({
  lines: [] as Array<{ live: boolean; showMascot?: boolean }>,
  groups: [] as Array<{ showMascot: boolean }>,
  cards: [] as Array<{ generating: boolean; touchesFiles: boolean }>,
}))

vi.mock('./ThinkingLine', () => ({
  ThinkingLine: (props: { live: boolean; showMascot?: boolean }) => {
    h.lines.push(props)
    return <div data-testid="thinking-line" />
  },
}))
vi.mock('../message-parts/ThinkingGroupUI', () => ({
  ThinkingGroupUI: (props: { showMascot: boolean }) => {
    h.groups.push(props)
    return <div data-testid="thinking-group" />
  },
}))
vi.mock('../plan/PlanCard', () => ({
  default: (props: { generating: boolean; touchesFiles: boolean }) => {
    h.cards.push(props)
    return <div data-testid="plan-card" />
  },
}))
vi.mock('../message-parts/ToolCallPartUI', () => ({ ToolCallPartUI: () => null }))
vi.mock('../message-parts/TodoAppCard', () => ({ TodoAppCard: () => null }))
vi.mock('@/components/Markdown', () => ({ default: () => null }))
vi.mock('@/components/knowledge', () => ({ KnowledgeProposalCard: () => null }))
vi.mock('../search/FollowUpSuggestions', () => ({ default: () => null }))
vi.mock('../search/SourceCardList', () => ({ SourceCardList: () => null }))
vi.mock('../Artifact', () => ({
  deriveMessageArtifacts: () => [],
  getPreviousArtifactVersion: async () => undefined,
  MessageArtifact: () => null,
  isContainRenderableCode: () => false,
}))
vi.mock('@/stores/sessionActions', () => ({
  approveAndExecutePlan: vi.fn(),
  generateMore: vi.fn(),
  modifyMessage: vi.fn(),
  regenerateInNewFork: vi.fn(),
  rejectPlan: vi.fn(),
  removeMessage: vi.fn(),
  requestPlanChanges: vi.fn(),
  submitNewUserMessage: vi.fn(),
}))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: vi.fn() }))
vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }))
vi.mock('@/platform', () => ({ default: { formFactor: 'desktop' } }))
vi.mock('@/components/chat/AgentSpeakerHeader', () => ({ default: () => null }))
vi.mock('./save-as-knowledge', () => ({ saveAsKnowledgeFromMessage: vi.fn() }))

import Message from './Message'

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
  await createInstance()
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

afterEach(() => {
  cleanup()
  h.lines.length = 0
  h.groups.length = 0
  h.cards.length = 0
})

function message(contentParts: MessageContentParts, generating: boolean): MessageType {
  return { id: 'm1', role: 'assistant', contentParts, generating, timestamp: Date.now() } as MessageType
}

const searching: MessageContentParts[number] = {
  type: 'tool-call',
  toolCallId: 'w1',
  toolName: 'web_search',
  state: 'call',
  args: { query: 'dango' },
}

function renderMessage(msg: MessageType, planTouchesFiles = false) {
  return render(
    <MantineProvider>
      <Message sessionId="s1" sessionType="chat" msg={msg} planTouchesFiles={planTouchesFiles} />
    </MantineProvider>
  )
}

describe('Message with a plan', () => {
  it('a generating message with an approved plan hides the live line mascot', async () => {
    renderMessage(
      message(
        [{ type: 'plan', planText: '1. Find\n2. Log', status: 'approved', startedAt: Date.now() }, searching],
        true
      ),
      true
    )
    await screen.findByTestId('plan-card')
    await screen.findByTestId('thinking-group')
    expect(h.groups.length).toBeGreaterThan(0)
    expect(h.groups.every((g) => g.showMascot === false)).toBe(true)
    expect(h.lines.filter((l) => l.live).every((l) => l.showMascot === false)).toBe(true)
    expect(h.cards.at(-1)).toMatchObject({ generating: true, touchesFiles: true })
  })

  it('without a running plan the live line keeps its mascot', async () => {
    renderMessage(message([searching], true))
    await screen.findByTestId('thinking-group')
    expect(h.groups.every((g) => g.showMascot === true)).toBe(true)
  })
})
