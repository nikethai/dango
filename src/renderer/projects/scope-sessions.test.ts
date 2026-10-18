import type { SessionMeta } from '@shared/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const updateSession = vi.fn(async () => undefined)
vi.mock('@/stores/chatStore', () => ({ updateSession: (...args: unknown[]) => updateSession(...(args as [])) }))
const moveProposalsForSession = vi.fn(async (..._args: unknown[]) => 0)
vi.mock('@/packages/knowledge/proposals', () => ({
  moveProposalsForSession: (...args: unknown[]) => moveProposalsForSession(...args),
}))

const logError = vi.fn()
vi.mock('@/lib/utils', () => ({ getLogger: () => ({ error: (...args: unknown[]) => logError(...args) }) }))

import { moveSessionToScope, unassignScopeSessions } from './scope-sessions'

const meta = (id: string, extra: Partial<SessionMeta> = {}) => ({ id, name: id, ...extra }) as SessionMeta

describe('moveSessionToScope', () => {
  beforeEach(() => {
    updateSession.mockClear()
    moveProposalsForSession.mockClear()
  })

  it("moves the chat's knowledge proposals after the session write", async () => {
    await moveSessionToScope('s1', 'b')
    expect(moveProposalsForSession).toHaveBeenCalledWith('s1', 'b')
    expect(updateSession.mock.invocationCallOrder[0]).toBeLessThan(moveProposalsForSession.mock.invocationCallOrder[0])
    await moveSessionToScope('s1', undefined)
    expect(moveProposalsForSession).toHaveBeenLastCalledWith('s1', 'everywhere')
  })

  it('a failed proposal move is logged and the chat still counts as moved', async () => {
    moveProposalsForSession.mockRejectedValueOnce(new Error('locked'))
    expect(await moveSessionToScope('s1', 'b')).toBe(true)
    expect(updateSession).toHaveBeenCalledWith('s1', { projectId: 'b', folderId: 'b' })
    expect(logError).toHaveBeenCalledWith('Moving knowledge proposals failed:', expect.any(Error))
  })

  it('a failed session write moves no proposals', async () => {
    updateSession.mockRejectedValueOnce(new Error('disk full'))
    await expect(moveSessionToScope('s1', 'b')).rejects.toThrow('disk full')
    expect(moveProposalsForSession).not.toHaveBeenCalled()
  })

  it('writes projectId and folderId together', async () => {
    expect(await moveSessionToScope('s1', 'b')).toBe(true)
    expect(updateSession).toHaveBeenCalledWith('s1', { projectId: 'b', folderId: 'b' })
    await moveSessionToScope('s1', undefined)
    expect(updateSession).toHaveBeenLastCalledWith('s1', { projectId: undefined, folderId: undefined })
  })

  it('refuses Everywhere', async () => {
    expect(await moveSessionToScope('s1', 'everywhere')).toBe(false)
    expect(updateSession).not.toHaveBeenCalled()
    expect(moveProposalsForSession).not.toHaveBeenCalled()
  })
})

describe('unassignScopeSessions', () => {
  beforeEach(() => {
    updateSession.mockClear()
    moveProposalsForSession.mockClear()
  })

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
    expect(moveProposalsForSession).toHaveBeenCalledWith('2', 'everywhere')
  })
})
