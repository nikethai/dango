import type { Message } from '@shared/types'
import i18next from 'i18next'
import { beforeAll, describe, expect, it } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import { foldSwarmRuns, type SwarmRun, swarmLiveLabel, swarmSummaryLabel } from './foldSwarmRuns'

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: { en: { translation: en } } })
})

function user(id: string, text = 'Write the launch post'): Message {
  return { id, role: 'user', contentParts: [{ type: 'text', text }] } as Message
}

function turn(
  id: string,
  roomRole: 'plan' | 'do' | 'deliver',
  agent: string,
  runId: string,
  extra: Partial<Message> = {},
  taskTitle?: string
): Message {
  return {
    id,
    role: 'assistant',
    contentParts: [{ type: 'text', text: `${agent} ${roomRole}` }],
    agentId: agent.toLowerCase(),
    name: agent,
    roomRole,
    swarm: { runId, ...(taskTitle ? { taskTitle } : {}) },
    ...extra,
  } as Message
}

function oneRun(): Message[] {
  return [
    user('u1'),
    turn('p1', 'plan', 'Ana', 'r1', { usage: { totalTokens: 1000 } }),
    turn('d1', 'do', 'Bo', 'r1', { usage: { inputTokens: 300, outputTokens: 200 } }, 'Draft intro'),
    turn('d2', 'do', 'Cy', 'r1', {}, 'Check numbers'),
    turn('a1', 'deliver', 'Ana', 'r1', { usage: { totalTokens: 400 } }),
  ]
}

