import {
  type ConnectedSource,
  SOURCE_KINDS,
  type SourceDraft,
  type SourceItem,
  type SourceKind,
} from '@shared/types/sources'

/**
 * Reading side of a kind. Slice 10 adds these for Gmail and Asana with `registerSourceAdapter`.
 * - `pollMs`: sync again this long after the last sync; the due check runs often enough to honour it (see
 *   `dueCheckIntervalMs`).
 * - `sync` may return `quiet: true` when the run found nothing worth a Done entry (a poll with nothing new).
 */
export type SourceAdapter = {
  pollMs?: number
  sync?(
    source: ConnectedSource,
    ctx: { signal: AbortSignal; progress(text: string): void }
  ): Promise<{ summary: string; quiet?: boolean }>
  read?(
    source: ConnectedSource,
    ctx: { signal: AbortSignal; cursor: string | null }
  ): Promise<{ items: SourceItem[]; cursor: string | null }>
}

/** What the sheet already knows before the pick: an existing account to reuse, or a Documents collection. */
export type SourceChoice = { accountId?: string; kbId?: number }

export type SourceKindDefinition = SourceAdapter & {
  kind: SourceKind
  name: string
  hint: string
  /** OAuth kinds: the Integrations connector whose active accounts the sheet offers to reuse. */
  connectorId?: string
  supportsBackgroundReview: boolean
  isAvailable(): boolean
  unavailableHint?: string
  pick(ctx: { signal: AbortSignal; choice?: SourceChoice }): Promise<SourceDraft | null>
  attach?(draft: SourceDraft, scopeId: string): Promise<Record<string, unknown>>
  discard?(draft: SourceDraft): Promise<void>
  reconnect?(source: ConnectedSource): Promise<boolean>
  /**
   * Undoes what `attach` set up (a folder is unbound; accounts and collections are kept). Must be idempotent: running
   * it again on an already-revoked source succeeds, because `revokeSource` repeats it when a later step failed.
   */
  revoke?(source: ConnectedSource): Promise<void>
}

const kinds = new Map<SourceKind, SourceKindDefinition>()
// Adapters registered before their kind; merged in when the kind registers.
const pendingAdapters = new Map<SourceKind, SourceAdapter>()

export function registerSourceKind(def: SourceKindDefinition): void {
  const pending = pendingAdapters.get(def.kind)
  pendingAdapters.delete(def.kind)
  kinds.set(def.kind, pending ? { ...def, ...pending } : def)
}

/** Merges reading methods into a kind; kept until the kind registers when it is not registered yet. */
export function registerSourceAdapter(kind: SourceKind, adapter: SourceAdapter): void {
  const def = kinds.get(kind)
  if (def) {
    kinds.set(kind, { ...def, ...adapter })
    return
  }
  pendingAdapters.set(kind, { ...pendingAdapters.get(kind), ...adapter })
}

export function getSourceKind(kind: SourceKind): SourceKindDefinition | undefined {
  return kinds.get(kind)
}

/** Registered kinds in the fixed order: Folder, Gmail, Asana, Codex threads, Documents. */
export function listSourceKinds(): SourceKindDefinition[] {
  return SOURCE_KINDS.flatMap((kind) => {
    const def = kinds.get(kind)
    return def ? [def] : []
  })
}

export function _resetSourceKindsForTests(): void {
  kinds.clear()
  pendingAdapters.clear()
}
