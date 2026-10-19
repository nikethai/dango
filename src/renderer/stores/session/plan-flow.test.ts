/**
 * End-to-end plan flow (TASK-16): plan mode on → proposed → Run plan → running → Stop → Continue → finished → one
 * Change in Review, driven through the real generate(), Stop and plan lifecycle with a scripted model. No network: every
 * model call takes the next scripted step, and a call with no step left fails the test.
 */
import type { Message, MessagePlanPart, Session } from '@shared/types'
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

import { isPlanModeOn, planContinueState } from '@/packages/plan/planSteps'
import { findMessageLocation } from './forks'
import { approveAndExecutePlan, generate, resumeStoppedPlan } from './generation'
import { setChatPlanMode, turnOnChatPlanMode } from './plan-mode'
import { stopSessionGeneration } from './stop-generation'

// --- Helpers ---

const PLAN_TEXT = '1. Edit README\n2. Check links'
const EDIT_TOOLS = ['create_file', 'edit_file', 'delete_file']

const text = (value: string) => ({ type: 'text' as const, text: value })
const textOf = (m: Message) => m.contentParts.map((p) => (p.type === 'text' ? p.text : '')).join('')

function stored(): Session {
  return clone(h.sessions.get('s1') as Session)
}
function storedMessage(id: string): Message {
  return stored().messages.find((m) => m.id === id) as Message
}
function planOf(m: Message): MessagePlanPart | undefined {
  return m.contentParts.find((p): p is MessagePlanPart => p.type === 'plan')
}
function continueState(): ReturnType<typeof planContinueState> {
  const session = stored()
  return planContinueState({
    latestPlan: true,
    isTail: session.messages.at(-1)?.id === 'a1',
    generationActive: false,
    planModeOn: isPlanModeOn(session),
  })
}

/** One scripted model turn: optional checks, streamed parts, optional work while streaming (Stop), the result. */
function step(
  parts: Message['contentParts'],
  opts: { finishReason?: string; before?: (o: StreamOpts) => void; during?: () => Promise<void> } = {}
): Step {
  return async (o) => {
    opts.before?.(o)
    await o.onResultChangeWithCancel?.({ contentParts: parts, cancel: () => {} })
    await opts.during?.()
    const value = parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
    return {
      result: { contentParts: parts, text: value, finishReason: opts.finishReason ?? 'stop' },
      knowledgeIds: [],
    }
  }
}

function seedChat(): Message {
  const u1: Message = { id: 'u1', role: 'user', contentParts: [text('Tidy the docs')] }
  const a1: Message = { id: 'a1', role: 'assistant', contentParts: [], generating: true }
  h.sessions.set('s1', {
    id: 's1',
    name: 'Docs',
    type: 'chat',
    agentMode: true,
    settings: { provider: 'openai', modelId: 'gpt', maxContextMessageCount: 20 },
    messages: [u1, a1],
  })
  return a1
}

/** Proposed → Run plan → running → Stop, through the real generate() and Stop. */
async function proposeRunAndStop() {
  const a1 = seedChat()
  await setChatPlanMode('s1', true)
  h.script.push(step([text(PLAN_TEXT)]))
  await generate('s1', a1, { operationType: 'send_message' })

  h.script.push(
    step(
      [
        { type: 'tool-call', toolCallId: 'c1', toolName: 'edit_file', state: 'result', args: {}, result: 'ok' },
        text('Edited README'),
      ],
      {
        before: () => {
          // The card's running state, from the stored chat: generating, approved, started, executing.
          const running = storedMessage('a1')
          expect(running.generating).toBe(true)
          expect(planOf(running)).toMatchObject({ status: 'approved' })
          expect(planOf(running)?.startedAt).toBeDefined()
          expect(stored().planPhase).toBe('executing')
        },
        // The person presses Stop while the run streams: the real Stop path.
        during: async () => {
          await stopSessionGeneration('s1', storedMessage('a1'))
        },
      }
    )
  )
  await approveAndExecutePlan('s1', 'a1')
}

beforeEach(() => {
  h.sessions.clear()
  h.script.length = 0
  h.calls.length = 0
  h.unexpected.length = 0
  h.addReviewEntry.mockClear()
})

afterEach(() => {
  // No stray model call (e.g. a closing-answer stream) and no step left unplayed.
  expect(h.unexpected).toEqual([])
  expect(h.script).toHaveLength(0)
})

