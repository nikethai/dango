import type { AsanaSourceConfig, GmailSourceConfig } from '@shared/pm-pilot'
import type { Scope } from '@shared/types/scope'
import type { ConnectedSource } from '@shared/types/sources'

/*
 * The one file in the PM pilot that imports other slices (names from the roadmap's Contract register). Every other
 * pm-pilot module, and its tests, imports or mocks `./bridge`. No logic beyond reading scopes and source configs.
 * Slice 10 never reads Trust, so `getTrustLevel` is not here (preflight R17).
 */

// Re-exports, by slice: 1b/5 Review feed, openers, appliers and undo; 3 scopes; 4 knowledge (preflight R5, R6, R16);
// 7 sources, background jobs and the background model (R8, R15); 8 `openConfiguration` (R9, R11).
export { JOB_FIX_LABELS } from '@shared/types/background'
export type { KnowledgeSourceInput } from '@shared/types/knowledge'
export type { ReviewEntry } from '@shared/types/review'
export type { Scope } from '@shared/types/scope'
export { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
export type { ConnectedSource, SourceItem } from '@shared/types/sources'
export { openConfiguration } from '@/components/sources/openConfiguration'
export { NeedsUserError } from '@/packages/background'
export {
  addKnowledge,
  approveProposal,
  ensureKnowledgeLoaded,
  KnowledgeConflictError,
  knowledgeForTurn,
  NEVER_SEND_EMAIL,
  proposeKnowledge,
  recordKnowledgeUse,
  resolveConflict,
} from '@/packages/knowledge'
export {
  addReviewEntry,
  applyReviewEntry,
  listReviewEntries,
  loadReviewEntries,
  registerReviewApplier,
  registerReviewOpener,
  reviewStore,
  setReviewEntryState,
  subscribeReviewEntries,
  updateReviewEntry,
} from '@/packages/review'
export {
  listSources,
  loadSources,
  registerSourceAdapter,
  type SourceAdapter,
  sourcesStore,
  updateSource,
} from '@/packages/sources'
export {
  backgroundModelChoice,
  hasUsableModel,
  isLocalModelProvider,
  LOCAL_PROVIDERS,
} from '@/packages/sources/model-check'
export { pushUndo } from '@/packages/undo'

// Slice 3 scopes, read outside React. Lazy: the scope hooks pull in Jotai atoms and storage (preflight R4).
async function readAllScopes(): Promise<Scope[]> {
  const { readScopes } = await import('@/hooks/useScopes')
  return readScopes()
}

export async function listClientScopes(): Promise<Scope[]> {
  return (await readAllScopes()).filter((s) => s.kind === 'client')
}

export async function getScope(id: string): Promise<Scope | undefined> {
  return (await readAllScopes()).find((s) => s.id === id)
}

/** Switches the chat to a session, in this window (chat store loaded lazily, as rate-limit-retry does). */
export async function switchCurrentSession(sessionId: string): Promise<void> {
  const crud = await import('@/stores/session/crud')
  crud.switchCurrentSession(sessionId)
}

function stringOf(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

/** A Gmail source's config; missing or malformed `matchers` read as `[]`. */
export function gmailConfig(source: Pick<ConnectedSource, 'config'>): GmailSourceConfig {
  const config = source.config ?? {}
  const matchers = Array.isArray(config.matchers)
    ? config.matchers.filter((m): m is string => typeof m === 'string' && m.trim() !== '')
    : []
  return { accountId: stringOf(config.accountId), matchers }
}

/** An Asana source's config; `projectGid` is missing until the user picks the project. */
export function asanaConfig(source: Pick<ConnectedSource, 'config'>): Partial<AsanaSourceConfig> & {
  accountId: string
} {
  const config = source.config ?? {}
  const projectGid = stringOf(config.projectGid)
  return projectGid ? { accountId: stringOf(config.accountId), projectGid } : { accountId: stringOf(config.accountId) }
}
