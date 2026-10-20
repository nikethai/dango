import { createMessage, type Message } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Task } from '../taskStore'

const h = vi.hoisted(() => {
  const state = {
    tasks: [] as Task[],
    messages: [] as { id: string; role: string }[],
    counter: 0,
  }
  return {
    state,
    insertMessage: vi.fn(async (_sessionId: string, _msg: unknown) => undefined),
    stopChatIfRunning: vi.fn(async (_sessionId: string) => true),
    notifySystemEvent: vi.fn(async () => undefined),
  }
})

vi.mock('../chatStore', () => ({
  getSession: vi.fn(async (id: string) => ({ id, name: 'Swarm chat', messages: [...h.state.messages] })),
}))

vi.mock('./messages', () => ({ insertMessage: h.insertMessage }))

vi.mock('./stop-generation', () => ({ stopChatIfRunning: h.stopChatIfRunning }))

vi.mock('@/packages/notifications', () => ({ notifySystemEvent: h.notifySystemEvent }))

vi.mock('@/packages/agents', () => ({
  resolveAgentMeta: (id: string) => ({ id, name: id.toUpperCase(), emojiAvatar: '🤖' }),
}))

vi.mock('../taskStore', () => {
  const find = (id: string) => h.state.tasks.find((t) => t.id === id)
  const api = {
    get tasks() {
      return h.state.tasks
    },
    hydrateSessionTasks: async () => undefined,
    clearSessionTasks: (sessionId: string) => {
      h.state.tasks = h.state.tasks.filter((t) => t.sessionId !== sessionId)
    },
    getSessionTasks: (sessionId: string) => h.state.tasks.filter((t) => t.sessionId === sessionId),
    listReadyTasks: (sessionId: string) =>
      h.state.tasks.filter((t) => t.sessionId === sessionId && t.status === 'pending'),
    updateTask: (id: string, updates: Partial<Task>) => {
      const task = find(id)
      if (task) Object.assign(task, updates)
      return task ?? null
    },
    setTaskAssignee: (id: string, assigneeAgentId: string | undefined) => {
      const task = find(id)
      if (task) task.assigneeAgentId = assigneeAgentId
      return task ?? null
    },
    setTaskDeps: () => null,
    createTask: (sessionId: string, id: string, title: string, options?: { assigneeAgentId?: string }) => {
      const now = Date.now()
      const task: Task = {
        id,
        sessionId,
        title,
        status: 'pending',
        assigneeAgentId: options?.assigneeAgentId,
        createdAt: now,
        updatedAt: now,
      }
      h.state.tasks.push(task)
      return { ok: true as const, task }
    },
  }
  return {
    MAX_SESSION_TASKS: 20,
    generateTaskId: () => `task-${++h.state.counter}`,
    taskStore: { getState: () => api },
  }
})

import { runAgentRoomSwarm, type SwarmSpeakerTurn } from './multi-agent-room-swarm'
import {
  clearSwarmStopRequest,
  getTeamRoomLive,
  isSwarmStoppable,
  isSwarmStopRequested,
  requestSwarmStop,
  setTeamRoomLive,
  swarmStopRoute,
} from './team-room-state'

type TurnParams = Parameters<SwarmSpeakerTurn>[1]

const SESSION = 'session-1'
const SPEAKERS = ['ana', 'bo', 'cy']

function makeTasks(titles: string[]) {
  const now = Date.now()
  titles.forEach((title, i) => {
    h.state.tasks.push({
      id: `t${i + 1}`,
      sessionId: SESSION,
      title,
      status: 'pending',
      assigneeAgentId: SPEAKERS[i % SPEAKERS.length],
      createdAt: now + i,
      updatedAt: now + i,
    })
  })
}

function reply(text: string): Message {
  return createMessage('assistant', text)
}

/** Fake turn: records params; the plan turn creates a three-task board. */
type TurnHook = (
  params: TurnParams
) => { interrupted: boolean } | undefined | Promise<{ interrupted: boolean } | undefined>

function fakeTurns(onTurn?: TurnHook) {
  const calls: TurnParams[] = []
  const live: ReturnType<typeof getTeamRoomLive>[] = []
  const turn: SwarmSpeakerTurn = async (_sessionId, params) => {
    calls.push(params)
    live.push(getTeamRoomLive())
    if (params.roomRole === 'plan') makeTasks(['Research', 'Draft', 'Edit'])
    const custom = await onTurn?.(params)
    return { msg: reply(`${params.roomRole} done`), interrupted: custom?.interrupted ?? false }
  }
  return { turn, calls, live }
}

