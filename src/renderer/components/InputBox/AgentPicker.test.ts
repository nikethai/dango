/**
 * @vitest-environment jsdom
 */
import type { AgentDetail } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { filterAgents } from './AgentPicker'

const agent = (id: string, name: string, prompt: string): AgentDetail => ({ id, name, prompt, usedCount: 0 })

const deepResearcher = agent('deep', 'Deep Researcher', 'You are Deep Researcher. When solving a task: find sources.')
const taskPlanner = agent('task', 'Task Planner', 'You are Task Planner. Break goals into plans.')
const multitasker = agent('multi', 'Multitasker', 'Juggles many things.')

describe('filterAgents', () => {
  it('ranks a name match above a blurb match', () => {
    expect(filterAgents([deepResearcher, taskPlanner], 'Task').map((a) => a.id)).toEqual(['task', 'deep'])
  })

  it('ranks a name that starts with the query above one that only contains it', () => {
    expect(filterAgents([multitasker, deepResearcher, taskPlanner], 'task').map((a) => a.id)).toEqual([
      'task',
      'multi',
      'deep',
    ])
  })

  it('keeps every agent, by name, for an empty query', () => {
    expect(filterAgents([taskPlanner, deepResearcher], '').map((a) => a.id)).toEqual(['deep', 'task'])
  })
})
