import type { Message, Session } from '@shared/types'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ list: [] as Session[] }))

vi.mock('../chatStore', () => ({
  ChatQueryKeys: { ChatSessionsList: ['chat-sessions-list'] },
  getSession: vi.fn((id: string) => Promise.resolve(structuredClone(store.list.find((s) => s.id === id) ?? null))),
  updateMessage: vi.fn((sessionId: string, messageId: string, update: (m: Message) => Message) => {
    const session = store.list.find((s) => s.id === sessionId)
    if (!session) return Promise.resolve()
    session.messages = session.messages.map((m) => (m.id === messageId ? update(m) : m))
    return Promise.resolve()
  }),
}))
vi.mock('@/stores/queryClient', () => ({ default: { getQueryData: () => undefined } }))
vi.mock('../settingsStore', () => ({ settingsStore: { getState: () => ({ customProviders: [] }) } }))

const generate = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('./generation', () => ({ generate, getOverflowTruncateLimit: vi.fn(async () => undefined) }))

const switchCurrentSession = vi.hoisted(() => vi.fn())
vi.mock('./crud', () => ({ switchCurrentSession }))

const review = vi.hoisted(() => ({
  addReviewEntry: vi.fn(async (input: unknown) => input),
  registerReviewOpener: vi.fn((_type: string, _open: (entry: unknown) => unknown, _opts?: unknown) => () => {}),
  setReviewEntryState: vi.fn(async () => undefined),
  loadReviewEntries: vi.fn(async () => undefined),
  reviewRegistryStore: { getState: () => ({ openers: {} as Record<string, unknown> }) },
  reviewStore: { getState: () => ({ entries: [] as unknown[], loaded: true }) },
}))
vi.mock('@/packages/review', () => review)

vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? '')),
}))

import {
  cancelRateLimitRetry,
  clearRateLimitAttempts,
  isRateLimitRetryPending,
  openChatAndRetry,
  rateLimitDelayMs,
  registerChatReviewOpener,
  scheduleRateLimitRetry,
} from './rate-limit-retry'

const override = { provider: 'openai', modelId: 'gpt-5' }

const failed = (errorExtra: Record<string, unknown> = {}): Message => ({
  id: 'a1',
  role: 'assistant',
  contentParts: [],
  aiProvider: 'openai',
  model: 'GPT-5',
  error: 'API Error: Error from OpenAI',
  errorCode: 10001,
  errorExtra: { aiProvider: 'openai', status: 429, responseBody: '{}', modelOverride: override, ...errorExtra },
})

const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
const storedMessage = () => store.list[0].messages.find((m) => m.id === 'a1') as Message

// Warm the module the timer reaches through import(), so a flush is enough for the retry to start.
beforeAll(async () => {
  await import('./retry')
})

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  store.list = [
    {
      id: 's1',
      name: 'Trip plan',
      type: 'chat',
      projectId: 'p1',
      settings: { provider: 'openai', modelId: 'gpt-4o' },
      messages: [{ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Hi' }] }, failed()],
    } as Session,
  ]
  generate.mockClear()
  switchCurrentSession.mockClear()
  review.addReviewEntry.mockClear()
  review.registerReviewOpener.mockClear()
  review.setReviewEntryState.mockClear()
})

afterEach(() => {
  cancelRateLimitRetry('s1')
  clearRateLimitAttempts('a1')
  vi.useRealTimers()
})

describe('rateLimitDelayMs', () => {
  it('follows Retry-After, else 10 s / 1 min / 5 min, then stops', () => {
    expect(rateLimitDelayMs(0)).toBe(10_000)
    expect(rateLimitDelayMs(1)).toBe(60_000)
    expect(rateLimitDelayMs(2)).toBe(300_000)
    expect(rateLimitDelayMs(3)).toBeNull()
    expect(rateLimitDelayMs(0, 7_000)).toBe(7_000)
    expect(rateLimitDelayMs(3, 7_000)).toBeNull()
  })
})