function run(turn: SwarmSpeakerTurn) {
  return runAgentRoomSwarm(SESSION, { speakers: SPEAKERS, generateSpeakerTurn: turn })
}

beforeEach(() => {
  h.state.tasks = []
  h.state.counter = 0
  h.state.messages = [{ id: 'u1', role: 'user' }]
  h.insertMessage.mockClear()
  h.stopChatIfRunning.mockClear()
})

describe('runAgentRoomSwarm', () => {
  it('every turn shares one runId', async () => {
    const { turn, calls } = fakeTurns()
    await run(turn)
    expect(calls.map((c) => c.roomRole)).toEqual(['plan', 'do', 'do', 'do', 'deliver'])
    const runIds = new Set(calls.map((c) => c.runId))
    expect(runIds.size).toBe(1)
    expect([...runIds][0]).toMatch(/^swarm-\d+$/)
    expect(calls.every((c) => !c.stoppedEarly)).toBe(true)
  })

  it('live status counts agents', async () => {
    const { turn, calls, live } = fakeTurns()
    await run(turn)
    expect(calls.every((c) => c.agentCount === 3)).toBe(true)
    expect(live[0]).toMatchObject({ sessionId: SESSION, mode: 'swarm', agentCount: 3, runId: calls[0].runId })
    expect(getTeamRoomLive()).toBeNull()
  })

  it('stop during a task delivers early', async () => {
    let first = true
    const { turn, calls } = fakeTurns(async (params) => {
      if (params.roomRole === 'do' && first) {
        first = false
        await requestSwarmStop(SESSION)
        expect(isSwarmStopRequested(SESSION)).toBe(true)
        return { interrupted: true }
      }
      return undefined
    })
    await run(turn)
    expect(h.stopChatIfRunning).toHaveBeenCalledWith(SESSION)
    expect(calls.map((c) => c.roomRole)).toEqual(['plan', 'do', 'deliver'])
    expect(calls[2]).toMatchObject({ roomRole: 'deliver', stoppedEarly: true, runId: calls[0].runId })
    expect(h.state.tasks.map((t) => t.status)).toEqual(['pending', 'pending', 'pending'])
    expect(isSwarmStopRequested(SESSION)).toBe(false)
  })

  it('stop during planning still delivers', async () => {
    const calls: TurnParams[] = []
    const turn: SwarmSpeakerTurn = async (_sessionId, params) => {
      calls.push(params)
      if (params.roomRole === 'plan') {
        await requestSwarmStop(SESSION)
        return { msg: reply(''), interrupted: true }
      }
      return { msg: reply('answer'), interrupted: false }
    }
    await run(turn)
    expect(calls.map((c) => c.roomRole)).toEqual(['plan', 'deliver'])
    expect(calls[1]).toMatchObject({ stoppedEarly: true, runId: calls[0].runId })
    expect(h.insertMessage).not.toHaveBeenCalled()
    expect(isSwarmStopRequested(SESSION)).toBe(false)
  })

  it('new user message aborts without deliver', async () => {
    let first = true
    const { turn, calls } = fakeTurns((params) => {
      if (params.roomRole === 'do' && first) {
        first = false
        h.state.messages.push({ id: 'a1', role: 'assistant' }, { id: 'u2', role: 'user' })
        return { interrupted: true }
      }
      return undefined
    })
    await run(turn)
    expect(calls.map((c) => c.roomRole)).toEqual(['plan', 'do'])
    expect(h.state.tasks[0].status).toBe('pending')
  })

  it('the could-not-plan note carries the run id', async () => {
    const calls: TurnParams[] = []
    const turn: SwarmSpeakerTurn = (_sessionId, params) => {
      calls.push(params)
      return Promise.resolve({ msg: reply('no plan here'), interrupted: false })
    }
    await run(turn)
    expect(calls.map((c) => c.roomRole)).toEqual(['plan', 'plan'])
    const note = h.insertMessage.mock.calls[0]?.[1] as Message
    expect(note.swarm).toEqual({ runId: calls[0].runId, note: true })
    expect(JSON.stringify(note.contentParts)).toContain('Swarm could not plan tasks from this request.')
  })

  it('Stop goes to the Swarm until the captain answers', () => {
    setTeamRoomLive({ sessionId: SESSION, phase: 'do', mode: 'swarm' })
    expect(isSwarmStoppable(SESSION)).toBe(true)
    expect(isSwarmStoppable('other')).toBe(false)
    setTeamRoomLive({ sessionId: SESSION, phase: 'deliver', mode: 'swarm' })
    expect(isSwarmStoppable(SESSION)).toBe(false)
    setTeamRoomLive({ sessionId: SESSION, phase: 'turn', mode: 'discuss' })
    expect(isSwarmStoppable(SESSION)).toBe(false)
    setTeamRoomLive(null)
  })

  it('stop wins even when the stopped turn does not report itself interrupted', async () => {
    let first = true
    const { turn, calls } = fakeTurns(async (params) => {
      if (params.roomRole === 'do' && first) {
        first = false
        await requestSwarmStop(SESSION)
        return { interrupted: false }
      }
      return undefined
    })
    await run(turn)
    expect(calls.map((c) => c.roomRole)).toEqual(['plan', 'do', 'deliver'])
    expect(calls[2].stoppedEarly).toBe(true)
    expect(h.state.tasks.map((t) => t.status)).toEqual(['pending', 'pending', 'pending'])
  })

  it('a run that throws leaves no live status and no stop flag', async () => {
    const turn: SwarmSpeakerTurn = async (sessionId) => {
      await requestSwarmStop(sessionId)
      throw new Error('boom')
    }
    await expect(run(turn)).rejects.toThrow('boom')
    expect(getTeamRoomLive()).toBeNull()
    expect(isSwarmStopRequested(SESSION)).toBe(false)
  })

  it('a stale stop flag from an earlier run is cleared when a run starts', async () => {
    await requestSwarmStop(SESSION)
    const { turn, calls } = fakeTurns()
    await run(turn)
    expect(calls.map((c) => c.roomRole)).toEqual(['plan', 'do', 'do', 'do', 'deliver'])
    expect(calls.every((c) => !c.stoppedEarly)).toBe(true)
  })
})

