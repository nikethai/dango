/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import type { Message as MessageType, Session } from '@shared/types'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'

// The model list is a portal: the selector reports open/close, which the test drives directly.
vi.mock('../ModelSelector', () => ({
  ModelSelector: (props: {
    children: ReactNode
    onDropdownOpen?: () => void
    onDropdownClose?: () => void
    onSelect?: (provider: string, modelId: string) => void
  }) => (
    <>
      {props.children}
      <span data-testid="open-models" onClick={() => props.onDropdownOpen?.()} />
      <span data-testid="close-models" onClick={() => props.onDropdownClose?.()} />
      <span data-testid="pick-gpt-4o" onClick={() => props.onSelect?.('openai', 'gpt-4o')} />
    </>
  ),
}))
// More is a Mantine menu (a portal): its rows render as plain buttons here.
vi.mock('../ActionMenu', () => ({
  default: (props: { children: ReactNode; items: { text?: string; onClick?: () => void }[] }) => (
    <>
      {props.children}
      {props.items.map((item) =>
        item.text ? (
          <button key={item.text} type="button" onClick={item.onClick}>
            {item.text}
          </button>
        ) : null
      )}
    </>
  ),
}))
// Settings without persistence: the gate reads the cost limit and the providers from here.
const settings = vi.hoisted(() => ({ state: {} as Record<string, unknown> }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => settings.state },
  useSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => selector(settings.state),
}))
// The chat the gate reads before sending.
const chat = vi.hoisted(() => ({ session: undefined as unknown }))
vi.mock('@/stores/chatStore', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/stores/chatStore')>()),
  peekSession: () => chat.session,
  getSession: async () => chat.session,
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
const editAndResend = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('@/stores/session/edit-resend', () => ({ editAndResend }))
vi.mock('@/stores/session/branch', () => ({ branchChatFromMessage: vi.fn(() => Promise.resolve('copy')) }))

import { BeforeSendHost } from '@/components/chat/BeforeSendGate'
import { generateMore, regenerateInNewFork } from '@/stores/sessionActions'
import * as toastActions from '@/stores/toastActions'
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
beforeEach(() => {
  vi.clearAllMocks()
  chat.session = undefined
  settings.state = {}
})

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

describe('Message question edit', () => {
  const question = { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Old question' }] } as MessageType

  it('Edit opens the inline editor in place of the bubble; Send edits and resends', async () => {
    render(
      <MantineProvider>
        <Message sessionId="s1" sessionType="chat" msg={question} />
      </MantineProvider>
    )
    const edit = await screen.findByRole('button', { name: 'Edit' })
    act(() => fireEvent.click(edit))
    const field = screen.getByRole('textbox', { name: 'Edit message' }) as HTMLTextAreaElement
    expect(field.value).toBe('Old question')
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()

    fireEvent.change(field, { target: { value: 'New question' } })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    // The before-send gate answers first (asynchronously), then the edit is sent.
    await waitFor(() => expect(editAndResend).toHaveBeenCalledWith('s1', 'u1', 'New question'))
    expect(screen.queryByRole('textbox', { name: 'Edit message' })).toBeNull()
  })

  it('a failed edit-and-resend reopens the editor with the draft', async () => {
    editAndResend.mockImplementationOnce(() => Promise.reject(new Error('boom')))
    render(
      <MantineProvider>
        <Message sessionId="s1" sessionType="chat" msg={question} />
      </MantineProvider>
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: 'Draft text' } })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    const field = (await screen.findByRole('textbox', { name: 'Edit message' })) as HTMLTextAreaElement
    expect(field.value).toBe('Draft text')
    expect(toastActions.add).toHaveBeenCalledWith("Couldn't send that. Try again.")
  })
})

/** A chat on `model`, holding a question and its answer, with tools on when `agentMode`. */
function chatWith(model: { provider: string; modelId: string }, opts: { agentMode?: boolean } = {}): Session {
  return {
    id: 's1',
    name: 'Chat',
    type: 'chat',
    agentMode: opts.agentMode,
    settings: { provider: model.provider, modelId: model.modelId },
    messages: [
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Old question '.repeat(400) }] },
      { id: 'a1', role: 'assistant', contentParts: [{ type: 'text', text: 'Hello' }], model: 'GPT-5' },
    ],
  } as Session
}

// A local model never asks; gpt-4o with a 1¢ limit always asks (about 1 300 tokens in, 4 096 out ≈ 4¢).
const LOCAL = { provider: 'ollama', modelId: 'llama3' }
const PRICEY = { provider: 'openai', modelId: 'gpt-4o' }
const NO_TOOLS = { provider: 'openai', modelId: 'no-tools-model' }

