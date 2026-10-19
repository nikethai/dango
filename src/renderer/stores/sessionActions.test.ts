import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { Message, MessagePlanPart, Session, SessionThread } from '../../shared/types'
import { MessagePlanPartSchema } from '../../shared/types/session'

import * as sessionActions from './sessionActions'

const { uuidQueue, uuidv4Mock } = vi.hoisted(() => {
  const queue: string[] = []
  const mock = vi.fn(() => {
    if (queue.length === 0) {
      throw new Error('Mock uuid queue exhausted')
    }
    return queue.shift()!
  })
  return { uuidQueue: queue, uuidv4Mock: mock }
})

const {
  updateSessionWithMessages,
  useSessionMock,
  getSessionMock,
  updateMessageMock,
  updateSessionMock,
  getSessionSettingsMock,
  updateMessageCacheMock,
  addReviewEntryMock,
} = vi.hoisted(() => ({
  updateSessionWithMessages: vi.fn(),
  useSessionMock: vi.fn(),
  getSessionMock: vi.fn(),
  updateMessageMock: vi.fn(),
  updateSessionMock: vi.fn(),
  getSessionSettingsMock: vi.fn(),
  updateMessageCacheMock: vi.fn(),
  addReviewEntryMock: vi.fn(async (input: unknown) => input),
}))

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

vi.mock('@shared/models', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/models')>()),
  getModel: () => ({
    name: 'test',
    modelId: 'test',
    isSupportToolUse: () => false,
    isSupportVision: () => false,
    isSupportReasoning: () => false,
    isSupportSystemMessage: () => true,
  }),
}))

vi.mock('./session/session-web-browsing', () => ({ getSessionWebBrowsing: () => false }))

vi.mock('uuid', () => ({
  v4: uuidv4Mock,
}))

vi.mock('./chatStore', () => ({
  updateSessionWithMessages,
  updateSession: updateSessionMock,
  updateMessage: updateMessageMock,
  updateMessageCache: updateMessageCacheMock,
  getSessionSettings: getSessionSettingsMock,
  getSession: getSessionMock,
  useSession: useSessionMock,
}))

vi.mock('../platform', () => ({
  default: {
    type: 'web',
    getConfig: async () => ({}),
    appLog: vi.fn(async () => {}),
    setStoreValue: vi.fn(async () => {}),
    getStoreValue: vi.fn(async () => undefined),
  },
  platformCapabilities: {},
}))

vi.mock('@/adapters', () => ({
  createModelDependencies: async () => ({}),
}))

vi.mock('@/packages/model-calls', () => ({
  generateImage: vi.fn(),
  generateText: vi.fn(),
  streamText: vi.fn(),
}))

vi.mock('@/packages/model-setting-utils', () => ({
  getModelDisplayName: async () => 'mock-model',
}))

vi.mock('@/packages/token', () => ({
  estimateTokensFromMessages: () => 0,
}))

vi.mock('@/router', () => ({
  router: {
    navigate: vi.fn(),
  },
}))

vi.mock('@/utils/session-utils', () => ({
  sortSessions: (sessions: unknown) => sessions,
}))

vi.mock('@/utils/track', () => ({
  trackEvent: vi.fn(),
}))

vi.mock('@/hooks/dom', () => ({
  focusMessageInput: vi.fn(),
}))

vi.mock('@/i18n/locales', () => ({
  languageNameMap: {},
}))

vi.mock('@/packages/apple_app_store', () => ({ tickAfterMessageGenerated: vi.fn() }))
vi.mock('@/packages/notifications', () => ({ notifySystemEvent: vi.fn(async () => false) }))
vi.mock('@/packages/review', () => ({ addReviewEntry: addReviewEntryMock }))
vi.mock('@/packages/model-calls/toolsets/file', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/model-calls/toolsets/file')>()),
  getStagedChangeSetId: () => 'cs-plan',
}))

