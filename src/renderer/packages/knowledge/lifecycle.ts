import type { KnowledgeItem, KnowledgeState } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { t } from 'i18next'
import { current } from 'immer'
import isEqual from 'lodash/isEqual'
import { getLogger } from '@/lib/utils'
import { listReviewEntries, loadReviewEntries, setReviewEntryState } from '@/packages/review'
import { scopeExists, scopeName } from './scopes'
import { type KnowledgeListOptions, NEVER_SEND_EMAIL, selectKnowledge } from './select'
import { commitKnowledge, ensureKnowledgeLoaded, knowledgeStore } from './store'
import { newRevision, quote } from './text'
import { pushKnowledgeUndo } from './undo'
import { dismissRechecks, fileRechecks } from './uses'

export { type KnowledgeListOptions, NEVER_SEND_EMAIL, selectKnowledge } from './select'

const log = getLogger('knowledge')

export function listKnowledge(scopeId: string, opts?: KnowledgeListOptions): KnowledgeItem[] {
  return selectKnowledge(knowledgeStore.getState().state, scopeId, opts)
}

/** Another window changed a record between our read and our commit; the action starts again. */
export class KnowledgeChangedError extends Error {
  constructor() {
    super('changed')
    this.name = 'KnowledgeChangedError'
  }
}

/** Runs `attempt` again (up to three times in all) when it hit a concurrent change. */
export async function retryOnChange<T>(attempt: () => Promise<T>): Promise<T> {
  for (let n = 1; ; n++) {
    try {
      return await attempt()
    } catch (error) {
      if (!(error instanceof KnowledgeChangedError) || n >= 3) throw error
    }
  }
}

/** Throws `KnowledgeChangedError` unless the draft item still equals what was read. Call before mutating. */
export function assertUnchanged(d: KnowledgeState, seen: KnowledgeItem): KnowledgeItem {
  const draft = d.items.find((i) => i.id === seen.id)
  if (!draft || !isEqual(current(draft), seen)) throw new KnowledgeChangedError()
  return draft
}

function refuseBuiltIn(id: string) {
  if (id === NEVER_SEND_EMAIL.id) throw new Error('built-in')
}

type Changed = { item: KnowledgeItem; before: KnowledgeItem; revert: () => Promise<void> }

/**
 * One user change to one approved item: a fresh read, async `prepare` (hashing), then a commit that
 * applies the change only if the item is still as read (otherwise it starts again).
 */
function changeItem<P>(
  id: string,
  prepare: (item: KnowledgeItem) => P | Promise<P>,
  apply: (draft: KnowledgeItem, prepared: P, now: number) => void
): Promise<Changed> {
  refuseBuiltIn(id)
  return retryOnChange(async () => {
    await ensureKnowledgeLoaded({ fresh: true })
    const before = knowledgeStore.getState().state.items.find((i) => i.id === id && i.status === 'approved')
    if (!before) throw new Error('missing')
    const prepared = await prepare(before)
    let item: KnowledgeItem | undefined
    const result = await commitKnowledge((d) => {
      const draft = assertUnchanged(d, before)
      apply(draft, prepared, Date.now())
      item = current(draft)
    })
    return { item: item as KnowledgeItem, before, revert: result.revert }
  })
}

async function recheckOrNothing(before: KnowledgeItem, reason: 'edited' | 'removed'): Promise<string[]> {
  try {
    return await fileRechecks([before], reason)
  } catch (error) {
    log.error('Knowledge re-check failed:', error)
    return []
  }
}

/**
 * New wording, approved by this action: a revision (parent = the approved one) becomes the approved one,
 * the old text goes into an `edited` event, and drafts or changes that used it get a re-check.
 * Pushes `Saved the new wording`; the same wording changes nothing. Throws `built-in`, `empty` or `missing`.
 */
export async function editKnowledge(id: string, text: string): Promise<KnowledgeItem> {
  refuseBuiltIn(id)
  const next = text.trim()
  if (!next) throw new Error('empty')
  await ensureKnowledgeLoaded({ fresh: true })
  const seen = knowledgeStore.getState().state.items.find((i) => i.id === id && i.status === 'approved')
  if (seen?.text === next) return seen
  const { item, before, revert } = await changeItem(
    id,
    (seen) => newRevision(seen, { text: next, by: 'user' }, 'user'),
    (draft, revision, now) => {
      draft.history.push({ at: now, by: 'user', action: 'edited', note: draft.text })
      draft.revisions.push(revision)
      draft.approvedRevisionId = revision.id
      draft.text = revision.text
      draft.updatedAt = now
    }
  )
  const rechecks = await recheckOrNothing(before, 'edited')
  pushKnowledgeUndo(t('Saved the new wording'), revert, { onUndo: () => dismissRechecks(rechecks) })
  return item
}

