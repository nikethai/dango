import type {
  KnowledgeConflict,
  KnowledgeEvent,
  KnowledgeItem,
  KnowledgeKind,
  KnowledgeProposal,
  KnowledgeRevision,
  KnowledgeSourceInput,
  KnowledgeState,
} from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { t } from 'i18next'
import { v4 as uuidv4 } from 'uuid'
import { checkAgainstLayers } from './contradictions'
import { fileProposal } from './proposals'
import { scopeName } from './scopes'
import { commitKnowledge, ensureKnowledgeLoaded, knowledgeStore, revertCommits } from './store'
import { assignSourceIds, newRevision, quote } from './text'
import { pushKnowledgeUndo } from './undo'

/**
 * The proposal waits in Review as a Conflict. Callers show
 * `t('Waiting in Review: it contradicts "{{old}}"', { old: quote(oldText) })` with `toastActions.add`.
 */
export class KnowledgeConflictError extends Error {
  conflict: KnowledgeConflict
  oldText: string

  constructor(conflict: KnowledgeConflict, oldText: string) {
    super('conflict')
    this.name = 'KnowledgeConflictError'
    this.conflict = conflict
    this.oldText = oldText
  }
}

const unique = (ids: string[]) => [...new Set(ids)]

function conflictError(state: KnowledgeState, conflict: KnowledgeConflict): KnowledgeConflictError {
  const old = state.items.find((i) => i.id === conflict.itemIds[0])?.text ?? ''
  return new KnowledgeConflictError(conflict, old)
}

export function originBy(origin: KnowledgeProposal['origin']): KnowledgeEvent['by'] {
  return origin === 'background-review' ? 'background-review' : origin === 'chat' ? 'chat' : 'user'
}

/** Whether an approved item of the target scope or Everywhere changed after the proposal was checked. */
function newerThanCheck(state: KnowledgeState, scopeId: string, checkedAt: number): boolean {
  return state.items.some(
    (i) =>
      i.status === 'approved' && (i.scopeId === scopeId || i.scopeId === EVERYWHERE_SCOPE_ID) && i.updatedAt > checkedAt
  )
}

/** The item's revisions: one approved, or the proposal's unapproved text plus the user's approved edit. */
async function revisionsFor(
  kind: KnowledgeKind,
  original: string,
  text: string,
  by: KnowledgeEvent['by'],
  edited: boolean,
  condition: string | undefined
): Promise<KnowledgeRevision[]> {
  const empty = { kind, revisions: [] as KnowledgeRevision[], approvedRevisionId: '' }
  if (!edited) return [await newRevision(empty, { text, by, condition }, 'user')]
  const r1 = await newRevision(empty, { text: original, by })
  const r2 = await newRevision(
    { kind, revisions: [r1], approvedRevisionId: r1.id },
    { text, by: 'user', condition },
    'user'
  )
  return [r1, r2]
}

export type Approved = { item: KnowledgeItem; revert: () => Promise<void> }

export type ApproveOptions = {
  text?: string
  /** False skips the contradiction check (the add that just filed it, or the user settling its conflict). */
  recheck: boolean
  /** Keep both: the approved revision carries this condition, mirrored to `condition`. */
  condition?: string
  /**
   * Settles this open conflict in the same commit (Keep this, Keep both): the conflict no longer blocks the
   * approval, and `apply` makes the rest of the change on the draft, before the item is added. `apply` may
   * also change the new item. An error it throws cancels the whole commit (nothing is written).
   */
  resolving?: { conflictId: string; apply: (d: KnowledgeState, item: KnowledgeItem) => void }
}