vi.mock('@/stores/settingsStore', () => ({
  settingsStore: {
    getState: () => ({
      getSettings: () => ({}),
    }),
  },
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

vi.mock('@/components/settings/mcp/registries', () => ({
  MCP_ENTRIES_OFFICIAL: [],
}))

vi.mock('../components/settings/mcp/registries', () => ({
  MCP_ENTRIES_OFFICIAL: [],
}))

function makeMessage(id: string, role: Message['role'] = 'user'): Message {
  return {
    id,
    role,
    contentParts: [],
  }
}

function cloneSession(session: Session): Session {
  return JSON.parse(JSON.stringify(session)) as Session
}

beforeEach(() => {
  uuidQueue.length = 0
  uuidv4Mock.mockClear()
  updateSessionWithMessages.mockReset()
  useSessionMock.mockReset()
  getSessionMock.mockReset()
  updateMessageMock.mockReset()
  updateSessionMock.mockReset()
  getSessionSettingsMock.mockReset()
  updateMessageCacheMock.mockReset()
  addReviewEntryMock.mockClear()
})

describe('fork actions', () => {
  test('createNewFork moves trailing messages into a new branch', async () => {
    uuidQueue.push('id-1', 'id-2', 'id-3')
    const pivot = makeMessage('pivot', 'user')
    const trailing = makeMessage('trailing', 'assistant')
    const session: Session = {
      id: 'session-1',
      name: 'Test',
      messages: [pivot, trailing],
    }
    const snapshot = cloneSession(session)

    let updated: Session | undefined
    updateSessionWithMessages.mockImplementation(async (sessionId, updater) => {
      expect(sessionId).toBe(session.id)
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.createNewFork(session.id, pivot.id)

    expect(updateSessionWithMessages).toHaveBeenCalledTimes(1)
    expect(session).toEqual(snapshot)
    expect(updated).toBeDefined()
    expect(updated!.messages).toEqual([pivot])

    const fork = updated!.messageForksHash?.[pivot.id]
    expect(fork).toBeDefined()
    expect(fork!.position).toBe(1)
    expect(fork!.lists).toHaveLength(2)
    expect(fork!.lists[0].messages).toEqual([trailing])
    expect(fork!.lists[1].messages).toEqual([])
  })

  test('createNewFork skips update when no trailing messages', async () => {
    uuidQueue.push('id-1')
    const pivot = makeMessage('pivot', 'user')
    const session: Session = {
      id: 'session-2',
      name: 'Test',
      messages: [pivot],
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (sessionId, updater) => {
      expect(sessionId).toBe(session.id)
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.createNewFork(session.id, pivot.id)

    expect(updateSessionWithMessages).toHaveBeenCalledTimes(1)
    expect(session).toEqual(snapshot)
    expect(updated).toBe(session)
    expect(updated?.messageForksHash).toBeUndefined()
  })

  test('switchFork rotates branch contents for root messages', async () => {
    const pivot = makeMessage('pivot', 'user')
    const current = makeMessage('current', 'assistant')
    const alt = makeMessage('alt', 'assistant')
    const session: Session = {
      id: 'session-3',
      name: 'Test',
      messages: [pivot, current],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'list-0', messages: [] },
            { id: 'list-1', messages: [alt] },
          ],
          createdAt: 1,
        },
      },
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.switchFork(session.id, pivot.id, 'next')

    expect(session).toEqual(snapshot)
    expect(updated).toBeDefined()
    expect(updated!.messages).toEqual([pivot, alt])

    const fork = updated!.messageForksHash?.[pivot.id]
    expect(fork).toBeDefined()
    expect(fork!.position).toBe(1)
    expect(fork!.lists[0].messages).toEqual([current])
    expect(fork!.lists[1].messages).toEqual([])
    expect(snapshot.messageForksHash?.[pivot.id].lists[0].messages).toEqual([])
  })

  test('switchFork updates forked thread messages', async () => {
    const pivot = makeMessage('pivot', 'user')
    const current = makeMessage('current', 'assistant')
    const alternative = makeMessage('alt', 'assistant')
    const thread: SessionThread = {
      id: 'thread-1',
      name: 'Thread',
      createdAt: 1,
      messages: [pivot, current],
    }
    const session: Session = {
      id: 'session-4',
      name: 'Test',
      messages: [],
      threads: [thread],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [
            { id: 'list-0', messages: [] },
            { id: 'list-1', messages: [alternative] },
          ],
          createdAt: 1,
        },
      },
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.switchFork(session.id, pivot.id, 'next')

    expect(session).toEqual(snapshot)
    expect(updated?.threads?.[0].messages).toEqual([pivot, alternative])
    const fork = updated?.messageForksHash?.[pivot.id]
    expect(fork?.position).toBe(1)
    expect(fork?.lists[0].messages).toEqual([current])
  })

  test('deleteFork promotes the next saved branch', async () => {
    const pivot = makeMessage('pivot', 'user')
    const current = makeMessage('current', 'assistant')
    const nextBranch = makeMessage('next', 'assistant')
    const session: Session = {
      id: 'session-5',
      name: 'Test',
      messages: [pivot, current],
      messageForksHash: {
        [pivot.id]: {
          position: 1,
          lists: [
            { id: 'list-0', messages: [nextBranch] },
            { id: 'list-1', messages: [] },
          ],
          createdAt: 1,
        },
      },
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.deleteFork(session.id, pivot.id)

    expect(session).toEqual(snapshot)
    expect(updated!.messages).toEqual([pivot, nextBranch])
    const fork = updated!.messageForksHash?.[pivot.id]
    expect(fork).toBeDefined()
    expect(fork!.position).toBe(0)
    expect(fork!.lists).toHaveLength(1)
    expect(fork!.lists[0].messages).toEqual([])
  })

  test('deleteFork removes entry when no branches remain', async () => {
    const pivot = makeMessage('pivot', 'user')
    const session: Session = {
      id: 'session-6',
      name: 'Test',
      messages: [pivot],
      messageForksHash: {
        [pivot.id]: {
          position: 0,
          lists: [{ id: 'list-0', messages: [] }],
          createdAt: 1,
        },
      },
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.deleteFork(session.id, pivot.id)

    expect(session).toEqual(snapshot)
    expect(updated!.messages).toEqual([pivot])
    expect(updated!.messageForksHash).toBeUndefined()
  })

  test('expandFork appends all stored branches and clears fork data', async () => {
    const pivot = makeMessage('pivot', 'user')
    const current = makeMessage('current', 'assistant')
    const altA = makeMessage('alt-a', 'assistant')
    const altB = makeMessage('alt-b', 'assistant')
    const session: Session = {
      id: 'session-7',
      name: 'Test',
      messages: [pivot, current],
      messageForksHash: {
        [pivot.id]: {
          position: 1,
          lists: [
            { id: 'list-0', messages: [altA] },
            { id: 'list-1', messages: [] },
            { id: 'list-2', messages: [altB] },
          ],
          createdAt: 1,
        },
      },
    }
    const snapshot = cloneSession(session)
    let updated: Session | undefined

    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    await sessionActions.expandFork(session.id, pivot.id)

    expect(session).toEqual(snapshot)
    expect(updated!.messages).toEqual([pivot, current, altA, altB])
    expect(updated!.messageForksHash).toBeUndefined()
  })

  test('regenerateInNewFork creates a new fork for thread messages', async () => {
    uuidQueue.push('fork-1', 'fork-2', 'fork-3', 'fork-4')
    const pivot = makeMessage('pivot', 'user')
    const target = makeMessage('target', 'assistant')
    const thread: SessionThread = {
      id: 'thread-2',
      name: 'Thread',
      createdAt: 1,
      messages: [pivot, target],
    }
    const session: Session = {
      id: 'session-8',
      name: 'Test',
      messages: [],
      threads: [thread],
    }
    const snapshot = cloneSession(session)

    getSessionMock.mockResolvedValue(session)

    let updated: Session | undefined
    updateSessionWithMessages.mockImplementation(async (_, updater) => {
      const result = updater(session)
      updated = result as Session
      return result
    })

    const runGenerateMore = vi.fn().mockResolvedValue(undefined)

    await sessionActions.regenerateInNewFork(session.id, target, { runGenerateMore })

    expect(getSessionMock).toHaveBeenCalledWith(session.id)
    expect(updateSessionWithMessages).toHaveBeenCalledTimes(1)
    expect(session).toEqual(snapshot)

    expect(updated).toBeDefined()
    const fork = updated!.messageForksHash?.[pivot.id]
    expect(fork).toBeDefined()
    expect(fork!.lists).toHaveLength(2)
    expect(fork!.lists[0].messages).toEqual([target])
    expect(runGenerateMore).toHaveBeenCalledWith(session.id, pivot.id)
  })
})

describe('plan lifecycle actions', () => {
  const pendingPlanSession = (): Session => ({
    id: 'plan-session',
    name: 'Plan',
    messages: [
      makeMessage('u1', 'user'),
      { ...makeMessage('a1', 'assistant'), contentParts: [{ type: 'plan', planText: '1. Do it', status: 'pending' }] },
    ],
  })
  const writtenPlan = () => {
    const written = updateMessageMock.mock.calls[0]?.[2] as Message | undefined
    return written?.contentParts.find((p) => p.type === 'plan')
  }

  test('requestPlanChanges marks the old plan revised, stored as rejected plus a revised flag', async () => {
    getSessionMock.mockResolvedValue(pendingPlanSession())
    await sessionActions.requestPlanChanges('plan-session', 'a1', 'Shorter please').catch(() => {})
    expect(writtenPlan()).toMatchObject({ type: 'plan', status: 'rejected', revised: true })
  })

  test('a revised plan still parses with the schema of builds before 6a (status enum without revised)', async () => {
    // MessagePlanPartSchema as on main before slice 6a: older builds drop a session whose plan fails this parse.
    const { z } = await import('zod')
    const OldPlanPartSchema = z.object({
      type: z.literal('plan'),
      planText: z.string(),
      status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
    })
    getSessionMock.mockResolvedValue(pendingPlanSession())
    await sessionActions.requestPlanChanges('plan-session', 'a1', 'Shorter please').catch(() => {})
    const written = writtenPlan()
    expect(OldPlanPartSchema.safeParse(written).success).toBe(true)
    // And this build reads it back as revised.
    const { planCardState } = await import('@/packages/plan/planSteps')
    expect(planCardState(MessagePlanPartSchema.parse(written), false)).toBe('revised')
  })

  test('approveAndExecutePlan stamps startedAt with the approval', async () => {
    getSessionMock.mockResolvedValue(pendingPlanSession())
    const before = Date.now()
    await sessionActions.approveAndExecutePlan('plan-session', 'a1').catch(() => {})
    const plan = writtenPlan()
    expect(plan).toMatchObject({ type: 'plan', status: 'approved' })
    expect((plan as { startedAt?: number }).startedAt).toBeGreaterThanOrEqual(before)
  })

  const stoppedPlanSession = (plan: Record<string, unknown>): Session => ({
    id: 'plan-session',
    name: 'Plan',
    agentMode: true,
    messages: [
      makeMessage('u1', 'user'),
      {
        ...makeMessage('a1', 'assistant'),
        contentParts: [
          { type: 'tool-call', toolCallId: 'c1', toolName: 'edit_file', state: 'result', args: {} },
          { type: 'plan', planText: '1. Do it\n2. Check it', status: 'approved', ...plan },
        ],
      },
    ],
  })

  test('resumeStoppedPlan re-enters execution for the same plan message', async () => {
    getSessionMock.mockResolvedValue(stoppedPlanSession({ startedAt: 1 }))
    getSessionSettingsMock.mockResolvedValue({ planMode: true })
    await sessionActions.resumeStoppedPlan('plan-session', 'a1').catch(() => {})
    expect(updateSessionMock).toHaveBeenCalledWith('plan-session', { planPhase: 'executing' })
    // The stopped run's visible work is kept when the message starts generating again.
    const firstWrite = updateMessageMock.mock.calls[0]?.[2] as Message | undefined
    expect(firstWrite?.id).toBe('a1')
    expect(firstWrite?.contentParts.some((p) => p.type === 'tool-call')).toBe(true)
  })

  const toolC1 = (m: Message) => m.contentParts.some((p) => p.type === 'tool-call' && p.toolCallId === 'c1')
  const textOf = (m: Message) => m.contentParts.map((p) => (p.type === 'text' ? p.text : '')).join('')
  async function resumeWithStream(answer: Message['contentParts'], opts: { stop?: boolean } = {}) {
    const { streamText } = await import('@/packages/model-calls')
    const { cancelSessionGeneration } = await import('./session/generation-cancel')
    const calls: Array<{ messages: Message[]; knowledgeQuery?: string; memory?: { userQuery?: string } }> = []
    vi.mocked(streamText).mockImplementation(async (_model, streamOpts) => {
      calls.push(streamOpts as never)
      const parts = calls.length === 1 ? answer : [{ type: 'text' as const, text: 'Closing answer' }]
      await streamOpts.onResultChangeWithCancel?.({ contentParts: parts, cancel: () => {} })
      // Stop pressed while the stream runs: the registered abort fires, the stream returns normally.
      if (opts.stop) cancelSessionGeneration('plan-session')
      const text = parts.map((p) => (p.type === 'text' ? p.text : '')).join('')
      const finishReason = parts.some((p) => p.type === 'text') ? 'stop' : 'tool-calls'
      return { result: { contentParts: parts, text, finishReason }, knowledgeIds: [] } as never
    })
    uuidQueue.push(...Array.from({ length: 50 }, (_, i) => `uuid-${i}`))
    const session = stoppedPlanSession({ startedAt: 1 })
    session.messages[0] = { ...session.messages[0], contentParts: [{ type: 'text', text: 'Tidy the docs' }] }
    getSessionMock.mockResolvedValue(session)
    getSessionSettingsMock.mockResolvedValue({
      planMode: true,
      provider: 'openai',
      modelId: 'gpt',
      maxContextMessageCount: 20,
    })
    await sessionActions.resumeStoppedPlan('plan-session', 'a1')
    return calls
  }

  test('a resumed run sends the kept work once, then the note, and paints after it', async () => {
    const calls = await resumeWithStream([{ type: 'text', text: 'Checked it' }])
    expect(calls).toHaveLength(1)
    const sent = calls[0].messages
    expect(sent.filter(toolC1)).toHaveLength(1)
    const keptIx = sent.findIndex(toolC1)
    expect(sent[keptIx + 1]?.role).toBe('user')
    expect(textOf(sent[keptIx + 1])).toMatch(/stopped/i)
    expect(keptIx + 2).toBe(sent.length)
    // Knowledge and memory rank against the person's own turn, not the resume note.
    expect(calls[0].knowledgeQuery).toBe('Tidy the docs')
    expect(calls[0].memory?.userQuery).toBe('Tidy the docs')

    const paints = updateMessageCacheMock.mock.calls.map((c) => c[2] as Message)
    const painted = paints.find((m) => textOf(m).includes('Checked it'))
    expect(painted?.contentParts.map((p) => p.type)).toEqual(['tool-call', 'text', 'plan'])

    const saved = updateMessageMock.mock.calls.at(-1)?.[2] as Message
    expect(saved.contentParts.map((p) => p.type)).toEqual(['tool-call', 'text', 'plan'])
    expect(textOf(saved)).not.toMatch(/stopped/i)
    expect(saved.contentParts.find((p) => p.type === 'plan')).toMatchObject({ status: 'approved', startedAt: 1 })
    expect((saved.contentParts.find((p) => p.type === 'plan') as { finishedAt?: number }).finishedAt).toBeDefined()
  })

  test('a tool-only resumed run starts no closing-answer stream (the plan part reads as the answer)', async () => {
    // So the closing-answer prompt can never repeat the kept work; generate() still builds it without the resume turns.
    const calls = await resumeWithStream([
      { type: 'tool-call', toolCallId: 'c2', toolName: 'read_file', state: 'result', args: {}, result: 'ok' },
    ])
    expect(calls).toHaveLength(1)
    expect(calls[0].messages.filter(toolC1)).toHaveLength(1)
  })

  test('resumeStoppedPlan refuses a finished plan', async () => {
    getSessionMock.mockResolvedValue(stoppedPlanSession({ startedAt: 1, finishedAt: 2 }))
    getSessionSettingsMock.mockResolvedValue({ planMode: true })
    await expect(sessionActions.resumeStoppedPlan('plan-session', 'a1')).rejects.toThrow()
    expect(updateSessionMock).not.toHaveBeenCalled()
  })

  test('resumeStoppedPlan refuses while another generation runs in the chat', async () => {
    const { registerGenerationCancel, clearGenerationCancel } = await import('./session/generation-cancel')
    registerGenerationCancel('plan-session', 'other', () => {})
    getSessionMock.mockResolvedValue(stoppedPlanSession({ startedAt: 1 }))
    getSessionSettingsMock.mockResolvedValue({ planMode: true })
    await expect(sessionActions.resumeStoppedPlan('plan-session', 'a1')).rejects.toThrow(/current reply/)
    clearGenerationCancel('plan-session', 'other')
    expect(updateSessionMock).not.toHaveBeenCalled()
  })

  test('resumeStoppedPlan refuses a plan that is not the last message', async () => {
    const session = stoppedPlanSession({ startedAt: 1 })
    session.messages.push(makeMessage('u2', 'user'))
    getSessionMock.mockResolvedValue(session)
    getSessionSettingsMock.mockResolvedValue({ planMode: true })
    await expect(sessionActions.resumeStoppedPlan('plan-session', 'a1')).rejects.toThrow(/latest plan/)
    expect(updateSessionMock).not.toHaveBeenCalled()
  })

  test('resumeStoppedPlan refuses when plan mode is off', async () => {
    getSessionMock.mockResolvedValue(stoppedPlanSession({ startedAt: 1 }))
    getSessionSettingsMock.mockResolvedValue({ planMode: false })
    await expect(sessionActions.resumeStoppedPlan('plan-session', 'a1')).rejects.toThrow()
    expect(updateSessionMock).not.toHaveBeenCalled()
  })

  test('an execution run that returns early does not leave the session executing', async () => {
    const approved = stoppedPlanSession({ startedAt: 1 }) // as stored once approved: generating from the approval
    approved.messages[1] = { ...approved.messages[1], generating: true }
    getSessionMock.mockResolvedValueOnce(pendingPlanSession()).mockResolvedValue(approved)
    getSessionSettingsMock.mockResolvedValue(undefined) // generate() returns before streaming
    await sessionActions.approveAndExecutePlan('plan-session', 'a1')
    expect(updateSessionMock).toHaveBeenCalledWith('plan-session', { planPhase: 'executing' })
    expect(updateSessionMock.mock.calls.at(-1)).toEqual(['plan-session', { planPhase: undefined }])
    // Nor is the message left generating (the approval marks it generating at once, see M1).
    expect((updateMessageMock.mock.calls.at(-1)?.[2] as Message).generating).toBe(false)
  })

  test('Run plan marks the message generating with the approval, so the card never flashes "Plan stopped"', async () => {
    getSessionMock.mockResolvedValue(pendingPlanSession())
    await sessionActions.approveAndExecutePlan('plan-session', 'a1').catch(() => {})
    const first = updateMessageMock.mock.calls[0]?.[2] as Message
    expect(first.contentParts.find((p) => p.type === 'plan')).toMatchObject({ status: 'approved' })
    expect(first.generating).toBe(true)
  })

  test('Continue marks the message generating and stamps the new run start before the run sets up', async () => {
    getSessionMock.mockResolvedValue(stoppedPlanSession({ startedAt: 1 }))
    getSessionSettingsMock.mockResolvedValue({ planMode: true })
    const before = Date.now()
    await sessionActions.resumeStoppedPlan('plan-session', 'a1').catch(() => {})
    const first = updateMessageMock.mock.calls[0]?.[2] as Message
    expect(first.generating).toBe(true)
    const plan = first.contentParts.find((p) => p.type === 'plan') as MessagePlanPart
    expect(plan.startedAt).toBe(1) // the first start still scopes the run's tasks
    expect(plan.runStartedAt).toBeGreaterThanOrEqual(before)
  })

  test('resumeStoppedPlan refuses while another turn is still setting up (live, no abort yet)', async () => {
    const { markSessionGenerationLive, clearSessionGenerationLive } = await import('./session/session-live-generation')
    markSessionGenerationLive('plan-session', 'other')
    getSessionMock.mockResolvedValue(stoppedPlanSession({ startedAt: 1 }))
    getSessionSettingsMock.mockResolvedValue({ planMode: true })
    await expect(sessionActions.resumeStoppedPlan('plan-session', 'a1')).rejects.toThrow(/current reply/)
    clearSessionGenerationLive('plan-session', 'other')
    expect(updateSessionMock).not.toHaveBeenCalled()
  })

  const savedPlan = () =>
    (updateMessageMock.mock.calls.at(-1)?.[2] as Message).contentParts.find(
      (p): p is MessagePlanPart => p.type === 'plan'
    )

  test('a finished plan stays finished when post-turn work throws, and files one Change (I2)', async () => {
    let thrown = false
    updateSessionMock.mockImplementation((_id: string, patch: { planPhase?: string }) => {
      // The post-settle phase release fails once (e.g. the session file is briefly locked).
      if (!thrown && 'planPhase' in patch && patch.planPhase === undefined) {
        thrown = true
        return Promise.reject(new Error('session write failed'))
      }
      return Promise.resolve()
    })
    await resumeWithStream([{ type: 'text', text: 'Checked it' }])
    expect(thrown).toBe(true)
    const saved = updateMessageMock.mock.calls.at(-1)?.[2] as Message
    expect(saved.error).toBeUndefined()
    expect(savedPlan()?.finishedAt).toBeDefined()
    expect(addReviewEntryMock).toHaveBeenCalledTimes(1)
  })

  test('Stop during an execution run: no finishedAt and no Change entry (M9)', async () => {
    await resumeWithStream([{ type: 'text', text: 'Half done' }], { stop: true })
    const plan = savedPlan()
    expect(plan).toMatchObject({ status: 'approved', startedAt: 1 })
    expect(plan?.finishedAt).toBeUndefined()
    expect(plan?.runMs).toBeGreaterThanOrEqual(0) // the stopped run's time is kept for the next run's timer
    expect(addReviewEntryMock).not.toHaveBeenCalled()
  })

  test('a long run is timed from the run, not the message: an old message re-run for seconds is not long', async () => {
    const { notifySystemEvent } = await import('@/packages/notifications')
    vi.mocked(notifySystemEvent).mockClear()
    const { streamText } = await import('@/packages/model-calls')
    vi.mocked(streamText).mockImplementation(async (_model, streamOpts) => {
      const parts = [{ type: 'text' as const, text: 'Done' }]
      await streamOpts.onResultChangeWithCancel?.({ contentParts: parts, cancel: () => {} })
      // The run takes 5 s; every persisted write re-stamps the message, so its timestamp is no run start.
      vi.setSystemTime(Date.now() + 5_000)
      return { result: { contentParts: parts, text: 'Done', finishReason: 'stop' }, knowledgeIds: [] } as never
    })
    uuidQueue.push(...Array.from({ length: 50 }, (_, i) => `uuid-${i}`))
    const session = stoppedPlanSession({ startedAt: 1 })
    // The plan message was written an hour ago; this run (resume) takes a moment.
    session.messages[1] = { ...session.messages[1], timestamp: Date.now() - 3_600_000 }
    session.messages[0] = { ...session.messages[0], contentParts: [{ type: 'text', text: 'Tidy the docs' }] }
    getSessionMock.mockResolvedValue(session)
    getSessionSettingsMock.mockResolvedValue({
      planMode: true,
      provider: 'openai',
      modelId: 'gpt',
      maxContextMessageCount: 20,
    })
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const before = Date.now()
      await sessionActions.resumeStoppedPlan('plan-session', 'a1')
      expect(notifySystemEvent).toHaveBeenCalledTimes(1)
      const event = vi.mocked(notifySystemEvent).mock.calls[0][0] as { kind: string; startedAt: number }
      expect(event.kind).toBe('long_run_done')
      // From the run's start: not the hour-old message, not the last write's re-stamp.
      expect(event.startedAt).toBeGreaterThanOrEqual(before)
      expect(event.startedAt).toBeLessThan(before + 5_000)
      expect(Date.now() - event.startedAt).toBeLessThan(60_000)
    } finally {
      vi.useRealTimers()
      vi.mocked(streamText).mockReset()
    }
  })

  test('a finished execution run files exactly one Change entry', async () => {
    await resumeWithStream([{ type: 'text', text: 'Checked it' }])
    expect(savedPlan()?.finishedAt).toBeDefined()
    expect(addReviewEntryMock).toHaveBeenCalledTimes(1)
    expect(addReviewEntryMock.mock.calls[0][0]).toMatchObject({ kind: 'change', chatId: 'plan-session' })
  })

  test('an approved plan keeps its plan part and finish when plan mode is off (M12)', async () => {
    const { streamText } = await import('@/packages/model-calls')
    vi.mocked(streamText).mockImplementation(async (_model, streamOpts) => {
      const parts = [{ type: 'text' as const, text: 'Done' }]
      await streamOpts.onResultChangeWithCancel?.({ contentParts: parts })
      return { result: { contentParts: parts, text: 'Done', finishReason: 'stop' }, knowledgeIds: [] } as never
    })
    uuidQueue.push(...Array.from({ length: 50 }, (_, i) => `uuid-off-${i}`))
    const pending = pendingPlanSession()
    pending.agentMode = true
    const approved = stoppedPlanSession({ startedAt: Date.now() })
    getSessionMock.mockResolvedValueOnce(pending).mockResolvedValue(approved)
    getSessionSettingsMock.mockResolvedValue({
      planMode: false,
      provider: 'openai',
      modelId: 'gpt',
      maxContextMessageCount: 20,
    })
    await sessionActions.approveAndExecutePlan('plan-session', 'a1')
    expect(savedPlan()).toMatchObject({ status: 'approved' })
    expect(savedPlan()?.finishedAt).toBeDefined()
  })

  test('old plan payloads still parse', () => {
    expect(MessagePlanPartSchema.parse({ type: 'plan', planText: 'x', status: 'rejected' })).toEqual({
      type: 'plan',
      planText: 'x',
      status: 'rejected',
    })
    expect(MessagePlanPartSchema.parse({ type: 'plan', planText: 'x' }).status).toBe('pending')
    expect(
      MessagePlanPartSchema.parse({
        type: 'plan',
        planText: 'x',
        status: 'revised',
        version: 2,
        startedAt: 1,
        finishedAt: 2,
      })
    ).toMatchObject({ status: 'revised', version: 2, startedAt: 1, finishedAt: 2 })
  })
})
