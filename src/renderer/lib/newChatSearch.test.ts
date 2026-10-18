import { toSessionAgentFieldsFromSelection } from '@shared/new-chat-agents'
import type { Session } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  applyDraftScope,
  isNewPrefill,
  NewChatSearchSchema,
  seedDraftFromLink,
  seedNewChatSession,
} from './newChatSearch'

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

describe('seedDraftFromLink', () => {
  const acme = { id: 'acme', defaultAgentId: undefined }
  const search = { scopeId: 'acme' }

  it('seeds the draft the first time a link is seen', () => {
    expect(seedDraftFromLink(base, { search, scopeId: 'acme', scope: acme }, {}).projectId).toBe('acme')
  })

  it('applies a late scope load when the draft still holds the earlier resolution', () => {
    // Scopes not loaded yet: the link resolved to no scope, and the draft has none.
    const first = seedDraftFromLink(base, { search, scopeId: undefined, scope: undefined }, {})
    expect(first.projectId).toBeUndefined()
    const late = seedDraftFromLink(first, { search, scopeId: 'acme', scope: acme }, { search, scopeId: undefined })
    expect(late.projectId).toBe('acme')
  })

  it('a re-resolve of the same link does not overwrite a pill choice', () => {
    const seeded = seedDraftFromLink(base, { search, scopeId: 'acme', scope: acme }, {})
    const picked = { ...seeded, projectId: 'other' } as Session
    // The link's scope was deleted while /new is open: it now resolves to no scope.
    expect(
      seedDraftFromLink(picked, { search, scopeId: undefined, scope: undefined }, { search, scopeId: 'acme' })
    ).toBe(picked)
    // A late load resolving the link differently also leaves the pill alone.
    const unscopedPick = { ...base, projectId: 'other' } as Session
    expect(
      seedDraftFromLink(unscopedPick, { search, scopeId: 'acme', scope: acme }, { search, scopeId: undefined })
    ).toBe(unscopedPick)
  })

  it('a deleted link scope clears the draft when the user had not changed it', () => {
    const seeded = seedDraftFromLink(base, { search, scopeId: 'acme', scope: acme }, {})
    const next = seedDraftFromLink(
      seeded,
      { search, scopeId: undefined, scope: undefined },
      { search, scopeId: 'acme' }
    )
    expect(next.projectId).toBeUndefined()
  })

  it('a new link seeds again even after a pill choice', () => {
    const picked = { ...base, projectId: 'other' } as Session
    const nextSearch = { scopeId: 'acme' }
    expect(
      seedDraftFromLink(picked, { search: nextSearch, scopeId: 'acme', scope: acme }, { search, scopeId: 'acme' })
        .projectId
    ).toBe('acme')
  })

  it('the same link resolving the same way changes nothing', () => {
    const picked = { ...base, projectId: 'other' } as Session
    expect(seedDraftFromLink(picked, { search, scopeId: 'acme', scope: acme }, { search, scopeId: 'acme' })).toBe(
      picked
    )
  })
})
