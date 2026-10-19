import type { CodexThreadSummary, CodexThreadsDetection, SourceItem } from '@shared/types/sources'
import { useEffect, useState } from 'react'
import i18n from '@/i18n'
import platform, { platformCapabilities } from '@/platform'
import type { SourceKindDefinition } from '../kinds'
import { throwIfAborted, UNAVAILABLE_HINT } from './common'

/** The broker lists at most this many threads (newest first); a full list may hide older ones. */
export const CODEX_LIST_LIMIT = 200
/** Threads read per `read` run. */
export const CODEX_READ_BATCH = 40

const available = () => platformCapabilities.supportsCodexThreads && !!platform.detectCodexThreads

let detection: Promise<CodexThreadsDetection | null> | null = null

/** Counts local Codex threads without reading any (once per window). Null where Codex threads are unavailable. */
export function getCodexDetection(): Promise<CodexThreadsDetection | null> {
  if (!detection) {
    detection = available()
      ? (platform.detectCodexThreads?.() ?? Promise.resolve(null)).catch((error) => {
          console.warn('[sources] Could not look for Codex threads', error)
          detection = null
          return null
        })
      : Promise.resolve(null)
  }
  return detection
}

/** The detection, or null until it is known (and where Codex threads are unavailable). */
export function useCodexDetection(): CodexThreadsDetection | null {
  const [value, setValue] = useState<CodexThreadsDetection | null>(null)
  useEffect(() => {
    let live = true
    void getCodexDetection().then((d) => {
      if (live) setValue(d)
    })
    return () => {
      live = false
    }
  }, [])
  return value
}

/** The Codex threads row's hint, translated. The row is disabled when nothing was found. */
export function codexThreadsHint(found: CodexThreadsDetection | null): string {
  if (!found?.found || found.threadCount === 0) return i18n.t('No Codex threads on this computer.')
  // displayPath is external text, passed as a plain value.
  return i18n.t('Found {{count}} threads in {{displayPath}}. Dango reads them only after you connect.', {
    count: found.threadCount,
    displayPath: found.displayPath,
  })
}

export function _resetCodexDetectionForTests(): void {
  detection = null
}

/**
 * Read cursor. Plain: the `updatedAt` (ms, as a string) every thread up to which has been read. While the broker's
 * list is full, older unread threads may be hidden, so `since` must not move: the threads read above it are kept in
 * `read` (id → updatedAt) and stored as JSON `{ since, read }`.
 */
type CodexCursor = { since: number | null; read: Map<string, number> }

function parseCursor(cursor: string | null): CodexCursor {
  const empty: CodexCursor = { since: null, read: new Map() }
  if (!cursor) return empty
  if (/^\d+$/.test(cursor)) return { since: Number(cursor), read: new Map() }
  try {
    const raw = JSON.parse(cursor) as { since?: unknown; read?: unknown }
    const since = typeof raw.since === 'number' && Number.isFinite(raw.since) ? raw.since : null
    const read = new Map<string, number>()
    if (raw.read && typeof raw.read === 'object') {
      for (const [id, at] of Object.entries(raw.read)) if (typeof at === 'number') read.set(id, at)
    }
    return { since, read }
  } catch {
    return empty
  }
}

function serializeCursor({ since, read }: CodexCursor): string | null {
  if (read.size === 0) return since === null ? null : String(since)
  return JSON.stringify({ since, read: Object.fromEntries(read) })
}

const oldestFirst = (a: CodexThreadSummary, b: CodexThreadSummary) =>
  a.updatedAt - b.updatedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

async function readThreads(ctx: {
  signal: AbortSignal
  cursor: string | null
}): Promise<{ items: SourceItem[]; cursor: string | null }> {
  const list = platform.listCodexThreads
  const readThread = platform.readCodexThread
  if (!list || !readThread) throw new Error(i18n.t(UNAVAILABLE_HINT))
  const cursor = parseCursor(ctx.cursor)
  const listed = await list.call(platform, cursor.since ?? undefined)
  const full = listed.length >= CODEX_LIST_LIMIT
  const visible = [...listed].sort(oldestFirst)
  const isRead = (t: CodexThreadSummary, read: Map<string, number>) => read.get(t.id) === t.updatedAt
  const batch = visible.filter((t) => !isRead(t, cursor.read)).slice(0, CODEX_READ_BATCH)

  const items: SourceItem[] = []
  // Only threads still listed stay in `read`; an updated thread (new updatedAt) is read again.
  const read = new Map(visible.filter((t) => isRead(t, cursor.read)).map((t) => [t.id, t.updatedAt]))
  for (const summary of batch) {
    throwIfAborted(ctx.signal)
    try {
      const thread = await readThread.call(platform, summary.id)
      items.push({
        ref: summary.id,
        // Thread titles are external text; an empty one gets a fallback.
        label: summary.title.trim() || i18n.t('Untitled thread'),
        text: thread.text,
        updatedAt: summary.updatedAt,
      })
    } catch (error) {
      // Deleted between list and read: nothing to read.
      if (!(error instanceof Error && /not found/i.test(error.message))) throw error
    }
    read.set(summary.id, summary.updatedAt)
  }

  if (full) return { items, cursor: serializeCursor({ since: cursor.since, read }) }

  // The whole range after `since` was listed: move `since` up to just below the oldest unread thread.
  const firstUnread = visible.find((t) => !isRead(t, read))
  let since = cursor.since
  for (const t of visible) {
    if (firstUnread && t.updatedAt >= firstUnread.updatedAt) break
    if (since === null || t.updatedAt > since) since = t.updatedAt
  }
  const above = new Map([...read].filter(([, at]) => since === null || at > since))
  return { items, cursor: serializeCursor({ since, read: above }) }
}

export const codexThreadsKind: SourceKindDefinition = {
  kind: 'codex-threads',
  name: 'Codex threads',
  // Shown until the detection is known; the sheet uses `codexThreadsHint(useCodexDetection())`.
  hint: 'No Codex threads on this computer.',
  supportsBackgroundReview: true,
  isAvailable: available,
  unavailableHint: UNAVAILABLE_HINT,

  // Connecting reads nothing: the draft only names the kind.
  pick({ signal }) {
    if (signal.aborted) return Promise.resolve(null)
    return Promise.resolve({ kind: 'codex-threads', label: i18n.t('Codex threads'), config: {} })
  },

  async sync() {
    const found = await platform.detectCodexThreads?.()
    const count = found?.found ? found.threadCount : 0
    return { summary: i18n.t('Found {{count}} Codex threads', { count }) }
  },

  read: (_source, ctx) => readThreads(ctx),
}
