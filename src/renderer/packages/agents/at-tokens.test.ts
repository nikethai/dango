import { describe, expect, it } from 'vitest'
import {
  extractAgentSlugsFromText,
  extractSettledAgentSlugsFromText,
  fuzzyScoreAgent,
  getActiveAgentAtQuery,
  matchAgentBySlug,
  replaceActiveAgentAtWithToken,
  slugifyAgentName,
  stripActiveAgentAtToken,
  stripAgentTokenFromText,
} from './at-tokens'

describe('agent at-tokens', () => {
  it('detects active @ query', () => {
    expect(getActiveAgentAtQuery('hello @cod')).toBe('cod')
    expect(getActiveAgentAtQuery('hello @')).toBe('')
    expect(getActiveAgentAtQuery('no trigger')).toBe(null)
    expect(getActiveAgentAtQuery('email@x.com')).toBe(null)
  })

  it('defers @mem / @memory to memory picker', () => {
    expect(getActiveAgentAtQuery('hello @mem')).toBe(null)
    expect(getActiveAgentAtQuery('hello @memory')).toBe(null)
    expect(getActiveAgentAtQuery('@mem notes')).toBe(null)
  })

  it('strips active @ token', () => {
    expect(stripActiveAgentAtToken('talk to @cod')).toBe('talk to')
    expect(stripActiveAgentAtToken('@')).toBe('')
  })

  it('slugifies agent names', () => {
    expect(slugifyAgentName('Code Assistant')).toBe('code-assistant')
    expect(slugifyAgentName('  Reviewer  ')).toBe('reviewer')
  })

  it('replaces active partial with completed token in message', () => {
    expect(replaceActiveAgentAtWithToken('ask @cod', 'code-assistant')).toBe('ask @code-assistant ')
    expect(replaceActiveAgentAtWithToken('@', 'alice')).toBe('@alice ')
    expect(replaceActiveAgentAtWithToken('hey @al', 'Alice Reviewer')).toBe('hey @alice-reviewer ')
  })

  it('extracts agent slugs and skips memory reserved', () => {
    expect(extractAgentSlugsFromText('@alice use $skill with @bob and @mem:note')).toEqual(['alice', 'bob'])
    expect(extractAgentSlugsFromText('no mentions')).toEqual([])
  })

  it('matches agents by slug', () => {
    const agents = [
      { id: 'a1', name: 'Code Assistant' },
      { id: 'a2', name: 'Reviewer' },
    ]
    expect(matchAgentBySlug(agents, 'code-assistant')?.id).toBe('a1')
    expect(matchAgentBySlug(agents, 'review')?.id).toBe('a2')
    expect(matchAgentBySlug(agents, 'zzz')).toBeUndefined()
  })

  it('fuzzy scores agent names', () => {
    expect(fuzzyScoreAgent('Code Assistant', 'code')).toBeGreaterThan(0)
    expect(fuzzyScoreAgent('Code Assistant', 'zzz')).toBe(0)
  })

  it('strips a specific agent token from draft text', () => {
    expect(
      stripAgentTokenFromText('ask @deep-researcher and @alice please', {
        id: 'deep-researcher',
        name: 'Deep Researcher',
      })
    ).toBe('ask and @alice please')
    expect(
      stripAgentTokenFromText('@alice hi', { id: 'a1', name: 'Alice' })
    ).toBe('hi')
  })

  it('leaves out the @partial still being typed from settled mentions', () => {
    expect(extractSettledAgentSlugsFromText('ask @Task')).toEqual([])
    expect(extractSettledAgentSlugsFromText('@code-assistant and @Task')).toEqual(['code-assistant'])
    expect(extractSettledAgentSlugsFromText('@task-planner please')).toEqual(['task-planner'])
  })
})
