import type { DontSuggestEntry, KnowledgeConflict, KnowledgeProposal, KnowledgeState } from '@shared/types/knowledge'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { t } from 'i18next'
import { v4 as uuidv4 } from 'uuid'
import { checkAgainstLayers } from './contradictions'
import { getScopeReads } from './scopes'
import { commitKnowledge, ensureKnowledgeLoaded, knowledgeStore } from './store'
import { knowledgeTextKey, quote } from './text'
import { pushKnowledgeUndo } from './undo'

/** A second dismissal of the same text in the same scope within this window offers "Don't suggest this again". */
export const DONT_SUGGEST_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

const unique = (ids: string[]) => [...new Set(ids)]

/** Where a proposal of this kind lives: preferences always in Everywhere (ADR 0013). */
function targetScopeOf(input: { kind: KnowledgeProposal['kind']; scopeId: string }): string {
  return input.kind === 'preference' ? EVERYWHERE_SCOPE_ID : input.scopeId
}

/**
 * On the Don't suggest list (this scope or Everywhere), already approved there (or in Everywhere, when it
 * applies to the scope), or already proposed there.
 * `skipDontSuggest`: a user's own add ignores the list (preflight C8).
 */
function isKnownText(state: KnowledgeState, textKey: string, scopeId: string, skipDontSuggest = false): boolean {
  // What the scope already answers from: its own items, and (except for a user's own add) the Everywhere
  // preferences, plus Everywhere facts and decisions when it reads them.
  const readsFacts = scopeId !== EVERYWHERE_SCOPE_ID && getScopeReads(scopeId).facts
  const applies = (i: KnowledgeState['items'][number]) =>
    i.scopeId === scopeId ||
    (!skipDontSuggest && i.scopeId === EVERYWHERE_SCOPE_ID && (i.kind === 'preference' || readsFacts))
  return (
    (!skipDontSuggest &&
      state.dontSuggest.some(
        (e) => e.textKey === textKey && (e.scopeId === scopeId || e.scopeId === EVERYWHERE_SCOPE_ID)
      )) ||
    state.items.some((i) => i.status === 'approved' && applies(i) && knowledgeTextKey(i.text) === textKey) ||
    state.proposals.some((p) => p.scopeId === scopeId && knowledgeTextKey(p.text) === textKey)
  )
}

/**
 * Files a proposal (background write: no undo). Returns `null` and stores nothing when the text is on the
 * Don't suggest list, already approved, or already proposed in the target scope. Otherwise it is checked
 * against the scope and Everywhere; a same-scope contradiction also opens a conflict. Review entries
 * follow from the commit (review-sync). A failed check stores a plain proposal without `checkedAt`.
 */
export async function proposeKnowledge(
  input: Omit<KnowledgeProposal, 'id' | 'createdAt'>
): Promise<KnowledgeProposal | null> {
  return (await fileProposal(input))?.proposal ?? null
}

/**
 * `proposeKnowledge`, plus the commit's `revert` (so `addKnowledge` can undo the proposal too).
 * Internal: `skipDontSuggest` lets a user's own add past the Don't suggest list (preflight C8).
 */
