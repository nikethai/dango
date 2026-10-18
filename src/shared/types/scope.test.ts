import { describe, expect, it } from 'vitest'
import { EVERYWHERE_SCOPE_ID, everywhereDefaults, isEverywhere, ScopeSchema, readsEverywhereFor } from './scope'

describe('scope', () => {
  it('old project payloads parse as project scopes', () => {
    const s = ScopeSchema.parse({ id: 'a', name: 'Alpha', order: 0, defaultAgentId: 'ag', emoji: '🙂' })
    expect(s.kind).toBe('project')
    expect(s.readsEverywhere).toBeUndefined()
    expect(s.defaultAgentId).toBe('ag')
    expect(s.emoji).toBe('🙂')
  })

  it('everywhereDefaults', () => {
    expect(everywhereDefaults('project')).toEqual({ facts: true, documents: true })
    expect(everywhereDefaults('client')).toEqual({ facts: true, documents: false })
  })

  it('readsEverywhereFor', () => {
    expect(readsEverywhereFor({ kind: 'client' })).toEqual({ facts: true, documents: false })
    expect(readsEverywhereFor({ kind: 'client', readsEverywhere: { facts: false, documents: true } })).toEqual({
      facts: false,
      documents: true,
    })
  })

  it('isEverywhere', () => {
    expect(EVERYWHERE_SCOPE_ID).toBe('everywhere')
    expect(isEverywhere('everywhere')).toBe(true)
    expect(isEverywhere(undefined)).toBe(false)
    expect(isEverywhere('Everywhere')).toBe(false)
  })
})