describe('foldSwarmRuns', () => {
  it('folds a run into its answer and keeps who did what', () => {
    const { visible, runs, anchorOf } = foldSwarmRuns(oneRun())
    expect(visible.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(anchorOf).toEqual({ a1: 'r1' })
    const run = runs.r1
    expect(run.answerId).toBe('a1')
    expect(run.rounds).toBe(2)
    expect(run.tokens).toBe(1900)
    expect(run.stoppedEarly).toBe(false)
    expect(run.agents.map((a) => [a.name, a.captain, a.contribution])).toEqual([
      ['Ana', true, ['Planned the work', 'Wrote the answer']],
      ['Bo', false, ['Draft intro']],
      ['Cy', false, ['Check numbers']],
    ])
  })

  it('a do turn without a task title reads "Did a task"', () => {
    const messages = [user('u1'), turn('p1', 'plan', 'Ana', 'r1'), turn('d1', 'do', 'Bo', 'r1')]
    expect(foldSwarmRuns(messages).runs.r1.agents[1].contribution).toEqual(['Did a task'])
  })

  it('tokens are absent when no turn reports usage', () => {
    const messages = [user('u1'), turn('p1', 'plan', 'Ana', 'r1'), turn('a1', 'deliver', 'Ana', 'r1')]
    expect(foldSwarmRuns(messages).runs.r1.tokens).toBeUndefined()
  })

  it('a run without an answer keeps its latest turn as the anchor, in place', () => {
    const messages = [user('u1'), turn('p1', 'plan', 'Ana', 'r1'), turn('d1', 'do', 'Bo', 'r1', {}, 'Draft intro')]
    const { visible, runs, anchorOf } = foldSwarmRuns(messages)
    expect(visible.map((m) => m.id)).toEqual(['u1', 'd1'])
    expect(anchorOf).toEqual({ d1: 'r1' })
    expect(runs.r1.answerId).toBeUndefined()
  })

  it('two runs in one chat fold separately', () => {
    const messages = [
      ...oneRun(),
      user('u2', 'Again'),
      turn('p2', 'plan', 'Bo', 'r2'),
      turn('d3', 'do', 'Ana', 'r2', {}, 'Shorten it'),
      turn('a2', 'deliver', 'Bo', 'r2', {}),
    ]
    const { visible, runs, anchorOf } = foldSwarmRuns(messages)
    expect(visible.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(anchorOf).toEqual({ a1: 'r1', a2: 'r2' })
    expect(runs.r2.agents.map((a) => [a.name, a.captain])).toEqual([
      ['Bo', true],
      ['Ana', false],
    ])
    expect(runs.r2.rounds).toBe(1)
  })

  it('leaves messages without swarm untouched', () => {
    const plain = { id: 'x1', role: 'assistant', roomRole: 'plan', contentParts: [] } as unknown as Message
    const messages = [user('u1'), plain]
    const { visible, runs, anchorOf } = foldSwarmRuns(messages)
    expect(visible).toEqual(messages)
    expect(visible[1]).toBe(plain)
    expect(runs).toEqual({})
    expect(anchorOf).toEqual({})
  })

  it('stoppedEarly comes from the answer', () => {
    const messages = oneRun()
    messages[4] = { ...messages[4], swarm: { runId: 'r1', stoppedEarly: true } }
    expect(foldSwarmRuns(messages).runs.r1.stoppedEarly).toBe(true)
  })

  it('a stopped plan turn with an error folds away under the answer', () => {
    const messages = [
      user('u1'),
      turn('p1', 'plan', 'Ana', 'r1', { error: 'The model returned an empty response', errorCode: 10001 }),
      turn('a1', 'deliver', 'Ana', 'r1', { swarm: { runId: 'r1', stoppedEarly: true } }),
    ]
    const { visible, runs } = foldSwarmRuns(messages)
    expect(visible.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(runs.r1.stoppedEarly).toBe(true)
    expect(runs.r1.rounds).toBe(0)
  })

  it('the "could not plan" note stays in the thread as a message', () => {
    const note = turn('n1', 'plan', 'Ana', 'r1')
    note.contentParts = [
      { type: 'text', text: '_Swarm could not plan tasks from this request. Try a clearer multi-step goal._' },
    ]
    const messages = [user('u1'), turn('p1', 'plan', 'Ana', 'r1'), note]
    const { visible, anchorOf } = foldSwarmRuns(messages)
    expect(visible.map((m) => m.id)).toEqual(['u1', 'p1', 'n1'])
    expect(anchorOf).toEqual({ p1: 'r1' })
  })

  it('a run that could not plan keeps its failed plan turns, so their error and fix show', () => {
    const failed = { error: 'Your Anthropic key was rejected.', errorCode: 401 }
    const note = turn('n1', 'plan', 'Ana', 'r1')
    note.contentParts = [{ type: 'text', text: '_Swarm could not plan tasks from this request._' }]
    const messages = [
      user('u1'),
      turn('p1', 'plan', 'Ana', 'r1', failed),
      turn('p2', 'plan', 'Ana', 'r1', failed),
      note,
    ]
    const { visible, anchorOf } = foldSwarmRuns(messages)
    expect(visible.map((m) => m.id)).toEqual(['u1', 'p1', 'p2', 'n1'])
    expect(anchorOf).toEqual({})
  })

  it('takes provider and model from the agent turns', () => {
    const messages = [
      user('u1'),
      turn('p1', 'plan', 'Ana', 'r1', { aiProvider: 'openai', model: 'gpt-5' }),
      turn('d1', 'do', 'Bo', 'r1', {}, 'Draft intro'),
    ]
    const { agents } = foldSwarmRuns(messages).runs.r1
    expect([agents[0].provider, agents[0].model]).toEqual(['openai', 'gpt-5'])
    expect([agents[1].provider, agents[1].model]).toEqual([undefined, undefined])
  })
})

describe('swarmLiveLabel', () => {
  const base = { agentCount: 3, stopping: false }
  it('planning', () => {
    expect(swarmLiveLabel({ ...base, phase: 'plan' })).toBe('Working with 3 agents · planning')
  })
  it('a round per task', () => {
    expect(swarmLiveLabel({ ...base, phase: 'do', taskIndex: 2, taskTotal: 5 })).toBe(
      'Working with 3 agents · round 2 of 5'
    )
  })
  it('writing the answer', () => {
    expect(swarmLiveLabel({ ...base, phase: 'deliver' })).toBe('Working with 3 agents · writing the answer')
  })
  it('stopping', () => {
    expect(swarmLiveLabel({ ...base, phase: 'do', taskIndex: 1, taskTotal: 2, stopping: true })).toBe(
      'Working with 3 agents · stopping, the captain is writing with what exists'
    )
  })
})

describe('swarmSummaryLabel', () => {
  function run(over: Partial<SwarmRun>): SwarmRun {
    const agent = { agentId: 'a', name: 'A', captain: false, contribution: [] }
    return {
      runId: 'r1',
      agents: [agent, { ...agent, agentId: 'b' }, { ...agent, agentId: 'c' }],
      rounds: 1,
      stoppedEarly: false,
      answerId: 'a1',
      ...over,
    }
  }
  it('one round and thousands of tokens', () => {
    expect(swarmSummaryLabel(run({ rounds: 1, tokens: 12_400 }))).toBe('Worked with 3 agents · 1 round · 12.4k tokens')
  })
  it('several rounds and few tokens', () => {
    expect(swarmSummaryLabel(run({ rounds: 3, tokens: 980 }))).toBe('Worked with 3 agents · 3 rounds · 980 tokens')
  })
  it('drops the tokens part when none were reported', () => {
    expect(swarmSummaryLabel(run({ rounds: 2 }))).toBe('Worked with 3 agents · 2 rounds')
  })
  it('a run with no answer stopped before one', () => {
    expect(swarmSummaryLabel(run({ answerId: undefined }))).toBe('Worked with 3 agents · stopped before an answer')
  })
})