export async function fileProposal(
  input: Omit<KnowledgeProposal, 'id' | 'createdAt'>,
  opts?: { skipDontSuggest?: boolean }
): Promise<{ proposal: KnowledgeProposal; revert: () => Promise<void> } | null> {
  const skip = opts?.skipDontSuggest === true
  const scopeId = targetScopeOf(input)
  const textKey = knowledgeTextKey(input.text)
  if (!textKey) return null
  await ensureKnowledgeLoaded({ fresh: true })
  if (isKnownText(knowledgeStore.getState().state, textKey, scopeId, skip)) return null

  const check = await checkAgainstLayers({
    text: input.text,
    targetScopeId: scopeId,
    ...(input.sessionId !== undefined ? { sessionId: input.sessionId } : {}),
    sources: input.sources,
  })
  const conflictsWith = unique([...(input.conflictsWith ?? []), ...check.conflictsWith])
  const overrides = unique([...(input.overrides ?? []), ...check.overrides])
  const now = Date.now()
  const { conflictsWith: _c, overrides: _o, checkedAt: _k, ...rest } = input
  const proposal: KnowledgeProposal = {
    ...rest,
    id: uuidv4(),
    scopeId,
    createdAt: now,
    ...(conflictsWith.length ? { conflictsWith } : {}),
    ...(overrides.length ? { overrides } : {}),
    ...(check.ok ? { checkedAt: now } : {}),
  }

  let stored = false
  const result = await commitKnowledge((d) => {
    // The check took a while; another window may have filed or approved the same text meanwhile.
    if (isKnownText(d, textKey, scopeId, skip)) return
    d.proposals.push(proposal)
    if (conflictsWith.length) {
      d.conflicts.push({
        id: uuidv4(),
        scopeId,
        proposalId: proposal.id,
        itemIds: conflictsWith,
        state: 'open',
        createdAt: now,
      })
    }
    stored = true
  })
  return stored ? { proposal, revert: result.revert } : null
}

/** Adds a Don't suggest entry unless one for this text and scope exists. Returns whether it added one. */
function addDontSuggest(d: KnowledgeState, p: Pick<KnowledgeProposal, 'text' | 'scopeId'>, now: number): boolean {
  const textKey = knowledgeTextKey(p.text)
  if (d.dontSuggest.some((e) => e.textKey === textKey && e.scopeId === p.scopeId)) return false
  d.dontSuggest.push({ id: uuidv4(), scopeId: p.scopeId, text: p.text, textKey, addedAt: now })
  return true
}

// Dismissed proposals of this window, so the toast's "Don't suggest this again" works after the proposal
// is gone. Each keeps the undo of its dismissal, so the follow-up's undo can take both back.
const recentlyDismissed = new Map<string, { proposal: KnowledgeProposal; revert: () => Promise<void> }>()
const RECENT_MAX = 20

function remember(id: string, proposal: KnowledgeProposal, revert: () => Promise<void>) {
  recentlyDismissed.delete(id)
  recentlyDismissed.set(id, { proposal, revert })
  if (recentlyDismissed.size > RECENT_MAX) {
    const oldest = recentlyDismissed.keys().next().value
    if (oldest !== undefined) recentlyDismissed.delete(oldest)
  }
}

const dismissedMessage = (text: string) => t('Dismissed "{{text}}"', { text: quote(text) })

/**
 * Removes the proposal, records the dismissal, closes its open conflict and pushes `Dismissed "{text}"`.
 * A repeat dismissal of the same text in the same scope within `DONT_SUGGEST_WINDOW_MS` offers
 * "Don't suggest this again" on the toast. With `dontSuggestAgain`, the text also goes on the
 * Don't suggest list (once, however often it is called, also after the proposal is gone).
 */
export async function dismissProposal(
  id: string,
  opts?: { dontSuggestAgain?: boolean }
): Promise<{ offerDontSuggest: boolean }> {
  const dontSuggestAgain = opts?.dontSuggestAgain === true
  let dismissed: KnowledgeProposal | undefined
  let offerDontSuggest = false
  let addedEntry = false

  const result = await commitKnowledge((d) => {
    const p = d.proposals.find((x) => x.id === id)
    const now = Date.now()
    if (!p) {
      // Already dismissed (the toast's follow-up): only the Don't suggest entry is left to add.
      const recent = recentlyDismissed.get(id)
      if (dontSuggestAgain && recent) addedEntry = addDontSuggest(d, recent.proposal, now)
      return
    }
    dismissed = { ...p }
    const textKey = knowledgeTextKey(p.text)
    // Dismissals older than the window can never offer anything again: prune them.
    d.dismissals = d.dismissals.filter((x) => now - x.at < DONT_SUGGEST_WINDOW_MS)
    offerDontSuggest = d.dismissals.some((x) => x.textKey === textKey && x.scopeId === p.scopeId)
    d.proposals = d.proposals.filter((x) => x.id !== id)
    d.dismissals.push({ textKey, scopeId: p.scopeId, at: now })
    for (const c of d.conflicts) {
      if (c.proposalId === id && c.state === 'open') c.state = 'dismissed'
    }
    if (dontSuggestAgain) addedEntry = addDontSuggest(d, p, now)
  })

  if (dismissed) {
    const proposal = dismissed
    remember(id, proposal, result.revert)
    const extra =
      offerDontSuggest && !dontSuggestAgain
        ? { label: t("Don't suggest this again"), onClick: () => void dismissProposal(id, { dontSuggestAgain: true }) }
        : undefined
    pushKnowledgeUndo(dismissedMessage(proposal.text), result.revert, extra ? { extra } : undefined)
    return { offerDontSuggest }
  }

  const recent = recentlyDismissed.get(id)
  if (addedEntry && recent) {
    // The follow-up replaces the dismissal's undo record; its undo takes back both commits.
    const undoDismiss = recent.revert
    const revertBoth = async () => {
      await result.revert()
      await undoDismiss()
    }
    remember(id, recent.proposal, revertBoth)
    pushKnowledgeUndo(dismissedMessage(recent.proposal.text), revertBoth)
  }
  return { offerDontSuggest: false }
}

