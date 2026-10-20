/**
 * A2: after the user pressed Stop in a Swarm, the captain's stopped-early deliver turn answers from the work so far
 * and gets no tools: no tool set, no browser or computer use, no agent coding, no web or knowledge. Driven through the
 * real generate() with a scripted model (harness as in plan-flow.test.ts).
 */
import type { Message, Session } from '@shared/types'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

vi.hoisted(() => {
  const storage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  }
  const windowMock: Record<string, unknown> = {
    desktopAPI: undefined,
    localStorage: storage,
  }
  ;(globalThis as unknown as { window: Record<string, unknown>; localStorage: typeof storage }).window = windowMock
  ;(globalThis as unknown as { window: Record<string, unknown>; localStorage: typeof storage }).localStorage = storage
  const fakeRequire = Object.assign(
    () => {
      throw new Error('require is not implemented in tests')
    },
    {
      context: () => {
        const loader = () => ''
        loader.keys = () => [] as string[]
        return loader
      },
    }
  )
  ;(globalThis as unknown as { require: typeof fakeRequire }).require = fakeRequire
  return {}
})

type StreamOpts = {
  messages: Message[]
  tools?: Record<string, unknown>
  agentCoding?: { enabled?: boolean }
  onResultChangeWithCancel?: (update: { contentParts?: Message['contentParts']; cancel?: () => void }) => unknown
}
type StreamReturn = {
  result: { contentParts: Message['contentParts']; text: string; finishReason: string }
  knowledgeIds: string[]
}
type Step = (opts: StreamOpts) => Promise<StreamReturn>

const h = vi.hoisted(() => ({
  sessions: new Map<string, Session>(),
  script: [] as Step[],
  calls: [] as StreamOpts[],
  unexpected: [] as string[],
  addReviewEntry: vi.fn(async (input: unknown) => input),
}))

// --- Stateful in-memory chat store (the real one needs React Query and storage) ---

/** A stored copy without functions (`cancel`), as a persisted session would read back. */
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

type SessionPatch = Partial<Session> | ((s: Session | null | undefined) => Session)
type MessagePatch = Partial<Message> | ((m: Message) => Message)

function update(id: string, patch: SessionPatch): Session {
  const prev = h.sessions.get(id)
  if (!prev) throw new Error(`Session ${id} not found`)
  const next = clone({ ...prev, ...(typeof patch === 'function' ? patch(clone(prev)) : patch) })
  h.sessions.set(id, next)
  return clone(next)
}

function messageLists(session: Session): Message[][] {
  const forkLists = Object.values(session.messageForksHash ?? {}).flatMap((fork) => fork.lists.map((l) => l.messages))
  return [session.messages, ...(session.threads ?? []).map((t) => t.messages), ...forkLists]
}

function updateMessage(id: string, messageId: string, patch: MessagePatch): Promise<void> {
  update(id, (session) => {
    const next = clone(session as Session)
    const location = findMessageLocation(next, messageId)
    const lists = location ? [location.list] : messageLists(next)
    for (const list of lists) {
      const index = list.findIndex((m) => m.id === messageId)
      if (index < 0) continue
      const updated = typeof patch === 'function' ? patch(list[index]) : patch
      list[index] = { ...list[index], ...updated }
    }
    return next
  })
  return Promise.resolve()
}

vi.mock('../chatStore', () => ({
  getSession: (id: string) => Promise.resolve(h.sessions.has(id) ? clone(h.sessions.get(id)) : null),
  getSessionSettings: (id: string) => Promise.resolve({ ...h.sessions.get(id)?.settings }),
  updateSession: (id: string, patch: SessionPatch) => Promise.resolve(update(id, patch)),
  updateSessionWithMessages: (id: string, patch: SessionPatch) => Promise.resolve(update(id, patch)),
  updateMessage: (id: string, messageId: string, patch: MessagePatch) => updateMessage(id, messageId, patch),
  updateMessageCache: (id: string, messageId: string, patch: MessagePatch) => updateMessage(id, messageId, patch),
  insertMessage: (id: string, message: Message) =>
    Promise.resolve(update(id, (s) => ({ ...(s as Session), messages: [...(s as Session).messages, message] }))),
  insertMessages: (id: string, messages: Message[]) =>
    Promise.resolve(update(id, (s) => ({ ...(s as Session), messages: [...(s as Session).messages, ...messages] }))),
  removeMessage: (id: string, messageId: string) =>
    Promise.resolve(
      update(id, (s) => ({ ...(s as Session), messages: (s as Session).messages.filter((m) => m.id !== messageId) }))
    ),
}))

// --- Scripted fake model ---

vi.mock('@/packages/model-calls', () => ({
  streamText: (_model: unknown, opts: StreamOpts) => {
    h.calls.push(opts)
    const step = h.script.shift()
    if (!step) {
      h.unexpected.push('streamText')
      return Promise.reject(new Error('Unexpected model call: the script has no step left'))
    }
    return step(opts)
  },
  generateText: () => {
    h.unexpected.push('generateText')
    return Promise.reject(new Error('Unexpected model call (generateText)'))
  },
  generateImage: () => {
    h.unexpected.push('generateImage')
    return Promise.reject(new Error('Unexpected model call (generateImage)'))
  },
}))

const testModel = {
  name: 'test',
  modelId: 'test',
  isSupportToolUse: () => true,
  isSupportVision: () => false,
  isSupportReasoning: () => false,
  isSupportSystemMessage: () => true,
}
vi.mock('@shared/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/models')>()),
  getModel: () => testModel,
}))

