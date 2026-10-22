import type { ConnectedSource, SourceDraft, SourceKind } from '@shared/types/sources'
import i18n from '@/i18n'
import { registerFixHandler, startJob } from '@/packages/background'
import { getSourceKind, type SourceChoice } from './kinds'
import { addSource, getSource, loadSources, SourceRuleError, sourcesStore } from './store'

// Per-kind job labels (English keys, R8).
const SYNC_LABELS: Record<SourceKind, string> = {
  folder: 'Folder sync',
  gmail: 'Gmail sync',
  asana: 'Asana sync',
  'codex-threads': 'Codex threads sync',
  documents: 'Documents sync',
}

/** The sync job's label for a kind, translated. */
export function syncJobLabel(kind: SourceKind): string {
  return i18n.t(SYNC_LABELS[kind])
}

/** English key: what Background review does, under its switch in the sheet and in each source's row. */
export const BACKGROUND_REVIEW_LINE =
  'Lets Dango read this source on a schedule to propose knowledge. Reading never makes anything authoritative.'

/** The Add a source sheet's MCP row (English keys): MCP servers are set up in Settings, not connected here. */
export const MCP_SOURCE_OPTION = {
  name: 'MCP server',
  badge: 'Advanced',
  hint: 'Tools and data from an MCP server. Set up in Advanced.',
  to: '/settings/mcp',
} as const

function kindOf(kind: SourceKind) {
  const def = getSourceKind(kind)
  if (!def) throw new Error(`Unknown source kind: ${kind}`)
  return def
}

/**
 * Runs the kind's picker or sign-in and returns a draft; connects nothing. Null when cancelled, including when
 * `signal` aborts while the picker or browser is open (whatever it set up meanwhile is removed again).
 */
export async function pickSource(
  kind: SourceKind,
  opts?: { signal?: AbortSignal; choice?: SourceChoice }
): Promise<SourceDraft | null> {
  const def = kindOf(kind)
  if (!def.isAvailable()) throw new Error(i18n.t(def.unavailableHint ?? 'Needs the desktop app.'))
  return await def.pick({ signal: opts?.signal ?? new AbortController().signal, choice: opts?.choice })
}

/** Undoes a draft that will not be connected: a picked folder is unbound, a newly created account removed. */
export async function discardSourceDraft(draft: SourceDraft): Promise<void> {
  await getSourceKind(draft.kind)?.discard?.(draft)
}

// Errors `connectSource` threw after discarding the draft.
const discardedDrafts = new WeakSet<object>()

/** Whether `connectSource` discarded the draft before throwing `error`: the draft cannot be connected again. */
export function draftWasDiscarded(error: unknown): boolean {
  return error instanceof SourceRuleError || (typeof error === 'object' && error !== null && discardedDrafts.has(error))
}

/**
 * Attaches the draft to the scope, stores the source and, when the kind can sync, starts its first sync. When storing
 * fails after the attachment was made (any error), or on a `SourceRuleError`, the attachment is undone and the draft
 * discarded before the error is rethrown (`draftWasDiscarded` is then true). When `attach` itself fails with another
 * error, the draft is kept so Connect can be tried again.
 */
export async function connectSource(
  draft: SourceDraft,
  opts: { scopeId: string; backgroundReview: boolean }
): Promise<{ sourceId: string; jobId?: string }> {
  const def = kindOf(draft.kind)
  const { scopeId } = opts
  let attached: Record<string, unknown> | undefined
  let source: ConnectedSource
  try {
    attached = def.attach ? await def.attach(draft, scopeId) : {}
    source = await addSource({
      kind: draft.kind,
      scopeId,
      label: draft.label,
      backgroundReview: def.supportsBackgroundReview && opts.backgroundReview,
      localOnly: false,
      config: { ...draft.config, ...attached },
    })
  } catch (error) {
    if (attached === undefined && !(error instanceof SourceRuleError)) throw error
    if (attached && def.attach && def.revoke) {
      // Attached but not stored: undo the attachment (a folder adopted into the scope is unbound again).
      await def
        .revoke({
          id: '',
          kind: draft.kind,
          scopeId,
          label: draft.label,
          backgroundReview: false,
          localOnly: false,
          config: { ...draft.config, ...attached },
          connectedAt: Date.now(),
        })
        .catch((e) => console.warn('[sources] Could not undo the attachment', e))
    }
    await discardSourceDraft(draft).catch((e) => console.warn('[sources] Could not discard the draft', e))
    const thrown = typeof error === 'object' && error !== null ? error : new Error(String(error))
    discardedDrafts.add(thrown)
    throw thrown
  }
  if (!def.sync) return { sourceId: source.id }
  const job = startJob({
    kind: 'sync',
    label: syncJobLabel(source.kind),
    scopeId,
    sourceId: source.id,
    sourceLabel: source.label,
  })
  return { sourceId: source.id, jobId: job.id }
}

async function sourceOfJob(sourceId: string | undefined): Promise<ConnectedSource | undefined> {
  if (sourceId === undefined) return undefined
  if (!sourcesStore.getState().loaded) await loadSources()
  return getSource(sourceId)
}

/** Fix handlers for source jobs' Needs you entries. Main window only, with the runner (Task 6). */
export function registerSourceFixHandlers(): void {
  registerFixHandler('reconnect', async (job) => {
    const source = await sourceOfJob(job.sourceId)
    if (!source) return false
    return (await getSourceKind(source.kind)?.reconnect?.(source)) ?? false
  })
  registerFixHandler('relink-folder', async (job) => {
    const source = await sourceOfJob(job.sourceId)
    if (!source || source.kind !== 'folder') return false
    return (await getSourceKind('folder')?.reconnect?.(source)) ?? false
  })
  registerFixHandler('try-again', async () => true)
  // R11: re-run only once a usable model is set up; otherwise open provider settings and keep the entry open.
  // TASK-20: a local-only source (ADR 0003) accepts only a model that runs on this device; with a usable cloud model
  // it opens default models so the user picks a local one. Dango never switches models by itself.
  registerFixHandler('choose-model', async (job) => {
    const [{ settingsStore }, { lastUsedModelStore }, { backgroundModelChoice, hasUsableModel, isLocalModelIn }] =
      await Promise.all([
        import('@/stores/settingsStore'),
        import('@/stores/lastUsedModelStore'),
        import('./model-check'),
      ])
    const settings = settingsStore.getState().getSettings()
    const lastUsed = lastUsedModelStore.getState().chat
    const usable = hasUsableModel(settings, lastUsed)
    const source = await sourceOfJob(job.sourceId)
    const allowed = !source?.localOnly || isLocalModelIn(settings, backgroundModelChoice(settings, lastUsed))
    if (usable && allowed) return true
    // Loaded on demand: it reaches the router, which pulls in every route.
    const { openConfiguration } = await import('@/components/sources/openConfiguration')
    await openConfiguration(usable ? '/settings/default-models' : '/settings/provider')
    return false
  })
}
