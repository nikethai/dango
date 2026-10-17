import { toSessionAgentFieldsFromSelection } from '@shared/new-chat-agents'
import type { Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { applyDraftScope, isNewPrefill, NewChatSearchSchema, seedNewChatSession } from './newChatSearch'

const base = { id: 'new', name: 'Untitled', type: 'chat', messages: [] } as unknown as Session

describe('seedNewChatSession', () => {
  it('maps scopeId to projectId', () => {
    expect(seedNewChatSession(base, { scopeId: 'p1' }).projectId).toBe('p1')
  })

  it('leaves projectId unset for everywhere and for no scope', () => {
    expect(seedNewChatSession(base, { scopeId: 'everywhere' }).projectId).toBeUndefined()
    expect(seedNewChatSession(base, { scopeId: '' }).projectId).toBeUndefined()
    expect(seedNewChatSession(base, {}).projectId).toBeUndefined()
  })

  it('sets agent fields from copilotId', () => {
    const s = seedNewChatSession(base, { copilotId: 'c1' })
    expect(s.copilotId).toBe('c1')
    expect(s).toMatchObject(toSessionAgentFieldsFromSelection(['c1']))
  })

  it('never clears what the user already picked', () => {
    const s = { ...base, copilotId: 'c9', projectId: 'p9' } as Session
    expect(seedNewChatSession(s, {})).toEqual(s)
  })
})

describe('applyDraftScope', () => {
  const scope = { id: 'd', defaultAgentId: 'agent-d' }

  it('puts the draft in the scope and preselects its default agent when no agent was chosen', () => {
    const s = applyDraftScope(base, scope, { agentInSearch: false })
    expect(s.projectId).toBe('d')
    expect(s).toMatchObject(toSessionAgentFieldsFromSelection(['agent-d']))
  })

  it('keeps an agent already on the draft or named in the link', () => {
    const picked = { ...base, ...toSessionAgentFieldsFromSelection(['mine']) } as Session
    expect(applyDraftScope(picked, scope, { agentInSearch: false })).toMatchObject({
      projectId: 'd',
      copilotId: 'mine',
    })
    expect(applyDraftScope(base, scope, { agentInSearch: true }).copilotId).toBeUndefined()
  })

  it('clears the scope when there is none', () => {
    const scoped = { ...base, projectId: 'd' } as Session
    expect(applyDraftScope(scoped, undefined, { agentInSearch: false }).projectId).toBeUndefined()
  })
})

describe('NewChatSearchSchema', () => {
  it('keeps prefill and drops unknown keys', () => {
    expect(NewChatSearchSchema.parse({ prefill: 'x', other: 1 })).toEqual({ prefill: 'x' })
  })
})

describe('isNewPrefill', () => {
  it('a prefill that arrives while /new is open replaces the composer draft', () => {
    expect(isNewPrefill(undefined, 'Summarise the launch notes')).toBe(true)
    expect(isNewPrefill('first draft', 'second draft')).toBe(true)
  })

  it('the same prefill, or none, leaves what the user typed alone', () => {
    expect(isNewPrefill('same', 'same')).toBe(false)
    expect(isNewPrefill('typed over', undefined)).toBe(false)
    expect(isNewPrefill(undefined, undefined)).toBe(false)
    expect(isNewPrefill(undefined, '')).toBe(false)
  })
})
