import { isSwarmOn, shouldRunMultiAgentRoom } from '@shared/agent-room'
import { describe, expect, it } from 'vitest'

describe('Swarm toggle', () => {
  it('runs a room only when Swarm is on and two or more agents speak', () => {
    expect(shouldRunMultiAgentRoom(undefined, ['a', 'b'], 'swarm')).toBe(true)
  })

  it('Swarm off (and legacy discuss / work) answers as one agent', () => {
    expect(shouldRunMultiAgentRoom(undefined, ['a', 'b'], undefined)).toBe(false)
    expect(shouldRunMultiAgentRoom(undefined, ['a', 'b'], 'discuss')).toBe(false)
    expect(shouldRunMultiAgentRoom(undefined, ['a', 'b'], 'work')).toBe(false)
  })

  it('one agent never runs a room, even with Swarm on', () => {
    expect(shouldRunMultiAgentRoom(undefined, ['a'], 'swarm')).toBe(false)
  })

  it('mentions this turn count as speakers', () => {
    expect(shouldRunMultiAgentRoom(['a', 'b'], ['a'], 'swarm')).toBe(true)
    expect(shouldRunMultiAgentRoom(['a'], ['a', 'b'], 'swarm')).toBe(false)
  })

  it('isSwarmOn reads only swarm as on', () => {
    expect(isSwarmOn('swarm')).toBe(true)
    expect(isSwarmOn(undefined)).toBe(false)
    expect(isSwarmOn('discuss')).toBe(false)
    expect(isSwarmOn('work')).toBe(false)
  })
})
