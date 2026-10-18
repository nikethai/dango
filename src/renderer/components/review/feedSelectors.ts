import type { ReviewEntry, ReviewKind } from '@shared/types/review'
import { isEverywhere } from '@shared/types/scope'

export type DayGroup = { label: 'Today' | 'Yesterday' | 'Earlier'; entries: ReviewEntry[] }

/** Open and done rows (not dismissed), in the given scope when one is given, newest first. */
export function visibleEntries(entries: ReviewEntry[], scopeId?: string): ReviewEntry[] {
  return entries
    .filter((e) => e.state !== 'dismissed')
    .filter((e) => scopeId === undefined || (isEverywhere(scopeId) ? isEverywhere(e.scopeId) : e.scopeId === scopeId))
    .sort((a, b) => b.createdAt - a.createdAt)
}

function startOfDay(at: number): number {
  const d = new Date(at)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

function startOfYesterday(now: number): number {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - 1)
  return d.getTime()
}

/** Today / Yesterday / Earlier by local midnight; empty groups are left out; input order is kept within a group. */
export function groupByDay(entries: ReviewEntry[], now: number): DayGroup[] {
  const todayStart = startOfDay(now)
  const yesterdayStart = startOfYesterday(now)
  const groups: DayGroup[] = [
    { label: 'Today', entries: [] },
    { label: 'Yesterday', entries: [] },
    { label: 'Earlier', entries: [] },
  ]
  for (const e of entries) {
    if (e.createdAt >= todayStart) groups[0].entries.push(e)
    else if (e.createdAt >= yesterdayStart) groups[1].entries.push(e)
    else groups[2].entries.push(e)
  }
  return groups.filter((g) => g.entries.length > 0)
}

/** A resolved row shows as Done whatever its original kind. */
export function displayKind(e: ReviewEntry): ReviewKind {
  return e.state === 'done' ? 'done' : e.kind
}

/**
 * Pure and English-only: callers that translate pass the result through `t()` or add the keys themselves.
 * `Last checked ${hm}` today, `Last checked yesterday at ${hm}` yesterday, `Last checked ${dayMonth}` before.
 */
export function formatLastChecked(at: number, now: number): string {
  const hm = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(at)
  if (at >= startOfDay(now)) return `Last checked ${hm}`
  if (at >= startOfYesterday(now)) return `Last checked yesterday at ${hm}`
  const dayMonth = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(at)
  return `Last checked ${dayMonth}`
}

/** `sourceCount > 0` when known (slice 7); until then any entry or a last-checked time counts as a source. */
export function hasSources(o: { sourceCount?: number; entries: ReviewEntry[]; lastCheckedAt?: number }): boolean {
  if (o.sourceCount !== undefined) return o.sourceCount > 0
  return o.entries.length > 0 || o.lastCheckedAt !== undefined
}

/** After the focused row leaves: the nearest surviving row below, else above, else null (the RV5 block). */
export function nextFocusAfterRemoval(prevIds: string[], nextIds: string[], focusedId: string): string | null {
  const index = prevIds.indexOf(focusedId)
  if (index === -1) return null
  const alive = new Set(nextIds)
  for (let i = index + 1; i < prevIds.length; i++) if (alive.has(prevIds[i])) return prevIds[i]
  for (let i = index - 1; i >= 0; i--) if (alive.has(prevIds[i])) return prevIds[i]
  return null
}

/** Quoted text for toasts: 60 characters, then `…` when cut. */
export function clip(text: string, max = 60): string {
  const chars = Array.from(text)
  return chars.length <= max ? text : `${chars.slice(0, max).join('')}…`
}
