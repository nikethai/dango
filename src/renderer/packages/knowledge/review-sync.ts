import type { KnowledgeState } from '@shared/types/knowledge'
import type { ReviewEntryInput, ReviewRef, ReviewState } from '@shared/types/review'
import { t } from 'i18next'
import { getLogger } from '@/lib/utils'
import { addReviewEntry, setReviewEntryState } from '@/packages/review'
import { type CommitResult, onKnowledgeCommit } from './store'
import { quote } from './text'

const log = getLogger('knowledge')

// `reopen`: the entry may have been closed while the record stayed open (a proposal behind a conflict),
// so reopen it by ref before refreshing it, rather than adding a second one next to it.
type Target =
  | { entry: ReviewEntryInput; state: 'open'; reopen: boolean }
  | { ref: ReviewRef; state: Exclude<ReviewState, 'open'> }

const proposalRef = (id: string): ReviewRef => ({ type: 'proposal', id })
const conflictRef = (id: string): ReviewRef => ({ type: 'conflict', id })

/** What the Review entry for each touched proposal and conflict should be after this commit. */
function targetsFor(result: CommitResult, after: KnowledgeState, before: KnowledgeState): Target[] {
  const proposals = new Map(after.proposals.map((p) => [p.id, p]))
  const conflicts = new Map(after.conflicts.map((c) => [c.id, c]))
  const items = new Map(after.items.map((i) => [i.id, i]))
  const touchedItems = result.touched.items.map((id) => items.get(id)).filter((i) => i !== undefined)
  const openConflictOf = (proposalId: string) =>
    after.conflicts.find((c) => c.proposalId === proposalId && c.state === 'open')

  const targets: Target[] = []

  // A conflict's state decides its proposal's entry too, so check those proposals as well. A deleted
  // conflict is found in the document the commit read.
  const proposalIds = new Set(result.touched.proposals)
  const behindConflict = new Set<string>()
  for (const id of result.touched.conflicts) {
    const c = conflicts.get(id) ?? before.conflicts.find((x) => x.id === id)
    if (!c) continue
    proposalIds.add(c.proposalId)
    behindConflict.add(c.proposalId)
  }

  for (const id of result.touched.conflicts) {
    const c = conflicts.get(id)
    if (!c) {
      targets.push({ ref: conflictRef(id), state: 'dismissed' })
      continue
    }
    if (c.state === 'resolved') {
      targets.push({ ref: conflictRef(id), state: 'done' })
      continue
    }
    if (c.state === 'dismissed') {
      targets.push({ ref: conflictRef(id), state: 'dismissed' })
      continue
    }
    const old = items.get(c.itemIds[0])?.text ?? ''
    targets.push({
      state: 'open',
      reopen: result.reverted,
      entry: {
        kind: 'conflict',
        ref: conflictRef(id),
        scopeId: c.scopeId,
        text: proposals.get(c.proposalId)?.text ?? '',
        sub: t('Saved: "{{old}}"', { old: quote(old) }),
      },
    })
  }

  for (const id of proposalIds) {
    const p = proposals.get(id)
    if (!p) {
      // Approve and dismiss both delete the proposal; an item approved from it tells them apart (preflight C7).
      const approved = touchedItems.some((i) => i.proposalId === id)
      targets.push({ ref: proposalRef(id), state: approved ? 'done' : 'dismissed' })
      continue
    }
    if (openConflictOf(id)) {
      targets.push({ ref: proposalRef(id), state: 'dismissed' })
      continue
    }
    const source = p.sources[0]?.label
    targets.push({
      state: 'open',
      reopen: result.reverted || behindConflict.has(id),
      entry: {
        kind: 'proposal',
        ref: proposalRef(id),
        scopeId: p.scopeId,
        text: p.text,
        ...(source !== undefined ? { source } : {}),
      },
    })
  }
  return targets
}

async function apply(target: Target): Promise<void> {
  if (target.state !== 'open') {
    await setReviewEntryState({ ref: target.ref }, target.state)
    return
  }
  // A revert brings a record back, and a proposal whose conflict closed comes out from behind it: reopen
  // the old entry rather than adding a second one (preflight C7). `addReviewEntry` then refreshes the
  // reopened entry's fields, or creates one if there was none.
  if (target.reopen) await setReviewEntryState({ ref: target.entry.ref }, 'open')
  await addReviewEntry(target.entry)
}

async function sync(result: CommitResult, after: KnowledgeState, before: KnowledgeState): Promise<void> {
  for (const target of targetsFor(result, after, before)) {
    try {
      await apply(target)
    } catch (error) {
      log.error('Knowledge review sync failed:', error)
    }
  }
}

/** Keeps Review entries in step with proposals and conflicts after every commit. Returns the unsubscribe. */
export function startReviewSync(): () => void {
  return onKnowledgeCommit(sync)
}
