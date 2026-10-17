import { EVERYWHERE_SCOPE_ID, type Scope, type SessionMeta } from '@shared/types'
import { getEffectiveProjectId } from '@/projects/project-context'

export const ALL_FOLDER_KEY = '__all__'
export const RECENTS_DROP_ID = 'drop:recents'
export const folderDropId = (folderId: string) => `drop:folder:${folderId}`

export const RECENTS_COACHING_THRESHOLD = 8

export type DayBucket = 'today' | 'yesterday' | 'older' | 'unknown'

/** Start of local calendar day for `now`. */
export function startOfLocalDay(now = Date.now()): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function getDayBucket(timestamp: number | undefined, now = Date.now()): DayBucket {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return 'unknown'
  }
  const startToday = startOfLocalDay(now)
  const startYesterday = startToday - 24 * 60 * 60 * 1000
  if (timestamp >= startToday) {
    return 'today'
  }
  if (timestamp >= startYesterday) {
    return 'yesterday'
  }
  return 'older'
}

/** Compact rail time label; null when no timestamp. */
export function formatRailRelativeTime(timestamp: number | undefined, now = Date.now()): string | null {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return null
  }
  const diffMs = Math.max(0, now - timestamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (diffMs < minute) {
    return 'now'
  }
  if (diffMs < hour) {
    return `${Math.floor(diffMs / minute)}m`
  }
  if (diffMs < day) {
    return `${Math.floor(diffMs / hour)}h`
  }
  if (diffMs < 7 * day) {
    return `${Math.floor(diffMs / day)}d`
  }

  const date = new Date(timestamp)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(
    undefined,
    sameYear ? { month: 'short', day: 'numeric' } : { year: '2-digit', month: 'short', day: 'numeric' }
  )
}

/**
 * Reorder sessions within a subset of ids (stable positions of non-subset items).
 */
export function reorderSessionsInSubset(
  sessions: SessionMeta[],
  subsetIds: string[],
  activeId: string,
  overId: string
): SessionMeta[] {
  const subset = sessions.filter((session) => subsetIds.includes(session.id))
  const oldIndex = subset.findIndex((session) => session.id === activeId)
  const newIndex = subset.findIndex((session) => session.id === overId)

  if (oldIndex < 0 || newIndex < 0 || oldIndex === newIndex) {
    return sessions
  }

  const reorderedSubset = [...subset]
  const [moved] = reorderedSubset.splice(oldIndex, 1)
  reorderedSubset.splice(newIndex, 0, moved)
  let subsetIndex = 0

  return sessions.map((session) => (subsetIds.includes(session.id) ? reorderedSubset[subsetIndex++] : session))
}

export function parseDropTargetId(overId: string): { type: 'folder'; folderId: string } | { type: 'recents' } | null {
  if (overId === RECENTS_DROP_ID) {
    return { type: 'recents' }
  }
  if (overId.startsWith('drop:folder:')) {
    return { type: 'folder', folderId: overId.slice('drop:folder:'.length) }
  }
  return null
}

/** Group Recents sessions into day buckets in list order (headers inserted by caller). */
export function groupSessionsByDay(
  sessions: SessionMeta[],
  now = Date.now()
): Array<{ bucket: DayBucket; sessions: SessionMeta[] }> {
  const order: DayBucket[] = ['today', 'yesterday', 'older', 'unknown']
  const map = new Map<DayBucket, SessionMeta[]>()
  for (const bucket of order) {
    map.set(bucket, [])
  }
  for (const session of sessions) {
    const bucket = getDayBucket(session.updatedAt, now)
    map.get(bucket)?.push(session)
  }
  return order
    .map((bucket) => ({ bucket, sessions: map.get(bucket) || [] }))
    .filter((group) => group.sessions.length > 0)
}

/** Group sessions by effective scope id. Unknown ids and Everywhere go to `unscoped`; groups keep scope order. */
export function groupSessionsByScope(
  scopes: Scope[],
  sessions: SessionMeta[]
): { groups: Array<{ scope: Scope; sessions: SessionMeta[] }>; unscoped: SessionMeta[] } {
  const groups = scopes.map((scope) => ({ scope, sessions: [] as SessionMeta[] }))
  const byId = new Map(groups.map((group) => [group.scope.id, group]))
  const unscoped: SessionMeta[] = []
  for (const session of sessions) {
    const id = getEffectiveProjectId(session)
    const group = id && id !== EVERYWHERE_SCOPE_ID ? byId.get(id) : undefined
    if (group) {
      group.sessions.push(session)
    } else {
      unscoped.push(session)
    }
  }
  return { groups, unscoped }
}