/** Marks the item removed (it keeps every revision). Pushes `Removed "{text}"`. Throws `built-in` or `missing`. */
export async function removeKnowledge(id: string): Promise<void> {
  const { before, revert } = await changeItem(
    id,
    async () => undefined,
    (draft, _, now) => {
      draft.status = 'removed'
      draft.history.push({ at: now, by: 'user', action: 'removed' })
      draft.updatedAt = now
    }
  )
  const rechecks = await recheckOrNothing(before, 'removed')
  pushKnowledgeUndo(t('Removed "{{text}}"', { text: quote(before.text) }), revert, {
    onUndo: () => dismissRechecks(rechecks),
  })
}

/**
 * Moves the item to another scope, with a `moved` event `from {old scope}`; what it overrode no longer
 * applies there. Pushes `Moved "{text}" to {scope}`. Moving to its own scope changes nothing.
 * Throws `built-in`, `missing` (no such item, or an unknown target scope) or `preference` (ADR 0013:
 * preferences live in Everywhere).
 */
export async function moveKnowledge(id: string, toScopeId: string): Promise<KnowledgeItem> {
  refuseBuiltIn(id)
  await ensureKnowledgeLoaded({ fresh: true })
  const seen = knowledgeStore.getState().state.items.find((i) => i.id === id && i.status === 'approved')
  if (!seen) throw new Error('missing')
  if (seen.scopeId === toScopeId) return seen
  if (!scopeExists(toScopeId)) throw new Error('missing')
  const { item, revert } = await changeItem(
    id,
    (before) => {
      // Checked on the read the commit is guarded by, so a retry checks again.
      if (before.kind === 'preference' && toScopeId !== EVERYWHERE_SCOPE_ID) throw new Error('preference')
      return t('from {{scope}}', { scope: scopeName(before.scopeId) })
    },
    (draft, note, now) => {
      draft.scopeId = toScopeId
      draft.history.push({ at: now, by: 'user', action: 'moved', note })
      delete draft.overrides
      draft.updatedAt = now
    }
  )
  pushKnowledgeUndo(t('Moved "{{text}}" to {{scope}}', { text: quote(item.text), scope: scopeName(toScopeId) }), revert)
  return item
}

/**
 * A connected source was revoked (background write: no undo). Its sources on items and proposals get
 * `removed: true`. Returns how many sources were newly marked.
 */
export async function markSourceRemoved(sourceId: string): Promise<number> {
  let marked = 0
  await commitKnowledge((d) => {
    for (const record of [...d.items, ...d.proposals]) {
      for (const source of record.sources) {
        if (source.sourceId !== sourceId || source.removed) continue
        source.removed = true
        marked += 1
      }
    }
  })
  return marked
}

/**
 * The user approves the item's current content again: a new approved revision, `staleAfter` and
 * `healthNotice` cleared, and its re-check entry closed. Pushes `Approved "{text}" for {scope}`; undo
 * reopens the entry. Throws `built-in` or `missing`.
 */
export async function reapproveKnowledge(id: string): Promise<KnowledgeItem> {
  const { item, revert } = await changeItem(
    id,
    (seen) => newRevision(seen, { text: seen.text, condition: seen.condition, by: 'user' }, 'user'),
    (draft, revision, now) => {
      draft.revisions.push(revision)
      draft.approvedRevisionId = revision.id
      delete draft.staleAfter
      delete draft.healthNotice
      draft.history.push({ at: now, by: 'user', action: 'approved' })
      draft.updatedAt = now
    }
  )
  const closed = await closeHealthEntry(id)
  pushKnowledgeUndo(
    t('Approved "{{text}}" for {{scope}}', { text: quote(item.text), scope: scopeName(item.scopeId) }),
    revert,
    {
      onUndo: async () => {
        if (closed) await setReviewEntryState({ id: closed }, 'open')
      },
    }
  )
  return item
}

/** Closes the item's newest health re-check entry if it is open; returns its id (for undo) or undefined. */
async function closeHealthEntry(itemId: string): Promise<string | undefined> {
  try {
    await loadReviewEntries()
    // Newest first.
    const newest = listReviewEntries().find((e) => e.ref.type === 'knowledge' && e.ref.id === itemId)
    if (newest?.state !== 'open') return undefined
    await setReviewEntryState({ id: newest.id }, 'done')
    return newest.id
  } catch (error) {
    log.error('Knowledge re-check close failed:', error)
    return undefined
  }
}
