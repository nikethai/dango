import { createMessage, type Message, type Session } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const generateText = vi.hoisted(() => vi.fn())
const getModel = vi.hoisted(() => vi.fn((..._args: unknown[]) => ({ name: 'namer' })))
const session = vi.hoisted(() => ({ current: null as unknown }))
const global = vi.hoisted(() => ({ current: {} as Record<string, unknown> }))

vi.mock('@sentry/react', () => ({ captureException: vi.fn() }))
vi.mock('@shared/models', () => ({ getModel: (...args: unknown[]) => getModel(...args) }))
vi.mock('@/adapters', () => ({ createModelDependencies: vi.fn(async () => ({})) }))
vi.mock('@/packages/model-calls', () => ({ generateText: (...args: unknown[]) => generateText(...args) }))
vi.mock('@/platform', () => ({ default: { getConfig: vi.fn(async () => ({})) } }))
vi.mock('../chatStore', () => ({ getSession: vi.fn(async () => session.current), updateSession: vi.fn() }))
vi.mock('../settingsStore', () => ({ settingsStore: { getState: () => ({ getSettings: () => global.current }) } }))
vi.mock('@/packages/model-calls/toolsets/pm-pilot', () => ({ loadLocalOnlyQuestionIds: async () => new Set() }))

import { scheduleGenerateNameAndThreadName } from './naming'

const recall: Message = {
  ...createMessage('assistant', ''),
  contentParts: [
    {
      type: 'tool-call',
      state: 'result',
      toolCallId: 'c1',
      toolName: 'client_recall',
      args: { query: 'price' },
      result: { ok: true, records: [{ text: 'The price is 4,200' }], localOnly: true },
    },
    { type: 'text', text: 'Jo quoted 4,200.' },
  ],
}

async function nameNow() {
  vi.useFakeTimers()
  try {
    scheduleGenerateNameAndThreadName('s1')
    await vi.runAllTimersAsync()
  } finally {
    vi.useRealTimers()
  }
  await vi.waitFor(() => expect(generateText).toHaveBeenCalled())
  return JSON.stringify(generateText.mock.calls[0][1])
}

beforeEach(() => {
  generateText.mockReset().mockResolvedValue({ contentParts: [{ type: 'text', text: 'Quote' }] })
  getModel.mockClear()
  session.current = {
    id: 's1',
    name: 'Untitled',
    messages: [createMessage('user', 'What did Jo quote?'), recall],
    settings: { provider: 'ollama', modelId: 'llama3' },
  } as unknown as Session
})

describe('thread naming keeps local-only recalls off a cloud naming model (final review I3)', () => {
  it('a cloud threadNamingModel gets the placeholder, not the recalled mail', async () => {
    global.current = { language: 'en', threadNamingModel: { provider: 'openai', model: 'gpt-4o-mini' } }
    const sent = await nameNow()
    expect(getModel.mock.calls[0][0]).toMatchObject({ provider: 'openai' })
    expect(sent).not.toContain('4,200')
    expect(sent).toContain('What did Jo quote?')
  })

  it("the chat's own local model may read it", async () => {
    global.current = { language: 'en' }
    const sent = await nameNow()
    expect(getModel.mock.calls[0][0]).toMatchObject({ provider: 'ollama' })
    expect(sent).toContain('4,200')
  })
})
