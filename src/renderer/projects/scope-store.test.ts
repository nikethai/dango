import { type Scope, readsEverywhereFor } from '@shared/types'
import { describe, expect, it } from 'vitest'
import { applyFolderUpdate, createScope, parseScopes, patchScope, validateScopeName } from './scope-store'

const client: Scope = {
  id: 'c',
  name: 'Client',
  order: 2,
  kind: 'client',
  readsEverywhere: { facts: false, documents: true },
}

describe('scope-store', () => {
  it('parseScopes defaults kind and drops a stored Everywhere', () => {
    const scopes = parseScopes([
      { id: 'b', name: 'Beta', order: 1 },
      { id: 'everywhere', name: 'X', order: 0 },
      null,
      { id: 'a', name: 'Alpha', order: 0, kind: 'client' },
    ])
    expect(scopes.map((s) => s.id)).toEqual(['a', 'b'])
    expect(scopes.map((s) => s.kind)).toEqual(['client', 'project'])
  })

  it('parseScopes tolerates non-arrays', () => {
    expect(parseScopes(undefined)).toEqual([])
    expect(parseScopes({})).toEqual([])
  })

  it('kind change resets readsEverywhere', () => {
    const project: Scope = {
      id: 'p',
      name: 'P',
      order: 0,
      kind: 'project',
      readsEverywhere: { facts: true, documents: true },
    }
    const changed = patchScope([project], 'p', { kind: 'client' })[0]
    expect(changed.readsEverywhere).toBeUndefined()
    expect(readsEverywhereFor(changed).documents).toBe(false)
    const renamed = patchScope([project], 'p', { name: 'New' })[0]
    expect(renamed.readsEverywhere).toEqual({ facts: true, documents: true })
  })

  it('folder updates keep kind and readsEverywhere', () => {
    for (const next of [
      applyFolderUpdate(client, { name: 'Acme' }),
      applyFolderUpdate(client, (f) => ({ ...f, order: 5 })),
    ]) {
      expect(next.kind).toBe('client')
      expect(next.readsEverywhere).toEqual({ facts: false, documents: true })
    }
    expect(applyFolderUpdate(client, { name: 'Acme' }).name).toBe('Acme')
  })

  it('validateScopeName', () => {
    expect(validateScopeName('  ')).toBe('empty')
    expect(validateScopeName('Everywhere')).toBe('reserved')
    expect(validateScopeName(' everywhere ')).toBe('reserved')
    expect(validateScopeName('Acme Co')).toBeNull()
  })

  it('createScope puts the new scope after the highest order', () => {
    const created = createScope([client, { ...client, id: 'd', order: 7 }], { name: 'N', kind: 'project' })
    expect(created.order).toBe(8)
    expect(created.kind).toBe('project')
    expect(createScope([], { name: 'N', kind: 'client', id: 'x' })).toMatchObject({ id: 'x', order: 0 })
  })
})
