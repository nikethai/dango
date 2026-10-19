import { JOB_FIX_LABELS } from '@shared/types/background'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import type { ConnectedSource, SourceItem } from '@shared/types/sources'
import type { WorkspaceDescriptor, WorkspaceListEntry } from '@shared/types/workspace'
import { v4 as uuidv4 } from 'uuid'
import i18n from '@/i18n'
import { NeedsUserError } from '@/packages/background'
import platform, { platformCapabilities } from '@/platform'
import type { SourceKindDefinition } from '../kinds'
import { SourceRuleError, updateSource } from '../store'
import { lastPathSegment, throwIfAborted, UNAVAILABLE_HINT } from './common'

/** A sync or read stops counting after this many files. */
export const FOLDER_MAX_FILES = 5_000
/** Files read per `read` run. */
export const FOLDER_READ_BATCH = 40
const MAX_READ_BYTES = 200 * 1024
const TEXT_FILE = /\.(md|txt|rst|org)$/i

// English key, translated when the Review entry is written.
const MOVED_REASON = 'the folder moved or was deleted'

const relink = () =>
  new NeedsUserError(MOVED_REASON, { action: 'relink-folder', label: JOB_FIX_LABELS['relink-folder'] })

const errorCode = (error: unknown) =>
  error && typeof error === 'object' && 'code' in error ? String((error as { code?: unknown }).code) : undefined

/** The scope's binding, ready to read. A missing or moved folder needs the user (no retries). */
async function readyBinding(scopeId: string): Promise<WorkspaceDescriptor> {
  if (!platform.restoreProjectBinding) throw new Error(i18n.t(UNAVAILABLE_HINT))
  let descriptor: WorkspaceDescriptor
  try {
    descriptor = await platform.restoreProjectBinding(scopeId)
  } catch (error) {
    // No binding left for the scope (unbound elsewhere, or never adopted).
    const code = errorCode(error)
    if (code === 'UNAUTHORIZED_ROOT' || code === 'NOT_FOUND') throw relink()
    throw error
  }
  if (descriptor.status !== 'ready') throw relink()
  return descriptor
}

/**
 * Walks the folder breadth-first, paging each directory on its cursor, and calls `onFile` for each file until
 * `FOLDER_MAX_FILES`. `onPage` gets the running file count. Returns the count.
 */
async function walkFolder(
  capabilityId: string,
  signal: AbortSignal,
  onFile: (entry: WorkspaceListEntry) => void,
  onPage?: (count: number) => void
): Promise<number> {
  const list = platform.listWorkspaceChildren
  if (!list) throw new Error(i18n.t(UNAVAILABLE_HINT))
  const queue = ['']
  let count = 0
  while (queue.length > 0) {
    const dir = queue.shift() as string
    let cursor: string | undefined
    do {
      throwIfAborted(signal)
      const page = await list.call(platform, capabilityId, dir, cursor)
      for (const entry of page.entries) {
        if (entry.kind === 'directory') {
          queue.push(entry.relativePath)
          continue
        }
        count += 1
        onFile(entry)
        if (count >= FOLDER_MAX_FILES) {
          onPage?.(count)
          return count
        }
      }
      onPage?.(count)
      cursor = page.cursor ?? undefined
    } while (cursor)
  }
  return count
}

/** Cursor: JSON map path → revision, in least-recently-checked order. */
function parseRevisions(cursor: string | null): Map<string, string> {
  const revisions = new Map<string, string>()
  if (!cursor) return revisions
  try {
    const raw: unknown = JSON.parse(cursor)
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
      for (const [path, revision] of Object.entries(raw)) {
        if (typeof revision === 'string') revisions.set(path, revision)
      }
    }
  } catch {
    // An unreadable cursor reads every file again.
  }
  return revisions
}

