import type { Scope, SessionMeta } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateSession = vi.fn(async (..._args: unknown[]) => undefined)
const pushUndo = vi.fn((_input: { message: string; undo: () => void | Promise<void> }) => 'u1')
vi.mock('@/stores/chatStore', () => ({ updateSession: (...args: unknown[]) => updateSession(...args) }))
vi.mock('@/packages/undo', () => ({ pushUndo: (input: never) => pushUndo(input) }))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? '')),
}))

import { deleteScopeWithUndo } from './scope-delete'

const scope: Scope = {
  id: 'a',
  name: 'Acme Co',
  kind: 'client',
  readsEverywhere: { facts: true, documents: true },
} as Scope
const sessions = [
  { id: 's1', projectId: 'a', folderId: 'a' },
  { id: 's2', folderId: 'a' },
  { id: 's3', projectId: 'b', folderId: 'b' },
] as SessionMeta[]

beforeEach(() => {
  updateSession.mockClear()
  pushUndo.mockClear()
})

describe('deleteScopeWithUndo', () => {
  it('unassigns its chats, removes the scope and offers undo', async () => {
    const removeScope = vi.fn()
    const putScope = vi.fn()
    await deleteScopeWithUndo(scope, sessions, { removeScope, putScope })
    expect(updateSession).toHaveBeenCalledTimes(2)
    expect(updateSession).toHaveBeenCalledWith('s1', { projectId: undefined, folderId: undefined })
    expect(updateSession).toHaveBeenCalledWith('s2', { projectId: undefined, folderId: undefined })
    expect(removeScope).toHaveBeenCalledWith('a')
    const lastMove = Math.max(...updateSession.mock.invocationCallOrder)
    expect(removeScope.mock.invocationCallOrder[0]).toBeGreaterThan(lastMove)
    expect(pushUndo).toHaveBeenCalledTimes(1)
    expect(pushUndo.mock.calls[0][0].message).toBe('Deleted Acme Co')
    expect(putScope).not.toHaveBeenCalled()
  })

  it('undo puts the scope back and moves exactly those chats back', async () => {
    const removeScope = vi.fn()
    const putScope = vi.fn()
    await deleteScopeWithUndo(scope, sessions, { removeScope, putScope })
    updateSession.mockClear()
    await pushUndo.mock.calls[0][0].undo()
    expect(putScope).toHaveBeenCalledWith(scope)
    expect(updateSession).toHaveBeenCalledTimes(2)
    expect(updateSession).toHaveBeenCalledWith('s1', { projectId: 'a', folderId: 'a' })
    expect(updateSession).toHaveBeenCalledWith('s2', { projectId: 'a', folderId: 'a' })
  })
})