describe('scheduleRateLimitRetry', () => {
  it('retries after 10 s, 60 s and 300 s with the same model, then files one Needs you entry', async () => {
    for (const delay of [10_000, 60_000, 300_000]) {
      const before = generate.mock.calls.length
      scheduleRateLimitRetry('s1', failed())
      await flush()
      expect(isRateLimitRetryPending('s1', 'a1')).toBe(true)
      await vi.advanceTimersByTimeAsync(delay - 1)
      expect(generate).toHaveBeenCalledTimes(before)
      await vi.advanceTimersByTimeAsync(1)
      await flush()
      expect(generate).toHaveBeenCalledTimes(before + 1)
      const [sessionId, msg, options] = generate.mock.calls.at(-1) as unknown as [
        string,
        Message,
        { modelOverride?: unknown },
      ]
      expect(sessionId).toBe('s1')
      expect(msg.id).toBe('a1')
      expect(msg.aiProvider).toBe('openai')
      expect(msg.model).toBe('GPT-5')
      expect(options.modelOverride).toEqual(override)
    }

    scheduleRateLimitRetry('s1', failed())
    await flush()
    await flush()
    expect(review.addReviewEntry).toHaveBeenCalledTimes(1)
    expect(isRateLimitRetryPending('s1', 'a1')).toBe(false)
    await vi.advanceTimersByTimeAsync(3_600_000)
    expect(generate).toHaveBeenCalledTimes(3)
    expect(storedMessage().errorExtra?.rateLimitGaveUp).toBe(true)
  })

  it('marks the message as waiting with its attempt and retry time', async () => {
    const now = Date.now()
    scheduleRateLimitRetry('s1', failed())
    await flush()
    expect(storedMessage().errorExtra).toMatchObject({ rateLimitAttempt: 1, retryAt: now + 10_000 })
  })

  it("follows the provider's Retry-After on the first failure", async () => {
    scheduleRateLimitRetry('s1', failed({ retryAfterMs: 7_000 }))
    await vi.advanceTimersByTimeAsync(6_999)
    expect(generate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it("follows Gemini's retryDelay in the body when there is no Retry-After header", async () => {
    scheduleRateLimitRetry('s1', failed({ responseBody: '{"error":{"details":[{"retryDelay":"41s"}]}}' }))
    await vi.advanceTimersByTimeAsync(40_999)
    expect(generate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await flush()
    expect(generate).toHaveBeenCalledTimes(1)
  })

  it('stop and new send cancel the pending retry', async () => {
    scheduleRateLimitRetry('s1', failed())
    cancelRateLimitRetry('s1')
    expect(isRateLimitRetryPending('s1', 'a1')).toBe(false)
    await vi.advanceTimersByTimeAsync(10_000)
    await flush()
    expect(generate).not.toHaveBeenCalled()
  })

  it('a success clears attempts: the next rate limit starts at 10 s again', async () => {
    scheduleRateLimitRetry('s1', failed())
    await vi.advanceTimersByTimeAsync(10_000)
    await flush()
    clearRateLimitAttempts('a1')

    scheduleRateLimitRetry('s1', failed())
    await vi.advanceTimersByTimeAsync(10_000)
    await flush()
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('a plan run or a room turn is not retried automatically: it goes to Review at once', async () => {
    scheduleRateLimitRetry('s1', failed(), { autoRetry: false })
    await flush()
    await flush()
    expect(isRateLimitRetryPending('s1', 'a1')).toBe(false)
    expect(review.addReviewEntry).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(600_000)
    expect(generate).not.toHaveBeenCalled()
  })

  it('a retry that fires after the message was answered does nothing', async () => {
    scheduleRateLimitRetry('s1', failed())
    store.list[0].messages = store.list[0].messages.map((m) =>
      m.id === 'a1' ? { ...m, error: undefined, errorExtra: undefined } : m
    )
    await vi.advanceTimersByTimeAsync(10_000)
    await flush()
    expect(generate).not.toHaveBeenCalled()
  })
})

describe('Needs you entry and the chat opener', () => {
  async function giveUp() {
    for (let i = 0; i < 3; i++) scheduleRateLimitRetry('s1', failed())
    cancelRateLimitRetry('s1')
    scheduleRateLimitRetry('s1', failed())
    await flush()
    await flush()
  }

  it('the give-up entry points at the chat', async () => {
    await giveUp()
    expect(review.addReviewEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'needs-you',
        scopeId: 'p1',
        source: 'OpenAI',
        text: 'OpenAI is still limiting requests',
        sub: 'The chat "Trip plan" is waiting for a retry.',
        ref: { type: 'chat', id: 's1' },
        chatId: 's1',
      })
    )
  })

  it('registers the chat opener once; it opens the chat and retries the failed answer', async () => {
    registerChatReviewOpener()
    expect(review.registerReviewOpener).toHaveBeenCalledTimes(1)
    expect(review.registerReviewOpener.mock.calls[0][0]).toBe('chat')

    await giveUp()
    const entry = review.addReviewEntry.mock.calls[0][0] as { ref: { type: string; id: string } }
    const open = review.registerReviewOpener.mock.calls[0][1]
    await open(entry)
    expect(switchCurrentSession).toHaveBeenCalledWith('s1')
    expect(generate).toHaveBeenCalledTimes(1)
    expect((generate.mock.calls[0] as unknown as [string, Message])[1].id).toBe('a1')
  })

  it('opening a chat whose last answer did not fail only switches to it', async () => {
    store.list[0].messages = store.list[0].messages.map((m) =>
      m.id === 'a1' ? { ...m, error: undefined, errorCode: undefined, errorExtra: undefined } : m
    )
    await openChatAndRetry('s1')
    expect(switchCurrentSession).toHaveBeenCalledWith('s1')
    expect(generate).not.toHaveBeenCalled()
  })
})
