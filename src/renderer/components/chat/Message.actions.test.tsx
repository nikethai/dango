/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import type { Message as MessageType } from '@shared/types'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'

// The model list is a portal: the selector reports open/close, which the test drives directly.
vi.mock('../ModelSelector', () => ({
  ModelSelector: (props: { children: ReactNode; onDropdownOpen?: () => void; onDropdownClose?: () => void }) => (
    <>
      {props.children}
      <span data-testid="open-models" onClick={() => props.onDropdownOpen?.()} />
      <span data-testid="close-models" onClick={() => props.onDropdownClose?.()} />
    </>
  ),
}))
vi.mock('./ThinkingLine', () => ({ ThinkingLine: () => null }))
vi.mock('../message-parts/ThinkingGroupUI', () => ({ ThinkingGroupUI: () => null }))
vi.mock('../plan/PlanCard', () => ({ default: () => null }))
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
  resumeStoppedPlan: vi.fn(),
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

afterEach(cleanup)

const answer = {
  id: 'a1',
  role: 'assistant',
  contentParts: [{ type: 'text', text: 'Hello' }],
  model: 'GPT-5',
} as MessageType

describe('Message answer row', () => {
  it('stays visible while the Redo model list is open, and hides on hover again once it closes', async () => {
    const { container } = render(
      <MantineProvider>
        <Message sessionId="s1" sessionType="chat" msg={answer} />
      </MantineProvider>
    )
    await screen.findByRole('button', { name: 'Redo' })
    const row = () => container.querySelector('.msg-actions') as HTMLElement
    expect(row().classList.contains('is-visible')).toBe(false)

    act(() => fireEvent.click(screen.getByTestId('open-models')))
    expect(row().classList.contains('is-visible')).toBe(true)

    act(() => fireEvent.click(screen.getByTestId('close-models')))
    expect(row().classList.contains('is-visible')).toBe(false)
  })
})