describe('plan flow end to end (scripted model)', () => {
  test('proposed → Run plan → running → Stop → Continue → finished → one Change in Review', async () => {
    const a1 = seedChat()
    await setChatPlanMode('s1', true)

    // 1. Proposed: the planning turn has no edit tools and leaves a pending plan.
    h.script.push(step([text(PLAN_TEXT)]))
    await generate('s1', a1, { operationType: 'send_message' })
    expect(h.calls).toHaveLength(1)
    const planningTools = Object.keys(h.calls[0].tools ?? {})
    expect(planningTools.filter((name) => EDIT_TOOLS.includes(name))).toEqual([])
    const proposed = storedMessage('a1')
    expect(planOf(proposed)).toMatchObject({ status: 'pending', version: 1, planText: PLAN_TEXT })
    expect(proposed.generating).toBe(false)
    expect(stored().planPhase).toBe('awaiting_approval')
    expect(h.addReviewEntry).not.toHaveBeenCalled()

    // 2. Run plan → running → Stop.
    h.script.push(
      step(
        [
          { type: 'tool-call', toolCallId: 'c1', toolName: 'edit_file', state: 'result', args: {}, result: 'ok' },
          text('Edited README'),
        ],
        {
          before: () => {
            const running = storedMessage('a1')
            expect(running.generating).toBe(true)
            expect(planOf(running)).toMatchObject({ status: 'approved' })
            expect(planOf(running)?.startedAt).toBeDefined()
            expect(stored().planPhase).toBe('executing')
          },
          during: async () => {
            await stopSessionGeneration('s1', storedMessage('a1'))
          },
        }
      )
    )
    await approveAndExecutePlan('s1', 'a1')
    expect(h.calls).toHaveLength(2)
    const stopped = storedMessage('a1')
    const stoppedPlan = planOf(stopped)
    expect(stoppedPlan).toMatchObject({ status: 'approved' })
    expect(stoppedPlan?.finishedAt).toBeUndefined()
    expect(stoppedPlan?.runMs).toBeGreaterThanOrEqual(0)
    expect(stopped.generating).toBe(false)
    expect(continueState()).toBe('ready')
    expect(h.addReviewEntry).not.toHaveBeenCalled()
    expect(stored().planPhase).toBeUndefined()

    // 3. Continue → finished → one Change.
    h.script.push(
      step([text('Checked links')], {
        before: (o) => {
          const isKeptEdit = (m: Message) =>
            m.contentParts.some((p) => p.type === 'tool-call' && p.toolCallId === 'c1' && p.toolName === 'edit_file')
          expect(o.messages.filter(isKeptEdit)).toHaveLength(1)
          expect(textOf(o.messages.at(-1) as Message)).toMatch(/stopped before it finished/)
        },
      })
    )
    await resumeStoppedPlan('s1', 'a1')
    expect(h.calls).toHaveLength(3)
    const finished = storedMessage('a1')
    expect(planOf(finished)?.finishedAt).toBeDefined()
    expect(finished.error).toBeUndefined()
    const types = finished.contentParts.map((p) => p.type)
    expect(types[0]).toBe('tool-call')
    expect(types[1]).toBe('text')
    expect(types.at(-1)).toBe('plan')
    expect(textOf(finished)).toContain('Checked links')
    expect(h.addReviewEntry).toHaveBeenCalledTimes(1)
    expect(h.addReviewEntry.mock.calls[0][0]).toMatchObject({
      kind: 'change',
      ref: { type: 'change', id: 'cs-e2e' },
      chatId: 's1',
      text: 'Plan finished: Edit README',
    })
    expect(h.script).toHaveLength(0)
  })

  test('with plan mode off, a send in an agent chat answers directly and proposes no plan', async () => {
    const a1 = seedChat()
    h.script.push(step([text('Done: the docs are tidy.')]))
    await generate('s1', a1, { operationType: 'send_message' })
    expect(h.calls).toHaveLength(1)
    // An agent turn: the agent tools are on, not the read-only planning set.
    expect(h.calls[0].tools).toBeUndefined()
    expect(h.calls[0].agentCoding?.enabled).toBe(true)
    const answer = storedMessage('a1')
    expect(planOf(answer)).toBeUndefined()
    expect(textOf(answer)).toBe('Done: the docs are tidy.')
    expect(answer.generating).toBe(false)
    expect(stored().planPhase).toBeUndefined()
    expect(h.addReviewEntry).not.toHaveBeenCalled()
  })

  test('Continue is blocked while plan mode is off and ready after turning it on', async () => {
    await proposeRunAndStop()
    expect(continueState()).toBe('ready')

    // Plan mode off: Continue is blocked, and a Continue anyway is refused before any model call.
    await setChatPlanMode('s1', false)
    expect(continueState()).toBe('blocked')
    const callsBefore = h.calls.length
    await expect(resumeStoppedPlan('s1', 'a1')).rejects.toThrow(
      "Plan mode is off in this chat, so this plan can't continue."
    )
    expect(h.calls).toHaveLength(callsBefore)

    // Agent Mode off too: the card's Turn on plan mode turns both back on; Continue becomes ready but does not run.
    h.sessions.set('s1', { ...stored(), agentMode: false })
    expect(continueState()).toBe('blocked')
    await turnOnChatPlanMode('s1')
    expect(stored().agentMode).toBe(true)
    expect(stored().settings?.planMode).toBe(true)
    expect(continueState()).toBe('ready')
    expect(h.calls).toHaveLength(callsBefore)

    // Continue, now a second explicit action, finishes the plan.
    h.script.push(step([text('Checked links')]))
    await resumeStoppedPlan('s1', 'a1')
    expect(planOf(storedMessage('a1'))?.finishedAt).toBeDefined()
    expect(h.addReviewEntry).toHaveBeenCalledTimes(1)
  })
})
