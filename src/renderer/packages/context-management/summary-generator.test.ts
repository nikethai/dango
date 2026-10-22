import { createMessage, type Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The summary model call is mocked; what it is sent is checked. Compaction and "New chat with summary" both summarise
// through these two functions.

const h = vi.hoisted(() => ({
  settings: { provider: 'openai', modelId: 'gpt-5', language: 'en' } as Record<string, unknown>,
  sent: [] as unknown[],
  localOnly: new Set<string>(['q1']),
}))

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('@shared/models', () => ({
  getModel: vi.fn(() => ({
    isSupportVision: () => false,
    chat: vi.fn((messages: unknown) => {
      h.sent.push(messages)
      return Promise.resolve({ contentParts: [{ type: 'text', text: 'Summary' }] })
    }),
  })),
}))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn(async () => ({})) }))
vi.mock('@/platform', () => ({ default: { getConfig: vi.fn(async () => ({})) } }))
vi.mock('@/stores/settingActions', () => ({ getRemoteConfig: () => ({}) }))
vi.mock('@/stores/settingsStore', () => ({ settingsStore: { getState: () => ({ getSettings: () => h.settings }) } }))
vi.mock('@/packages/model-calls', () => ({
  generateText: vi.fn((_model: unknown, messages: unknown) => {
    h.sent.push(messages)
    return Promise.resolve({ contentParts: [{ type: 'text', text: 'Summary' }] })
  }),
}))
vi.mock('@/packages/model-calls/message-utils', () => ({
  convertToModelMessages: vi.fn(async (messages: unknown) => messages),
}))
vi.mock('@/packages/model-calls/toolsets/pm-pilot', () => ({
  loadLocalOnlyQuestionIds: vi.fn(async (ids: string[]) => new Set(ids.filter((id) => h.localOnly.has(id)))),
}))

import { summaryLocalOnlyMarks } from '@/packages/model-calls/toolsets/pm-pilot-history'
import { buildContextForAI } from './context-builder'
import { generateSummary, generateSummaryWithStream } from './summary-generator'

const ch6 = (): Message[] => [
  { ...createMessage('assistant', 'Jo asks for the quote. I found 8,400 and 9,100.'), pmQuestionId: 'q1' },
  createMessage('user', 'Which is newer?'),
  createMessage('assistant', 'Jo wrote 8,400 on 12 Sep.'),
]

beforeEach(() => {
  h.sent = []
  h.settings = { provider: 'openai', modelId: 'gpt-5', language: 'en' }
  h.localOnly = new Set(['q1'])
})

describe('summaries of a chat with local-only client mail', () => {
  it('compaction and "New chat with summary" send no local-only mail to a cloud summary model', async () => {
    await generateSummary({ messages: ch6(), sessionSettings: { provider: 'openai', modelId: 'gpt-5' } })
    await generateSummaryWithStream({ messages: ch6(), sessionSettings: { provider: 'openai', modelId: 'gpt-5' } })
    expect(h.sent).toHaveLength(2)
    for (const sent of h.sent) {
      expect(JSON.stringify(sent)).not.toContain('8,400')
      expect(JSON.stringify(sent)).toContain('Which is newer?')
    }
  })

  it('a local summary model, or a question that is shareable, gets the chat as it is', async () => {
    await generateSummary({ messages: ch6(), sessionSettings: { provider: 'ollama', modelId: 'llama' } })
    h.localOnly = new Set()
    await generateSummaryWithStream({ messages: ch6(), sessionSettings: { provider: 'openai', modelId: 'gpt-5' } })
    for (const sent of h.sent) expect(JSON.stringify(sent)).toContain('8,400')
  })

  it('decides by the model that summarises (a cloud naming model for a local chat)', async () => {
    h.settings = { ...h.settings, threadNamingModel: { provider: 'openai', model: 'gpt-5-mini' } }
    await generateSummary({ messages: ch6(), sessionSettings: { provider: 'ollama', modelId: 'llama' } })
    expect(JSON.stringify(h.sent[0])).not.toContain('8,400')
  })
})

describe('compaction of a chat whose local-only recall is more than 2 rounds old (review I1)', () => {
  const oldRecallChat = (): Message[] => [
    createMessage('user', 'What did Jo quote?'),
    {
      ...createMessage('assistant', ''),
      contentParts: [
        {
          type: 'tool-call',
          state: 'result',
          toolCallId: 'r1',
          toolName: 'client_recall',
          args: { query: 'quote' },
          result: { localOnly: true },
        },
        { type: 'text', text: 'Jo wrote 8,400.' },
      ],
    },
    createMessage('user', 'a'),
    createMessage('assistant', 'b'),
    createMessage('user', 'c'),
    createMessage('assistant', 'd'),
  ]

  it('marks the summary and sends a cloud summarizer no recall answer', async () => {
    // compaction.ts builds the summary input and its marks from the cleaned context.
    const context = buildContextForAI({ messages: oldRecallChat() })
    expect(context[1].contentParts.some((p) => p.type === 'tool-call')).toBe(false)
    expect(summaryLocalOnlyMarks(context)).toEqual({ pmLocalOnly: true })
    await generateSummary({ messages: context, sessionSettings: { provider: 'openai', modelId: 'gpt-5' } })
    expect(h.sent).toHaveLength(1)
    expect(JSON.stringify(h.sent[0])).not.toContain('8,400')
  })
})
