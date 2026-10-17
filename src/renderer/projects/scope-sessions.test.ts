import type { SessionMeta } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateSession = vi.fn(async () => undefined)
vi.mock('@/stores/chatStore', () => ({ updateSession: (...args: unknown[]) => updateSession(...(args as [])) }))

import { moveSessionToScope, unassignScopeSessions } from './scope-sessions'

const meta = (id: string, extra: Partial<SessionMeta> = {}) => ({ id, name: id, ...extra }) as SessionMeta

describe('moveSessionToScope', () => {
  beforeEach(() => updateSession.mockClear())

  it('writes projectId and folderId together', async () => {
    expect(await moveSessionToScope('s1', 'b')).toBe(true)
    expect(updateSession).toHaveBeenCalledWith('s1', { projectId: 'b', folderId: 'b' })
    await moveSessionToScope('s1', undefined)
    expect(updateSession).toHaveBeenLastCalledWith('s1', { projectId: undefined, folderId: undefined })
  })

  it('refuses Everywhere', async () => {
    expect(await moveSessionToScope('s1', 'everywhere')).toBe(false)
    expect(updateSession).not.toHaveBeenCalled()
  })
})

describe('unassignScopeSessions', () => {
  beforeEach(() => updateSession.mockClear())

  it('moves only sessions whose effective id is the scope, including legacy folderId', async () => {
    const count = await unassignScopeSessions('a', [
      meta('1', { projectId: 'a', folderId: 'a' }),
      meta('2', { folderId: 'a' }),
      meta('3', { projectId: 'b', folderId: 'a' }),
      meta('4', { projectId: 'b' }),
    ])
    expect(count).toBe(2)
    expect(updateSession).toHaveBeenCalledTimes(2)
    expect(updateSession).toHaveBeenCalledWith('1', { projectId: undefined, folderId: undefined })
    expect(updateSession).toHaveBeenCalledWith('2', { projectId: undefined, folderId: undefined })
  })
})
