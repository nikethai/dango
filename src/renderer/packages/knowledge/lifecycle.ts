import type { KnowledgeItem, KnowledgeKind, KnowledgeState } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { t } from 'i18next'
import { current } from 'immer'
import isEqual from 'lodash/isEqual'
import { getLogger } from '@/lib/utils'
import { setReviewEntryState } from '@/packages/review'
import { scopeName } from './scopes'
import { commitKnowledge, ensureKnowledgeLoaded, knowledgeStore } from './store'
import { newRevision, quote } from './text'
import { pushKnowledgeUndo } from './undo'
import { dismissRechecks, fileRechecks } from './uses'

const log = getLogger('knowledge')

/** sha256 of `preference\nNever send email\n` (see `contentHash`). */
const NEVER_SEND_EMAIL_HASH = '743095b0d8f494d8ecabc9a04bfdf7ba7fee8ddc4b2b7cb699f3335c3588bd5c'

/**
 * The built-in Everywhere preference. It is never stored, so it cannot be edited, removed or moved, and
 * health checks skip it.
 */
export const NEVER_SEND_EMAIL: KnowledgeItem = {
  id: 'builtin:never-send-email',
  scopeId: EVERYWHERE_SCOPE_ID,
  kind: 'preference',
  text: 'Never send email',
  sources: [{ kind: 'user', label: 'Built in', id: 's1' }],
  status: 'approved',
  history: [],
  revisions: [
    {
      id: 'r1',
      text: 'Never send email',
      by: 'user',
      createdAt: 0,
      approval: { by: 'user', at: 0, contentHash: NEVER_SEND_EMAIL_HASH },
    },
  ],
  approvedRevisionId: 'r1',
  createdAt: 0,
  updatedAt: 0,
}

export type KnowledgeListOptions = { status?: KnowledgeItem['status'][]; kind?: KnowledgeKind[]; query?: string }

/** Lower case, accents dropped (NFD, marks stripped), for search. */
function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/**
 * The scope's items, newest `updatedAt` first; default status `approved`. In Everywhere the built-in item
 * leads whenever it matches. Pure, so hooks and `listKnowledge` share it.
 */
export function selectKnowledge(state: KnowledgeState, scopeId: string, opts?: KnowledgeListOptions): KnowledgeItem[] {
  const statuses = opts?.status ?? ['approved']
  const kinds = opts?.kind
  const query = fold(opts?.query?.trim() ?? '')
  const matches = (i: KnowledgeItem) =>
    statuses.includes(i.status) && (!kinds || kinds.includes(i.kind)) && (!query || fold(i.text).includes(query))
  const items = state.items.filter((i) => i.scopeId === scopeId && matches(i)).sort((a, b) => b.updatedAt - a.updatedAt)
  return scopeId === EVERYWHERE_SCOPE_ID && matches(NEVER_SEND_EMAIL) ? [NEVER_SEND_EMAIL, ...items] : items
}

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
  prepare: (item: KnowledgeItem) => Promise<P>,
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
 * Throws `built-in` or `missing`.
 */
export async function moveKnowledge(id: string, toScopeId: string): Promise<KnowledgeItem> {
  refuseBuiltIn(id)
  await ensureKnowledgeLoaded({ fresh: true })
  const seen = knowledgeStore.getState().state.items.find((i) => i.id === id && i.status === 'approved')
  if (seen?.scopeId === toScopeId) return seen
  const { item, revert } = await changeItem(
    id,
    async (before) => t('from {{scope}}', { scope: scopeName(before.scopeId) }),
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
  const ref = { type: 'knowledge' as const, id }
  try {
    await setReviewEntryState({ ref }, 'done')
  } catch (error) {
    log.error('Knowledge re-check close failed:', error)
  }
  pushKnowledgeUndo(
    t('Approved "{{text}}" for {{scope}}', { text: quote(item.text), scope: scopeName(item.scopeId) }),
    revert,
    {
      onUndo: async () => {
        await setReviewEntryState({ ref }, 'open')
      },
    }
  )
  return item
}