/** Not now: the proposal stays, marked deferred; its Review entry stays open. */
export async function deferProposal(id: string): Promise<void> {
  await commitKnowledge((d) => {
    const p = d.proposals.find((x) => x.id === id)
    if (p) p.deferred = true
  })
}

export type ProposalListOptions = { scopeId?: string; messageId?: string }

/** Open proposals (deferred included), oldest first. Pure, so hooks and `listProposals` share it. */
export function selectProposals(state: KnowledgeState, opts?: ProposalListOptions): KnowledgeProposal[] {
  return state.proposals
    .filter(
      (p) =>
        (opts?.scopeId === undefined || p.scopeId === opts.scopeId) &&
        (opts?.messageId === undefined || p.messageId === opts.messageId)
    )
    .sort((a, b) => a.createdAt - b.createdAt)
}

/** Open proposals (deferred included), oldest first. */
export function listProposals(opts?: ProposalListOptions): KnowledgeProposal[] {
  return selectProposals(knowledgeStore.getState().state, opts)
}

export function getConflict(id: string): KnowledgeConflict | undefined {
  return knowledgeStore.getState().state.conflicts.find((c) => c.id === id)
}

/**
 * A chat moved scope: its proposals follow (preferences stay in Everywhere). A moved proposal loses the
 * old scope's check (conflicts dismissed, `conflictsWith`, `overrides` and `checkedAt` cleared), so
 * approving it checks it against the new scope. One whose text the target scope already knows (approved,
 * proposed or on the Don't suggest list) is dropped instead. Returns how many moved.
 */
export async function moveProposalsForSession(sessionId: string, toScopeId: string): Promise<number> {
  let moved = 0
  await commitKnowledge((d) => {
    const dropped = new Set<string>()
    for (const p of d.proposals) {
      if (p.sessionId !== sessionId || p.kind === 'preference' || p.scopeId === toScopeId) continue
      if (isKnownText(d, knowledgeTextKey(p.text), toScopeId)) {
        dropped.add(p.id)
        for (const c of d.conflicts) {
          if (c.proposalId === p.id && c.state === 'open') c.state = 'dismissed'
        }
        continue
      }
      p.scopeId = toScopeId
      delete p.conflictsWith
      delete p.overrides
      delete p.checkedAt
      for (const c of d.conflicts) {
        if (c.proposalId === p.id && c.state === 'open') c.state = 'dismissed'
      }
      moved += 1
    }
    if (dropped.size) d.proposals = d.proposals.filter((p) => !dropped.has(p.id))
  })
  return moved
}

/** The Don't suggest list, newest first. */
export function listDontSuggest(): DontSuggestEntry[] {
  return [...knowledgeStore.getState().state.dontSuggest].sort((a, b) => b.addedAt - a.addedAt)
}

/** Takes a text off the Don't suggest list. */
export async function allowSuggestAgain(id: string): Promise<void> {
  await commitKnowledge((d) => {
    d.dontSuggest = d.dontSuggest.filter((e) => e.id !== id)
  })
}
