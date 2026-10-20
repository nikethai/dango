import { isSwarmOn, roomAllowsArmedTools, shouldRunMultiAgentRoom, swarmSpeakerCount } from '@shared/agent-room'
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

describe('roomAllowsArmedTools (Browser / Computer use)', () => {
  const base = { roomMulti: false, roomMode: undefined, roomToolsAllowed: false, roomBlocksExternalTools: false }

  it('a solo turn in a 2-agent room with legacy discuss keeps armed tools (Swarm off)', () => {
    expect(roomAllowsArmedTools({ ...base, roomMode: 'discuss' })).toBe(true)
    expect(roomAllowsArmedTools({ ...base, roomMode: 'work' })).toBe(true)
    expect(roomAllowsArmedTools(base)).toBe(true)
  })

  it('a swarm room turn follows the role and the external-tools block', () => {
    const swarm = { ...base, roomMulti: true, roomMode: 'swarm' }
    expect(roomAllowsArmedTools({ ...swarm, roomToolsAllowed: true })).toBe(true)
    expect(roomAllowsArmedTools({ ...swarm, roomToolsAllowed: false })).toBe(false)
    expect(roomAllowsArmedTools({ ...swarm, roomToolsAllowed: true, roomBlocksExternalTools: true })).toBe(false)
  })

  it('a discuss room run stays off', () => {
    expect(roomAllowsArmedTools({ ...base, roomMulti: true, roomMode: 'discuss', roomToolsAllowed: true })).toBe(false)
  })
})

describe('swarmSpeakerCount', () => {
  it('counts who would speak this turn, as shouldRunMultiAgentRoom does', () => {
    expect(swarmSpeakerCount(['a', 'b'], [])).toBe(2)
    expect(swarmSpeakerCount(['a', 'b'], ['a'])).toBe(1)
    expect(swarmSpeakerCount(['a'], ['b', 'c'])).toBe(2)
    expect(swarmSpeakerCount([], [])).toBe(0)
  })
})

describe('wiring (source)', () => {
  it('generation gates Browser and Computer use on the turn, not on room size', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/renderer/stores/session/generation.ts', 'utf8')
    expect(src).not.toContain('roomMultiLocal')
    expect(src.split('roomAllowsArmedTools({').length - 1).toBe(2)
  })

  it('the composer counts Swarm agents as this turn’s speakers', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync('src/renderer/components/InputBox/InputBox.tsx', 'utf8')
    expect(src).toContain('swarmSpeakerCount(roomAgentIds, draftMentionedAgentIds)')
  })
})