describe('message actions are checked before sending (cost and abilities)', () => {
  const question = { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Old question' }] } as MessageType

  beforeEach(() => {
    settings.state = {
      costWarningUsd: 0.01,
      providers: {
        openai: { apiKey: 'sk-test', models: [{ modelId: 'gpt-4o' }, { modelId: 'no-tools-model', capabilities: [] }] },
        ollama: { models: [{ modelId: 'llama3' }] },
      },
    }
  })

  function renderMessage(msg: MessageType) {
    return render(
      <MantineProvider>
        <Message sessionId="s1" sessionType="chat" msg={msg} />
        <BeforeSendHost />
      </MantineProvider>
    )
  }

  it('Redo ▾ to an expensive model shows the sheet, priced at that model; Cancel does not generate', async () => {
    chat.session = chatWith(LOCAL)
    renderMessage(answer)
    await screen.findByRole('button', { name: 'Redo' })
    act(() => fireEvent.click(screen.getByTestId('pick-gpt-4o')))
    const sheet = await screen.findByRole('dialog', { name: /This run may cost about/ })
    expect(sheet.textContent).toMatch(/GPT.4o · about/)
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(regenerateInNewFork).not.toHaveBeenCalled()
  })

  it('Redo ▾ runs at the picked model once the sheet says Run', async () => {
    chat.session = chatWith(LOCAL)
    renderMessage(answer)
    await screen.findByRole('button', { name: 'Redo' })
    act(() => fireEvent.click(screen.getByTestId('pick-gpt-4o')))
    await screen.findByRole('dialog')
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Run' })))
    await waitFor(() => expect(regenerateInNewFork).toHaveBeenCalledWith('s1', answer, { modelOverride: PRICEY }))
  })

  it('plain Redo on a local model sends without asking', async () => {
    chat.session = chatWith(LOCAL)
    renderMessage(answer)
    fireEvent.click(await screen.findByRole('button', { name: 'Redo' }))
    await waitFor(() => expect(regenerateInNewFork).toHaveBeenCalledWith('s1', answer))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('plain Redo over the limit asks; Cancel does not generate', async () => {
    chat.session = chatWith(PRICEY)
    renderMessage(answer)
    fireEvent.click(await screen.findByRole('button', { name: 'Redo' }))
    await screen.findByRole('dialog', { name: /This run may cost about/ })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(regenerateInNewFork).not.toHaveBeenCalled()
  })

  it('plain Redo with Agent Mode on and a model without tools does not run and says why', async () => {
    chat.session = chatWith(NO_TOOLS, { agentMode: true })
    renderMessage(answer)
    fireEvent.click(await screen.findByRole('button', { name: 'Redo' }))
    await waitFor(() => expect(toastActions.add).toHaveBeenCalledWith(expect.stringContaining("can't use tools.")))
    expect(regenerateInNewFork).not.toHaveBeenCalled()
  })

  it('Reply Again Below over the limit asks; Cancel does not generate', async () => {
    chat.session = chatWith(PRICEY)
    renderMessage(question)
    fireEvent.click(await screen.findByRole('button', { name: 'Reply Again Below' }))
    await screen.findByRole('dialog', { name: /This run may cost about/ })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(generateMore).not.toHaveBeenCalled()
  })

  it('Reply Again Below with Agent Mode on and a model without tools does not run', async () => {
    chat.session = chatWith(NO_TOOLS, { agentMode: true })
    renderMessage(question)
    fireEvent.click(await screen.findByRole('button', { name: 'Reply Again Below' }))
    await waitFor(() => expect(toastActions.add).toHaveBeenCalledWith(expect.stringContaining("can't use tools.")))
    expect(generateMore).not.toHaveBeenCalled()
  })

  it('edit-and-resend with Agent Mode on and a model without tools does not send; the draft stays', async () => {
    chat.session = chatWith(NO_TOOLS, { agentMode: true })
    renderMessage(question)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: 'New question' } })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    await waitFor(() => expect(toastActions.add).toHaveBeenCalledWith(expect.stringContaining("can't use tools.")))
    expect(editAndResend).not.toHaveBeenCalled()
    const field = (await screen.findByRole('textbox', { name: 'Edit message' })) as HTMLTextAreaElement
    expect(field.value).toBe('New question')
  })

  it('edit-and-resend over the limit asks; Cancel does not send and keeps the draft', async () => {
    chat.session = chatWith(PRICEY)
    renderMessage(question)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: 'New question' } })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Send' })))
    await screen.findByRole('dialog', { name: /This run may cost about/ })
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Cancel' })))
    const field = (await screen.findByRole('textbox', { name: 'Edit message' })) as HTMLTextAreaElement
    expect(field.value).toBe('New question')
    expect(editAndResend).not.toHaveBeenCalled()
  })
})