describe('swarmStopRoute (composer and message Stop)', () => {
  const deliver = (text: string): Message => ({
    ...createMessage('assistant', text),
    generating: true,
    roomRole: 'deliver',
    swarm: { runId: 'swarm-1' },
  })

  beforeEach(() => {
    setTeamRoomLive(null)
    clearSwarmStopRequest(SESSION)
  })

  it('an ordinary chat stops as before', () => {
    expect(swarmStopRoute(SESSION, deliver('x'))).toBe('stop')
  })

  it('a running Swarm routes the first Stop to the run', () => {
    setTeamRoomLive({ sessionId: SESSION, phase: 'do', mode: 'swarm' })
    expect(swarmStopRoute(SESSION, null)).toBe('swarm')
  })

  it('a second Stop is ignored until the captain has written something, then stops the answer', async () => {
    setTeamRoomLive({ sessionId: SESSION, phase: 'do', mode: 'swarm' })
    await requestSwarmStop(SESSION)
    // The deliver turn may already stream before the live phase says so.
    expect(swarmStopRoute(SESSION, deliver(''))).toBe('ignore')
    setTeamRoomLive({ sessionId: SESSION, phase: 'deliver', mode: 'swarm' })
    expect(swarmStopRoute(SESSION, deliver(''))).toBe('ignore')
    expect(swarmStopRoute(SESSION, deliver('Partial answer'))).toBe('stop')
    expect(h.stopChatIfRunning).toHaveBeenCalledTimes(1)
  })

  it('after Stop, the captain answer can be stopped 1.5 s after it starts, even before any text', async () => {
    let now = 1_000_000
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now)
    try {
      setTeamRoomLive({ sessionId: SESSION, phase: 'do', mode: 'swarm', runId: 'swarm-1' })
      await requestSwarmStop(SESSION)
      now += 10_000
      // Before the answer turn starts: ignored, however long the do turn takes to stop.
      expect(swarmStopRoute(SESSION, null)).toBe('ignore')
      setTeamRoomLive({ sessionId: SESSION, phase: 'deliver', mode: 'swarm', runId: 'swarm-1' })
      now += 1_499
      expect(swarmStopRoute(SESSION, deliver(''))).toBe('ignore')
      // A repeated live update of the same answer turn does not restart the guard.
      setTeamRoomLive({ sessionId: SESSION, phase: 'deliver', mode: 'swarm', runId: 'swarm-1', speakerName: 'Ana' })
      now += 1
      // Slow first token or waiting on a tool: an ordinary Stop of the answer.
      expect(swarmStopRoute(SESSION, deliver(''))).toBe('stop')
      expect(swarmStopRoute(SESSION, null)).toBe('stop')
    } finally {
      clock.mockRestore()
    }
  })

  it('within the guard, an answer that already has text stops', async () => {
    setTeamRoomLive({ sessionId: SESSION, phase: 'do', mode: 'swarm' })
    await requestSwarmStop(SESSION)
    setTeamRoomLive({ sessionId: SESSION, phase: 'deliver', mode: 'swarm' })
    expect(swarmStopRoute(SESSION, deliver('Partial answer'))).toBe('stop')
  })
})
