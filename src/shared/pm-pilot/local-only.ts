import type { Evidence, SourceRecord } from './types'

/*
 * The one local-only rule for a cloud model (ADR 0003), shared by retrieval, the judge call and later steps.
 * - An inbound record reaches a cloud model only when it names its source and that source is not local-only: a record
 *   without a source id could be from a local-only mailbox, so it fails closed.
 * - Record evidence (`r:`) follows the same rule.
 * - Knowledge evidence (`k:`) is dropped when ANY of its non-removed sources is local-only. Knowledge with no source id
 *   (the user typed it) is the user's own text and may go.
 * On a local model everything may go; callers apply these only when the model is cloud.
 */

export function inboundMayReachCloud(record: Pick<SourceRecord, 'sourceId'>, localOnly: ReadonlySet<string>): boolean {
  return !!record.sourceId && !localOnly.has(record.sourceId)
}

function evidenceSourceIds(e: Evidence): string[] {
  if (e.sourceIds) return e.sourceIds
  return e.source.sourceId ? [e.source.sourceId] : []
}

export function mayReachCloud(e: Evidence, localOnly: ReadonlySet<string>): boolean {
  const ids = evidenceSourceIds(e).filter((id) => id !== '')
  if (!e.id.startsWith('k:') && ids.length === 0) return false
  return !ids.some((id) => localOnly.has(id))
}
