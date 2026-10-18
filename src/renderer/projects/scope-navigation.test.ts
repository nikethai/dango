import type { Scope } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { newChatScopeId, resolveDraftScopeId, scopeIdFromPath } from './scope-navigation'

const scopes: Scope[] = [
  { id: 'a', name: 'Acme Co', kind: 'client', order: 0 },
  { id: 'd', name: 'Dango app', kind: 'project', order: 1 },
]

describe('scopeIdFromPath', () => {
  it('reads the scope id from a scope page path', () => {
    expect(scopeIdFromPath('/scope/abc')).toBe('abc')
  })

  it('returns undefined for Everywhere and non-scope paths', () => {
    expect(scopeIdFromPath('/scope/everywhere')).toBeUndefined()
    expect(scopeIdFromPath('/session/x')).toBeUndefined()
    expect(scopeIdFromPath('/new')).toBeUndefined()
  })
})

describe('newChatScopeId (⌘N)', () => {
  it('on Review, follows the scope filter in the search (M6)', () => {
    expect(newChatScopeId('/', { scope: 'abc' })).toBe('abc')
    expect(newChatScopeId('/', { scope: 'everywhere' })).toBeUndefined()
    expect(newChatScopeId('/', {})).toBeUndefined()
    expect(newChatScopeId('/', { scope: 5 })).toBeUndefined()
  })

  it('elsewhere, reads the path as before', () => {
    expect(newChatScopeId('/scope/abc', { scope: 'other' })).toBe('abc')
    expect(newChatScopeId('/session/x', { scope: 'abc' })).toBeUndefined()
  })
})

describe('resolveDraftScopeId', () => {
  it('drops an unknown scope id', () => {
    expect(resolveDraftScopeId('gone', scopes)).toBeUndefined()
    expect(resolveDraftScopeId('everywhere', scopes)).toBeUndefined()
    expect(resolveDraftScopeId(undefined, scopes)).toBeUndefined()
  })

  it('keeps a stored scope id', () => {
    expect(resolveDraftScopeId('d', scopes)).toBe('d')
  })

  it('drops Everywhere even if a stored entry carries its id', () => {
    expect(
      resolveDraftScopeId('everywhere', [...scopes, { id: 'everywhere', name: 'x', kind: 'project', order: 2 }])
    ).toBeUndefined()
  })
})
