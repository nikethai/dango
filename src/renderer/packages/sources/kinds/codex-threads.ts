import type { CodexThreadsDetection, SourceItem } from '@shared/types/sources'
import { useEffect, useState } from 'react'
import i18n from '@/i18n'
import platform, { platformCapabilities } from '@/platform'
import type { SourceKindDefinition } from '../kinds'
import { throwIfAborted, UNAVAILABLE_HINT } from './common'

/** Threads read per `read` run (the broker lists this many per page). */
export const CODEX_READ_BATCH = 40

const available = () => platformCapabilities.supportsCodexThreads && !!platform.detectCodexThreads

let detection: Promise<CodexThreadsDetection | null> | null = null

/**
 * Counts local Codex threads without reading any. Null where Codex threads are unavailable. Only a detection that
 * found threads is kept for the window's lifetime: after "none found" the next call looks again, so Codex run for the
 * first time while Dango is open shows up without a restart.
 */
export function getCodexDetection(): Promise<CodexThreadsDetection | null> {
  if (!detection) {
    const lookup: Promise<CodexThreadsDetection | null> = available()
      ? (platform.detectCodexThreads?.() ?? Promise.resolve(null)).then(
          (found) => {
            if (!codexThreadsFound(found) && detection === lookup) detection = null
            return found
          },
          (error) => {
            console.warn('[sources] Could not look for Codex threads', error)
            if (detection === lookup) detection = null
            return null
          }
        )
      : Promise.resolve(null)
    detection = lookup
  }
  return detection
}

/**
 * The detection: `undefined` while it is still being looked up, `null` where Codex threads are unavailable (or the
 * lookup failed). The sheet tells "still looking" apart from "nothing found" with this.
 */
export function useCodexDetection(): CodexThreadsDetection | null | undefined {
  const [value, setValue] = useState<CodexThreadsDetection | null | undefined>(undefined)
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

/** Whether the detection found threads to connect (false while still looking). */
export function codexThreadsFound(found: CodexThreadsDetection | null | undefined): boolean {
  return !!found?.found && found.threadCount > 0
}

/** The Codex threads row's hint, translated. The row is disabled unless `codexThreadsFound`. */
export function codexThreadsHint(found: CodexThreadsDetection | null | undefined): string {
  if (found === undefined) return i18n.t('Looking for Codex threads…')
  if (!found || !codexThreadsFound(found)) return i18n.t('No Codex threads on this computer.')
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
 * Read cursor: the last thread read, `{ at, id }` (its `updatedAt` and id), stored as JSON. The broker lists threads
 * oldest first after that pair, so paging reaches every thread once, ties included; a thread written later gets a
 * newer `updatedAt` and is listed (and read) again. A plain number (ms) means every thread up to that time was read.
 */
type CodexCursor = { at: number; id?: string } | null

function parseCursor(cursor: string | null): CodexCursor {
  if (!cursor) return null
  if (/^\d+$/.test(cursor)) return { at: Number(cursor) }
  try {
    const raw = JSON.parse(cursor) as { at?: unknown; id?: unknown }
    if (typeof raw.at !== 'number' || !Number.isFinite(raw.at)) return null
    return typeof raw.id === 'string' ? { at: raw.at, id: raw.id } : { at: raw.at }
  } catch {
    return null
  }
}

async function readThreads(ctx: {
  signal: AbortSignal
  cursor: string | null
}): Promise<{ items: SourceItem[]; cursor: string | null }> {
  const list = platform.listCodexThreads
  const readThread = platform.readCodexThread
  if (!list || !readThread) throw new Error(i18n.t(UNAVAILABLE_HINT))
  const cursor = parseCursor(ctx.cursor)
  // In the broker's order (oldest first); its last item is where the next page starts.
  const batch = await list.call(platform, { sinceMs: cursor?.at, sinceId: cursor?.id, limit: CODEX_READ_BATCH })
  const items: SourceItem[] = []
  let last = cursor
  for (const summary of batch.slice(0, CODEX_READ_BATCH)) {
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
    last = { at: summary.updatedAt, id: summary.id }
  }
  return { items, cursor: last ? JSON.stringify(last) : null }
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
