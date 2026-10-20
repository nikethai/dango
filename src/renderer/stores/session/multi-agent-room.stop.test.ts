import type { Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

type GenerateOptions = { roomRole?: string; swarmStoppedEarly?: boolean }

const h = vi.hoisted(() => ({
  messages: [] as Message[],
  onGenerate: null as null | ((sessionId: string, msg: Message, options: GenerateOptions) => Promise<void>),
  generate: vi.fn(),
  stopChatIfRunning: vi.fn(async (_sessionId: string) => true),
}))

vi.mock('../chatStore', () => ({
  getSession: vi.fn(async (id: string) => ({ id, name: 'Swarm chat', messages: h.messages.map((m) => ({ ...m })) })),
}))

vi.mock('../scrollActions', () => ({ scrollToBottom: () => undefined }))

vi.mock('./messages', () => ({
  insertMessage: vi.fn((_sessionId: string, msg: Message) => {
    h.messages.push({ ...msg })
    return Promise.resolve()
  }),
  modifyMessage: vi.fn((_sessionId: string, msg: Message) => {
    h.messages = h.messages.map((m) => (m.id === msg.id ? { ...msg } : m))
    return Promise.resolve()
  }),
  submitNewUserMessage: vi.fn(async () => undefined),
}))

vi.mock('./generation', () => ({
  generate: (sessionId: string, msg: Message, options: GenerateOptions) => {
    h.generate(options)
    return h.onGenerate?.(sessionId, msg, options)
  },
}))

vi.mock('./messageQueue', () => ({
  messageQueueStore: { getState: () => ({ getQueuedCount: () => 0, dequeueMessage: () => undefined }) },
}))

vi.mock('./stop-generation', () => ({ stopChatIfRunning: h.stopChatIfRunning }))

vi.mock('@/packages/notifications', () => ({ notifySystemEvent: vi.fn(async () => undefined) }))

vi.mock('@/packages/agents', () => ({
  resolveAgentMeta: (id: string) => ({ id, name: id.toUpperCase(), emojiAvatar: '🤖' }),
}))

vi.mock('../taskStore', () => {
  const api = {
    tasks: [],
    hydrateSessionTasks: async () => undefined,
    clearSessionTasks: () => undefined,
    getSessionTasks: () => [],
    listReadyTasks: () => [],
    updateTask: () => null,
    setTaskAssignee: () => null,
    setTaskDeps: () => null,
    createTask: () => ({ ok: false, error: 'off' }),
  }
  return { MAX_SESSION_TASKS: 20, generateTaskId: () => 'task', taskStore: { getState: () => api } }
})

import { markGenerationStoppedByUser } from './generation-cancel'
import { runAgentRoomSwarm } from './multi-agent-room'
import { requestSwarmStop } from './team-room-state'

const SESSION = 'session-1'

/** Write the turn's result the way a stopped stream leaves it: not generating, no cancel fn, no error. */
function settle(msg: Message, contentParts: Message['contentParts']) {
  h.messages = h.messages.map((m) => (m.id === msg.id ? { ...m, generating: false, contentParts } : m))
}

const toolCallOnly: Message['contentParts'] = [
  { type: 'tool-call', state: 'result', toolCallId: 'c1', toolName: 'create_task', args: {}, result: {} },
]

beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => setTimeout(cb, 0))
  h.messages = [{ id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Go' }] }]
  h.generate.mockClear()
  h.stopChatIfRunning.mockClear()
  h.onGenerate = null
})

describe('generateSpeakerTurn after Stop', () => {
  it('Stop after a plan turn only called tools does not re-run the turn', async () => {
    h.onGenerate = async (sessionId, msg, options) => {
      if (options.roomRole === 'plan') {
        settle(msg, toolCallOnly)
        await requestSwarmStop(sessionId)
        return
      }
      settle(msg, [{ type: 'text', text: 'Best answer so far' }])
    }
    await runAgentRoomSwarm(SESSION, { speakers: ['ana', 'bo'] })
    const roles = h.generate.mock.calls.map(([o]) => (o as GenerateOptions).roomRole)
    expect(roles).toEqual(['plan', 'deliver'])
    expect((h.generate.mock.calls[1][0] as GenerateOptions).swarmStoppedEarly).toBe(true)
    const plan = h.messages.find((m) => m.roomRole === 'plan')
    expect(plan?.contentParts).toEqual(toolCallOnly)
  })

  it('an ordinary Stop on the answer before any text does not re-run it or add a placeholder', async () => {
    let planned = false
    h.onGenerate = async (sessionId, msg, options) => {
      if (options.roomRole === 'plan' && !planned) {
        planned = true
        settle(msg, toolCallOnly)
        await requestSwarmStop(sessionId)
        return
      }
      // Stop pressed on the captain's answer before it wrote anything.
      settle(msg, [])
      markGenerationStoppedByUser(sessionId, msg.id)
    }
    await runAgentRoomSwarm(SESSION, { speakers: ['ana', 'bo'] })
    const roles = h.generate.mock.calls.map(([o]) => (o as GenerateOptions).roomRole)
    expect(roles).toEqual(['plan', 'deliver'])
    const deliver = h.messages.find((m) => m.roomRole === 'deliver')
    expect(deliver?.contentParts).toEqual([])
  })
})