// --- The rest of the app around generate() (as in sessionActions.test.ts) ---

vi.mock('./session-web-browsing', () => ({ getSessionWebBrowsing: () => false }))
vi.mock('@/packages/context-management', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/context-management')>()),
  runCompactionWithUIState: async () => ({ success: true, truncateTokenLimit: undefined }),
}))
vi.mock('@/platform', () => ({
  default: {
    type: 'desktop',
    getConfig: async () => ({}),
    appLog: vi.fn(async () => {}),
    setStoreValue: vi.fn(async () => {}),
    getStoreValue: vi.fn(async () => undefined),
  },
  platformCapabilities: {},
}))
vi.mock('@/adapters', () => ({ createModelDependencies: async () => ({}) }))
vi.mock('@/packages/model-setting-utils', () => ({ getModelDisplayName: async () => 'mock-model' }))
vi.mock('@/packages/token', () => ({ estimateTokensFromMessages: () => 0 }))
vi.mock('@/router', () => ({ router: { navigate: vi.fn() } }))
vi.mock('@/utils/session-utils', () => ({ sortSessions: (sessions: unknown) => sessions }))
vi.mock('@/utils/track', () => ({ trackEvent: vi.fn() }))
vi.mock('@/hooks/dom', () => ({ focusMessageInput: vi.fn() }))
vi.mock('@/i18n/locales', () => ({ languageNameMap: {} }))
vi.mock('@/packages/apple_app_store', () => ({ tickAfterMessageGenerated: vi.fn() }))
vi.mock('@/packages/notifications', () => ({ notifySystemEvent: vi.fn(async () => false) }))
vi.mock('@/packages/knowledge/chat-proposer', () => ({ proposeFromChatTurn: vi.fn(async () => []) }))
vi.mock('@/packages/review', () => ({ addReviewEntry: h.addReviewEntry }))
vi.mock('@/packages/model-calls/toolsets/file', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/model-calls/toolsets/file')>()),
  getStagedChangeSetId: () => 'cs-e2e',
}))
vi.mock('@/stores/settingsStore', () => ({
  settingsStore: { getState: () => ({ getSettings: () => ({}) }) },
  useLanguage: () => 'en',
}))
vi.mock('@/stores/uiStore', () => ({
  uiStore: {
    getState: () => ({
      sidebarLayout: 'expanded',
      messageScrolling: null,
      setMessageListElement: vi.fn(),
      sessionKnowledgeBaseMap: {},
    }),
  },
  useUIStore: vi.fn(),
}))
vi.mock('@/components/settings/mcp/registries', () => ({ MCP_ENTRIES_OFFICIAL: [] }))

import { findMessageLocation } from './forks'
import { generate } from './generation'

type SeenOpts = StreamOpts & {
  browserAgent?: { armed?: boolean }
  computerUse?: { armed?: boolean }
  webBrowsing?: boolean
  knowledgeBase?: unknown
  maxSteps?: number
}

function answerStep(): Step {
  return async () => ({
    result: { contentParts: [{ type: 'text', text: 'Done so far.' }], text: 'Done so far.', finishReason: 'stop' },
    knowledgeIds: [],
  })
}

function seedSwarmChat(): Message {
  const u1: Message = { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Ship the docs' }] }
  const a1: Message = { id: 'a1', role: 'assistant', contentParts: [], generating: true, roomRole: 'deliver' }
  h.sessions.set('s1', {
    id: 's1',
    name: 'Docs',
    type: 'chat',
    agentMode: true,
    browserArmed: true,
    computerArmed: true,
    settings: { provider: 'openai', modelId: 'gpt', maxContextMessageCount: 20 },
    messages: [u1, a1],
  } as Session)
  return a1
}

const deliverOptions = {
  roomMulti: true,
  roomMode: 'swarm' as const,
  roomRole: 'deliver' as const,
  participantNames: ['Captain', 'Scout'],
  leadName: 'Captain',
  skipQueuedMessages: true,
}

describe('Swarm stopped-early deliver turn', () => {
  beforeEach(() => {
    h.sessions.clear()
    h.script = []
    h.calls = []
    h.unexpected = []
  })
  afterEach(() => {
    expect(h.unexpected).toEqual([])
  })

  test('a normal deliver turn keeps its tools and armed browser/computer use', async () => {
    const a1 = seedSwarmChat()
    h.script.push(answerStep())
    await generate('s1', a1, deliverOptions)
    const seen = h.calls[0] as SeenOpts
    expect(seen.browserAgent?.armed).toBe(true)
    expect(seen.computerUse?.armed).toBe(true)
    expect(seen.agentCoding?.enabled).toBe(true)
    expect(seen.tools).not.toEqual({})
  })

  test('after Stop, the deliver turn gets no tools', async () => {
    const a1 = seedSwarmChat()
    h.script.push(answerStep())
    await generate('s1', a1, { ...deliverOptions, swarmStoppedEarly: true })
    expect(h.calls).toHaveLength(1)
    const seen = h.calls[0] as SeenOpts
    expect(seen.tools).toEqual({})
    expect(seen.browserAgent?.armed).toBe(false)
    expect(seen.computerUse?.armed).toBe(false)
    expect(seen.agentCoding?.enabled).toBe(false)
    expect(seen.webBrowsing).toBe(false)
    expect(seen.knowledgeBase).toBeUndefined()
    expect(seen.maxSteps).toBe(1)
  })
})
