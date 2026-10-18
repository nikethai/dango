import type {
  KnowledgeConflict,
  KnowledgeItem,
  KnowledgeProposal,
  KnowledgeRevision,
  KnowledgeState,
} from '@shared/types/knowledge'
import { t } from 'i18next'
import { v4 as uuidv4 } from 'uuid'
import { getLogger } from '@/lib/utils'
import { approve, originBy } from './approve'
import { assertUnchanged, KnowledgeChangedError, retryOnChange } from './lifecycle'
import { commitKnowledge, ensureKnowledgeLoaded, knowledgeStore } from './store'
import { assignSourceIds, newRevision, quote } from './text'
import { pushKnowledgeUndo } from './undo'
import { dismissRechecks, fileRechecks } from './uses'

const log = getLogger('knowledge')

type Read = { conflict: KnowledgeConflict; proposal: KnowledgeProposal; items: KnowledgeItem[] }

/** A fresh read of the open conflict, its proposal and its items that are still approved. */
async function readConflict(conflictId: string): Promise<Read> {
  await ensureKnowledgeLoaded({ fresh: true })
  const state = knowledgeStore.getState().state
  const conflict = state.conflicts.find((c) => c.id === conflictId && c.state === 'open')
  const proposal = conflict && state.proposals.find((p) => p.id === conflict.proposalId)
  if (!conflict || !proposal) throw new Error('missing')
  const items = conflict.itemIds.flatMap((id) => {
    const item = state.items.find((i) => i.id === id && i.status === 'approved')
    return item ? [item] : []
  })
  return { conflict, proposal, items }
}

/** In the commit: everything read is still as read (else the action starts again), then the conflict is resolved. */
function settle(d: KnowledgeState, read: Read, now: number): void {
  const conflict = d.conflicts.find((c) => c.id === read.conflict.id)
  if (conflict?.state !== 'open' || !d.proposals.some((p) => p.id === read.proposal.id)) {
    throw new KnowledgeChangedError()
  }
  for (const item of read.items) assertUnchanged(d, item)
  conflict.state = 'resolved'
  conflict.resolvedAt = now
}

function supersede(d: KnowledgeState, loser: KnowledgeItem, winnerId: string, now: number): void {
  const draft = d.items.find((i) => i.id === loser.id)
  if (!draft) return
  draft.status = 'superseded'
  draft.supersededBy = winnerId
  draft.history.push({ at: now, by: 'user', action: 'superseded' })
  draft.updatedAt = now
}

async function recheckReplaced(losers: KnowledgeItem[]): Promise<string[]> {
  try {
    return await fileRechecks(losers, 'replaced')
  } catch (error) {
    log.error('Knowledge re-check failed:', error)
    return []
  }
}

type Outcome = { message: string; revert: () => Promise<void>; rechecks: string[] }

/** Keep the new statement: the proposal is approved (as in `approveProposal`) and supersedes the items. */
async function keepProposal(conflictId: string): Promise<Outcome> {
  const read = await readConflict(conflictId)
  const { item, revert } = await approve(read.proposal.id, {
    recheck: false,
    resolving: {
      conflictId,
      apply: (d, winner) => {
        const now = Date.now()
        settle(d, read, now)
        for (const loser of read.items) supersede(d, loser, winner.id, now)
      },
    },
  })
  const rechecks = await recheckReplaced(read.items)
  return { message: t('Kept "{{text}}"', { text: quote(item.text) }), revert, rechecks }
}

/**
 * Keep a saved statement: the proposal is stored as a superseded item with one unapproved revision
 * (history `proposed`, `superseded`); the conflict's other items are superseded too.
 */
async function keepItem(conflictId: string, winnerId: string): Promise<Outcome> {
  const read = await readConflict(conflictId)
  const winner = read.items.find((i) => i.id === winnerId)
  if (!winner) throw new Error('missing')
  const p = read.proposal
  const by = originBy(p.origin)
  const empty = { kind: p.kind, revisions: [] as KnowledgeRevision[], approvedRevisionId: '' }
  const revision = await newRevision(empty, { text: p.text, by })
  const losers = read.items.filter((i) => i.id !== winnerId)

  const result = await commitKnowledge((d) => {
    const now = Date.now()
    settle(d, read, now)
    d.proposals = d.proposals.filter((x) => x.id !== p.id)
    d.items.push({
      id: uuidv4(),
      scopeId: p.scopeId,
      kind: p.kind,
      text: p.text,
      sources: assignSourceIds([], p.sources),
      status: 'superseded',
      supersededBy: winnerId,
      history: [
        { at: p.createdAt, by, action: 'proposed' },
        { at: now, by: 'user', action: 'superseded' },
      ],
      revisions: [revision],
      approvedRevisionId: revision.id,
      createdAt: now,
      updatedAt: now,
      // Lets review-sync close the proposal's entry as done (preflight C7).
      proposalId: p.id,
    })
    for (const loser of losers) supersede(d, loser, winnerId, now)
  })
  const rechecks = await recheckReplaced(losers)
  return { message: t('Kept "{{text}}"', { text: quote(winner.text) }), revert: result.revert, rechecks }
}

/** Both are true under the condition: the proposal is approved with it, and every item gets a revision with it. */
async function keepBoth(conflictId: string, condition: string): Promise<Outcome> {
  const read = await readConflict(conflictId)
  const revisions = new Map<string, KnowledgeRevision>()
  for (const item of read.items) {
    revisions.set(item.id, await newRevision(item, { text: item.text, condition, by: 'user' }, 'user'))
  }
  const keptBoth = (now: number) => ({ at: now, by: 'user' as const, action: 'kept-both' as const, note: condition })

  const { revert } = await approve(read.proposal.id, {
    recheck: false,
    condition,
    resolving: {
      conflictId,
      apply: (d, item) => {
        const now = Date.now()
        settle(d, read, now)
        item.history.push(keptBoth(now))
        for (const old of read.items) {
          const draft = d.items.find((i) => i.id === old.id)
          const revision = revisions.get(old.id)
          if (!draft || !revision) continue
          draft.revisions.push(revision)
          draft.approvedRevisionId = revision.id
          draft.condition = condition
          draft.history.push(keptBoth(now))
          draft.updatedAt = now
        }
      },
    },
  })
  return { message: t('Kept both, with a condition'), revert, rechecks: [] }
}

/**
 * Settles an open conflict as the user chose, in one commit with one undo:
 * - `{ keep: id }` (the proposal's id or one of the conflict's items): that statement stands and the
 *   others are superseded; drafts and changes that used a superseded item get a re-check. `Kept "{text}"`.
 * - `{ keepBoth: condition }`: both stand under the trimmed condition. `Kept both, with a condition`.
 * Throws `missing` (no open conflict, or a choice outside it) and `condition-required` (blank condition).
 */
export async function resolveConflict(
  conflictId: string,
  choice: { keep: string } | { keepBoth: string }
): Promise<void> {
  let run: () => Promise<Outcome>
  if ('keepBoth' in choice) {
    const condition = choice.keepBoth.trim()
    if (!condition) throw new Error('condition-required')
    run = () => keepBoth(conflictId, condition)
  } else {
    const keep = choice.keep
    run = async () => {
      const conflict = (await readConflict(conflictId)).conflict
      return keep === conflict.proposalId ? keepProposal(conflictId) : keepItem(conflictId, keep)
    }
  }
  const { message, revert, rechecks } = await retryOnChange(run)
  pushKnowledgeUndo(message, revert, { onUndo: () => dismissRechecks(rechecks) })
}
