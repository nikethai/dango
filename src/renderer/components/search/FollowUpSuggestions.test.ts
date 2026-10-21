import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  sessionSettings: { provider: 'openai', modelId: 'gpt' } as Record<string, unknown>,
  messages: [] as unknown[],
  getModel: vi.fn(() => ({ modelId: 'm' })),
  generateText: vi.fn(async () => ({ contentParts: [{ type: 'text', text: '["One?", "Two?", "Three?"]' }] })),
}))

vi.mock('@shared/models', () => ({ getModel: h.getModel }))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn(async () => ({})) }))
vi.mock('@/i18n/locales', () => ({ languageNameMap: { en: 'English' } }))
vi.mock('@/packages/model-calls', () => ({ generateText: h.generateText }))
vi.mock('@/platform', () => ({ default: { getConfig: vi.fn(async () => ({})) } }))
vi.mock('@/stores/chatStore', () => ({
  getSessionSettings: vi.fn(async () => h.sessionSettings),
  getSession: vi.fn(async () => ({ id: 's1', messages: h.messages })),
  updateMessage: vi.fn(),
}))
vi.mock('@/stores/session/messages', () => ({ submitNewUserMessage: vi.fn() }))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ getSettings: () => ({ language: 'en', providers: {} }) }) },
}))
vi.mock('@/utils/xai-auth-refresh', () => ({ refreshXaiAuthIfNeeded: vi.fn(async (s: unknown) => s) }))
vi.mock('@/utils/openai-codex-auth-refresh', () => ({ refreshOpenAICodexAuthIfNeeded: vi.fn(async (s: unknown) => s) }))
vi.mock('@/utils/gemini-antigravity-auth-refresh', () => ({
  refreshGeminiAntigravityAuthIfNeeded: vi.fn(async (s: unknown) => s),
}))

import { generateFollowUpSuggestions } from './FollowUpSuggestions'

const localOnlyRecall = {
  id: 'm1',
  role: 'assistant',
  contentParts: [
    {
      type: 'tool-call',
      state: 'result',
      toolCallId: 'c1',
      toolName: 'client_recall',
      args: {},
      result: { ok: true, records: [], gaps: [], localOnly: true },
    },
    { type: 'text', text: 'Jo said 4,200 USD.' },
  ],
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sessionSettings = { provider: 'openai', modelId: 'gpt' }
  h.messages = []
})

describe('generateFollowUpSuggestions on local-only text (S13)', () => {
  it('sends a local-only answer to no cloud model', async () => {
    const out = await generateFollowUpSuggestions({ sessionId: 's1', answer: 'Jo said 4,200 USD.', localOnly: true })
    expect(out).toEqual([])
    expect(h.getModel).not.toHaveBeenCalled()
    expect(h.generateText).not.toHaveBeenCalled()
  })

  it('asks a local model', async () => {
    h.sessionSettings = { provider: 'ollama', modelId: 'm' }
    const out = await generateFollowUpSuggestions({ sessionId: 's1', answer: 'Jo said 4,200 USD.', localOnly: true })
    expect(h.getModel).toHaveBeenCalled()
    expect(out).toEqual(['One?', 'Two?', 'Three?'])
  })

  it('treats a later answer in a chat holding local-only text like that text', async () => {
    h.messages = [localOnlyRecall, { id: 'm2', role: 'user', contentParts: [] }]
    expect(await generateFollowUpSuggestions({ sessionId: 's1', answer: 'As I said, 4,200 USD.' })).toEqual([])
    h.messages = [{ id: 'm0', role: 'assistant', pmQuestionId: 'q1', contentParts: [] }]
    expect(await generateFollowUpSuggestions({ sessionId: 's1', answer: 'As I said, 4,200 USD.' })).toEqual([])
    expect(h.getModel).not.toHaveBeenCalled()
  })

  it('asks a cloud model about an ordinary answer', async () => {
    h.messages = [{ id: 'm1', role: 'assistant', contentParts: [{ type: 'text', text: 'Hi' }] }]
    const out = await generateFollowUpSuggestions({ sessionId: 's1', answer: 'Hi' })
    expect(h.getModel).toHaveBeenCalled()
    expect(out).toEqual(['One?', 'Two?', 'Three?'])
  })
})