/** Saves the proposal as an approved item (no undo pushed). Internal: `conflicts.ts` reuses it. */
export async function approve(id: string, opts: ApproveOptions): Promise<Approved> {
  await ensureKnowledgeLoaded({ fresh: true })
  const state = knowledgeStore.getState().state
  const p = state.proposals.find((x) => x.id === id)
  if (!p) throw new Error('missing')
  const blocking = (c: KnowledgeConflict) =>
    c.proposalId === id && c.state === 'open' && c.id !== opts.resolving?.conflictId
  const open = state.conflicts.find(blocking)
  if (open) throw conflictError(state, open)

  const text = opts.text === undefined ? p.text : opts.text.trim()
  if (!text) throw new Error('empty')
  const edited = text !== p.text
  // ADR 0013: a preference approved anywhere lands in Everywhere.
  const scopeId = p.kind === 'preference' ? EVERYWHERE_SCOPE_ID : p.scopeId

  let overrides = p.overrides ?? []
  const needsCheck =
    opts.recheck && (edited || p.checkedAt === undefined || newerThanCheck(state, scopeId, p.checkedAt))
  if (needsCheck) {
    const check = await checkAgainstLayers({
      text,
      targetScopeId: scopeId,
      ...(p.sessionId !== undefined ? { sessionId: p.sessionId } : {}),
      sources: p.sources,
    })
    // An edit replaces what the old text overrode; a re-check of the same text adds to it.
    overrides = unique([...(edited ? [] : overrides), ...check.overrides])
    if (check.conflictsWith.length) throw await waitAsConflict(id, text, check, overrides)
  }

  const now = Date.now()
  const by = originBy(p.origin)
  const revisions = await revisionsFor(p.kind, p.text, text, by, edited, opts.condition)
  const item: KnowledgeItem = {
    id: uuidv4(),
    scopeId,
    kind: p.kind,
    text,
    ...(opts.condition !== undefined ? { condition: opts.condition } : {}),
    sources: assignSourceIds([], p.sources),
    status: 'approved',
    history: [
      { at: p.createdAt, by, action: 'proposed', ...(edited ? { note: p.text } : {}) },
      { at: now, by: 'user', action: 'approved' },
    ],
    revisions,
    approvedRevisionId: revisions[revisions.length - 1].id,
    createdAt: now,
    updatedAt: now,
    ...(overrides.length ? { overrides } : {}),
    // Lets review-sync mark the proposal's entry done rather than dismissed (preflight C7).
    proposalId: p.id,
  }

  let failure: Error | undefined
  const result = await commitKnowledge((d) => {
    // Another window may have dismissed, approved or conflicted it since the read.
    if (!d.proposals.some((x) => x.id === id)) {
      failure = new Error('missing')
      return
    }
    const conflict = d.conflicts.find(blocking)
    if (conflict) {
      failure = conflictError(d, { ...conflict, itemIds: [...conflict.itemIds] })
      return
    }
    opts.resolving?.apply(d, item)
    d.proposals = d.proposals.filter((x) => x.id !== id)
    d.items.push(item)
  })
  if (failure) throw failure
  return { item, revert: result.revert }
}

/** Keeps the proposal open with the (edited) text and a new open conflict; returns the error to throw. */
async function waitAsConflict(
  id: string,
  text: string,
  check: { conflictsWith: string[] },
  overrides: string[]
): Promise<Error> {
  const now = Date.now()
  let error: Error | undefined
  await commitKnowledge((d) => {
    const p = d.proposals.find((x) => x.id === id)
    if (!p) {
      error = new Error('missing')
      return
    }
    const existing = d.conflicts.find((c) => c.proposalId === id && c.state === 'open')
    if (existing) {
      error = conflictError(d, { ...existing, itemIds: [...existing.itemIds] })
    } else {
      p.text = text
      p.conflictsWith = [...check.conflictsWith]
      if (overrides.length) p.overrides = [...overrides]
      else delete p.overrides
      p.checkedAt = now
      const conflict: KnowledgeConflict = {
        id: uuidv4(),
        scopeId: p.scopeId,
        proposalId: id,
        itemIds: [...check.conflictsWith],
        state: 'open',
        createdAt: now,
      }
      d.conflicts.push(conflict)
      error = conflictError(d, conflict)
    }
  })
  return error as Error
}

/**
 * Approves a proposal (optionally with edited text) and pushes `Approved "{text}" for {scope}`.
 * Throws `Error('missing')` for an unknown id and `KnowledgeConflictError` when it contradicts the scope.
 */
export async function approveProposal(id: string, opts?: { text?: string }): Promise<KnowledgeItem> {
  const { item, revert } = await approve(id, {
    ...(opts?.text !== undefined ? { text: opts.text } : {}),
    recheck: true,
  })
  pushKnowledgeUndo(
    t('Approved "{{text}}" for {{scope}}', { text: quote(item.text), scope: scopeName(item.scopeId) }),
    revert
  )
  return item
}

/**
 * The user adds knowledge by hand: filed as their proposal (past the Don't suggest list), then approved,
 * with one undo `Added "{text}" to {scope}` that takes back both in one commit. Throws `Error('empty')` for
 * blank text, `Error('duplicate')` when the
 * scope already has it approved or proposed, and `KnowledgeConflictError` on a contradiction (the
 * Conflict entry is then in Review).
 */
export async function addKnowledge(input: {
  scopeId: string
  kind: KnowledgeKind
  text: string
  /** Where the text came from; the user by default. A local-only source id keeps the item off cloud models. */
  sources?: KnowledgeSourceInput[]
}): Promise<KnowledgeItem> {
  if (!input.text.trim()) throw new Error('empty')
  const filed = await fileProposal(
    {
      scopeId: input.scopeId,
      kind: input.kind,
      text: input.text.trim(),
      sources: input.sources ?? [{ kind: 'user', label: 'You' }],
      origin: 'user',
    },
    { skipDontSuggest: true }
  )
  if (!filed) throw new Error('duplicate')
  // The filing just ran the check; a failed one (no model) is not repeated.
  const { item, revert } = await approve(filed.proposal.id, { recheck: false })
  // One undo, one commit: the approve and the filing are reverted together, so a failure leaves both in place.
  pushKnowledgeUndo(
    t('Added "{{text}}" to {{scope}}', { text: quote(item.text), scope: scopeName(item.scopeId) }),
    () => revertCommits([filed.revert, revert])
  )
  return item
}
