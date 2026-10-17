import type { SessionMeta } from '@shared/types'
import { describe, expect, it } from 'vitest'
import {
  formatRailRelativeTime,
  groupSessionsByScope,
  getDayBucket,
  groupSessionsByDay,
  parseDropTargetId,
  reorderSessionsInSubset,
  RECENTS_DROP_ID,
  folderDropId,
} from './session-list-helpers'

function meta(id: string, updatedAt?: number): SessionMeta {
  return { id, name: id, updatedAt }
}

describe('session-list-helpers', () => {
  describe('getDayBucket', () => {
    const now = new Date('2026-08-06T15:00:00').getTime()

    it('classifies today / yesterday / older', () => {
      expect(getDayBucket(new Date('2026-08-06T08:00:00').getTime(), now)).toBe('today')
      expect(getDayBucket(new Date('2026-08-05T20:00:00').getTime(), now)).toBe('yesterday')
      expect(getDayBucket(new Date('2026-08-01T12:00:00').getTime(), now)).toBe('older')
      expect(getDayBucket(undefined, now)).toBe('unknown')
    })
  })

  describe('formatRailRelativeTime', () => {
    const now = new Date('2026-08-06T15:00:00').getTime()

    it('returns compact relative labels', () => {
      expect(formatRailRelativeTime(now - 30_000, now)).toBe('now')
      expect(formatRailRelativeTime(now - 5 * 60_000, now)).toBe('5m')
      expect(formatRailRelativeTime(now - 3 * 60 * 60_000, now)).toBe('3h')
      expect(formatRailRelativeTime(now - 2 * 24 * 60 * 60_000, now)).toBe('2d')
      expect(formatRailRelativeTime(undefined, now)).toBeNull()
    })
  })

  describe('reorderSessionsInSubset', () => {
    it('reorders only the subset', () => {
      const sessions = [meta('a'), meta('b'), meta('c'), meta('d')]
      const next = reorderSessionsInSubset(sessions, ['b', 'c', 'd'], 'd', 'b')
      expect(next.map((s) => s.id)).toEqual(['a', 'd', 'b', 'c'])
    })

    it('no-ops when indices invalid', () => {
      const sessions = [meta('a'), meta('b')]
      expect(reorderSessionsInSubset(sessions, ['a', 'b'], 'a', 'a')).toBe(sessions)
      expect(reorderSessionsInSubset(sessions, ['a'], 'a', 'b')).toBe(sessions)
    })
  })

  describe('parseDropTargetId', () => {
    it('parses recents and folder drop targets', () => {
      expect(parseDropTargetId(RECENTS_DROP_ID)).toEqual({ type: 'recents' })
      expect(parseDropTargetId(folderDropId('proj-1'))).toEqual({ type: 'folder', folderId: 'proj-1' })
      expect(parseDropTargetId('session-id')).toBeNull()
    })
  })

  describe('groupSessionsByDay', () => {
    it('groups in bucket order', () => {
      const now = new Date('2026-08-06T15:00:00').getTime()
      const groups = groupSessionsByDay(
        [
          meta('old', new Date('2026-07-01').getTime()),
          meta('today', new Date('2026-08-06T10:00:00').getTime()),
          meta('y', new Date('2026-08-05T10:00:00').getTime()),
        ],
        now
      )
      expect(groups.map((g) => g.bucket)).toEqual(['today', 'yesterday', 'older'])
      expect(groups[0].sessions.map((s) => s.id)).toEqual(['today'])
    })
  })
})

describe('groupSessionsByScope', () => {
  const scopes = [
    { id: 'a', name: 'A', order: 0, kind: 'project' as const },
    { id: 'b', name: 'B', order: 1, kind: 'project' as const },
  ]
  const s = (id: string, extra: Record<string, unknown> = {}) => ({ id, name: id, ...extra }) as never

  it('groups by effective project id, keeps scope order, sends unknown and everywhere to unscoped', () => {
    const { groups, unscoped } = groupSessionsByScope(scopes, [
      s('1', { projectId: 'a', folderId: 'b' }),
      s('2', { folderId: 'b' }),
      s('3', { projectId: 'gone' }),
      s('4', { projectId: 'everywhere' }),
      s('5'),
    ])
    expect(groups.map((g) => [g.scope.id, g.sessions.map((x) => x.id)])).toEqual([
      ['a', ['1']],
      ['b', ['2']],
    ])
    expect(unscoped.map((x) => x.id)).toEqual(['3', '4', '5'])
  })
})