async function readFolder(
  source: ConnectedSource,
  ctx: { signal: AbortSignal; cursor: string | null }
): Promise<{ items: SourceItem[]; cursor: string | null }> {
  const readFile = platform.readWorkspaceFile
  if (!readFile) throw new Error(i18n.t(UNAVAILABLE_HINT))
  const { capabilityId } = await readyBinding(source.scopeId)
  const previous = parseRevisions(ctx.cursor)
  const listed = new Map<string, WorkspaceListEntry>()
  await walkFolder(capabilityId, ctx.signal, (entry) => {
    if (!TEXT_FILE.test(entry.relativePath)) return
    if (entry.size !== undefined && entry.size >= MAX_READ_BYTES) return
    listed.set(entry.relativePath, entry)
  })
  // Files no longer listed (deleted, or past the file limit) drop out; the rest keep their order.
  const next = new Map([...previous].filter(([path]) => listed.has(path)))
  const unseen = [...listed.values()].filter((entry) => !previous.has(entry.relativePath))
  // Known files, least recently checked first; a listing that already shows the stored revision needs no read.
  const known = [...next.keys()].flatMap((path) => {
    const entry = listed.get(path) as WorkspaceListEntry
    return entry.revision !== undefined && entry.revision === next.get(path) ? [] : [entry]
  })
  const queue = [...unseen, ...known]
  const items: SourceItem[] = []
  for (const entry of queue.slice(0, FOLDER_READ_BATCH)) {
    throwIfAborted(ctx.signal)
    const file = await readFile.call(platform, capabilityId, entry.relativePath)
    next.delete(entry.relativePath)
    next.set(entry.relativePath, file.revision)
    if (file.encoding !== 'utf-8' || file.size >= MAX_READ_BYTES) continue
    if (file.revision === previous.get(entry.relativePath)) continue
    items.push({ ref: entry.relativePath, label: entry.name, text: file.content })
  }
  return { items, cursor: JSON.stringify(Object.fromEntries(next)) }
}

export const folderKind: SourceKindDefinition = {
  kind: 'folder',
  name: 'Folder',
  hint: 'A folder on this computer. Dango reads the files in it.',
  supportsBackgroundReview: true,
  isAvailable: () => platformCapabilities.supportsProjectWorkspace && !!platform.pickAndBindProject,
  unavailableHint: UNAVAILABLE_HINT,

  async pick({ signal }) {
    if (signal.aborted || !platform.pickAndBindProject) return null
    const draftBindingId = `draft:${uuidv4()}`
    const descriptor = await platform.pickAndBindProject(draftBindingId)
    if (!descriptor) return null
    // The native picker cannot be closed from here: a folder picked after Cancel is unbound at once (R10).
    if (signal.aborted) {
      await platform.unbindProject?.(draftBindingId)
      return null
    }
    return {
      kind: 'folder',
      label: lastPathSegment(descriptor.displayPath),
      ref: descriptor.displayPath,
      config: {},
      draftBindingId,
    }
  },

  async attach(draft, scopeId) {
    if (scopeId === EVERYWHERE_SCOPE_ID) throw new SourceRuleError('folder-everywhere')
    if (!draft.draftBindingId || !platform.adoptDraftFolderBinding) throw new Error(i18n.t(UNAVAILABLE_HINT))
    try {
      const descriptor = await platform.adoptDraftFolderBinding(draft.draftBindingId, scopeId)
      return { displayPath: descriptor.displayPath }
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (errorCode(error) === 'ALREADY_EXISTS' || message.endsWith('This scope already has a folder.')) {
        throw new SourceRuleError('folder-taken')
      }
      throw error
    }
  },

  async discard(draft) {
    if (draft.draftBindingId) await platform.unbindProject?.(draft.draftBindingId)
  },

  // Idempotent: unbinding a scope that has no binding succeeds.
  async revoke(source) {
    await platform.unbindProject?.(source.scopeId)
  },

  async reconnect(source) {
    const descriptor = await platform.relinkProject?.(source.scopeId)
    if (!descriptor) return false
    await updateSource(source.id, { config: { ...source.config, displayPath: descriptor.displayPath } })
    return true
  },

  async sync(source, { signal, progress }) {
    const { capabilityId } = await readyBinding(source.scopeId)
    const count = await walkFolder(
      capabilityId,
      signal,
      () => undefined,
      (n) => progress(i18n.t('Reading your folder · {{count}} files', { count: n }))
    )
    return { summary: i18n.t('Read {{count}} files from {{label}}', { count, label: source.label }) }
  },

  read: readFolder,
}
