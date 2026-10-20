import {
  type ClientDraft,
  type ClientQuestion,
  type CopyFormat,
  DAILY_DRAFT_CAP,
  demoteUnsupported,
  doneDraftPatch,
  draftProposalEntry,
  type Evidence,
  entryShapeForTier,
  inboundMayReachCloud,
  inertValues,
  type Judgement,
  mayReachCloud,
  needsYouEntry,
  type SourceRecord,
  tierFor,
} from '@shared/pm-pilot'
import { v4 as uuidv4 } from 'uuid'
import i18n from '@/i18n'
import { errorClassName, localOnlySourceIds, resolveBackgroundModel } from './background-model'
import {
  addReviewEntry,
  applyReviewEntry,
  getScope,
  listReviewEntries,
  type ReviewEntry,
  recordKnowledgeUse,
  registerReviewApplier,
  registerReviewOpener,
  type Scope,
  subscribeReviewEntries,
  updateReviewEntry,
} from './bridge'
import { GmailAuthError, GmailRateLimitError, GmailRequestError } from './gmail-http'
import { GmailRecipientError, undoDraft, writeDraft } from './gmail-write'
import { buildDraftPrompt } from './prompts'
import { LocalOnlyModelError } from './retrieve'
import { proposeFactChanges } from './sent-readback'
import { pmStore } from './store'
import { getFreshToken } from './tokens'

/*
 * Slice 10, Task 8: act on a judged client thread by tier, and the one path that writes a draft into Gmail
 * (`draftApplier`). Nothing here sends: the only Gmail calls are `writeDraft` and `undoDraft`. Trust is slice 5's: a
 * safe proposal may arrive done through `addReviewEntry`, which calls the applier registered by `initPmReview`.
 *
 * - The draft's recipient is the inbound message's From, never anything the model wrote.
 * - The judge's answer and summary and the written draft are model text: they reach entries only as inert
 *   interpolation values (rendered as plain text), and a URL or address in them that the cited evidence lacks keeps
 *   the entry from being safe (`demoteUnsupported`).
 * - `apply` never changes the entry's text or sub on success: slice 5 marks the row Done only when they are unchanged
 *   (preflight R1). The Done copy is written afterwards, by `actOnThread` or by the watcher `initPmReview` starts.
 * - Logs carry fixed text and error class names only, never mail text.
 */

const format: CopyFormat = (key, values) => i18n.t(key, values) as string
const t = (key: string) => i18n.t(key) as string

function warn(what: string, e?: unknown): void {
  const name = errorClassName(e)
  console.warn(`[pm-pilot] ${what}`, ...(name ? [name] : []))
}

/** The thread in Gmail, in the mailbox's own account when its address is known (several accounts signed in). */
function threadUrl(threadId: string, ownAddress?: string): string {
  const account = ownAddress ? `?authuser=${encodeURIComponent(ownAddress)}` : ''
  return `https://mail.google.com/mail/${account}#all/${encodeURIComponent(threadId)}`
}

// ---------------------------------------------------------------------------------------------------------------------
// The draft text

/** Characters of a written draft; a longer reply is cut. */
export const DRAFT_MAX_CHARS = 4_000

export const DRAFT_NO_MODEL = 'No model is set up'
export const DRAFT_EMPTY = 'The model wrote no reply'
export const DRAFT_FAILED = 'The model call failed'

/** The model's reply as a plain email body: a leading reasoning block and an outer fence removed, length capped. */
function cleanReply(raw: string): string {
  let text = raw.trim()
  if (/^<think>/i.test(text)) {
    const close = text.search(/<\/think>/i)
    text = close >= 0 ? text.slice(close + '</think>'.length).trim() : ''
  }
  text = text
    .replace(/^```[a-z]*\s*\n?/i, '')
    .replace(/\n?\s*```$/, '')
    .trim()
  return text.length > DRAFT_MAX_CHARS ? text.slice(0, DRAFT_MAX_CHARS).trimEnd() : text
}

/**
 * The reply body for `inbound`, in the language of the client's message, grounded only on `answer` and `evidence`
 * (pass the cited evidence). The background model is the only one tried (preflight R8). With a cloud model, an inbound
 * record or evidence that may not reach the cloud refuses before any call (`LocalOnlyModelError`, ADR 0003). The body
 * lists no sources, since it reaches the client. Throws when there is no model, the call fails or the reply is empty.
 */
export async function writeDraftText(input: {
  inbound: SourceRecord
  answer: string
  evidence: Evidence[]
  localOnlySourceIds?: Set<string>
}): Promise<string> {
  const model = await resolveBackgroundModel()
  if (!model) throw new Error(DRAFT_NO_MODEL)
  if (model.cloud) {
    const localOnly = await localOnlySourceIds(input.localOnlySourceIds)
    if (!inboundMayReachCloud(input.inbound, localOnly) || !input.evidence.every((e) => mayReachCloud(e, localOnly))) {
      throw new LocalOnlyModelError()
    }
  }
  const { system, user } = buildDraftPrompt(input.inbound, input.answer, input.evidence)
  let raw: string
  try {
    raw = await model.generate(system, user)
  } catch (e) {
    const name = errorClassName(e)
    throw new Error(name ? `${DRAFT_FAILED} (${name})` : DRAFT_FAILED)
  }
  const text = cleanReply(raw)
  if (!text) throw new Error(DRAFT_EMPTY)
  return text
}

// ---------------------------------------------------------------------------------------------------------------------
// Acting on a thread

/** Entry ids being added by `actOnThread`: an apply of one of these is a Trust Auto arrival, which the cap governs. */
const arriving = new Set<string>()

async function ask(input: {
  scope: Scope
  inbound: SourceRecord
  judgement: Judgement
  evidence: Evidence[]
  localOnlyBlocked: boolean
  now: number
}): Promise<'asked'> {
  const { scope, inbound, judgement, evidence, localOnlyBlocked, now } = input
  if (await pmStore.findOpenQuestion({ threadId: inbound.threadOrTaskId })) return 'asked'
  const byId = new Map(evidence.map((e) => [e.id, e]))
  const candidates = localOnlyBlocked
    ? []
    : judgement.candidates.map((c) => {
        const cited = c.evidenceIds.flatMap((id) => byId.get(id) ?? [])
        const newest = cited.reduce<Evidence | undefined>((a, e) => (!a || e.date > a.date ? e : a), undefined)
        return {
          value: c.value,
          ...(newest ? { date: newest.date } : {}),
          sourceLabel: newest?.label ?? '',
          evidenceIds: c.evidenceIds,
        }
      })
  const entryId = uuidv4()
  const question: ClientQuestion = {
    id: uuidv4(),
    kind: localOnlyBlocked ? 'choose-model' : 'which-answer',
    ...(inbound.sourceId ? { sourceId: inbound.sourceId } : {}),
    scopeId: scope.id,
    accountId: inbound.accountId,
    threadId: inbound.threadOrTaskId,
    subject: inbound.title,
    from: inbound.author,
    summary: judgement.summary,
    candidates,
    reviewEntryId: entryId,
    state: 'open',
    createdAt: now,
  }
  await pmStore.saveQuestion(question)
  await addReviewEntry({ ...needsYouEntry(question, scope.name, format), id: entryId })
  return 'asked'
}

/**
 * Turns a judged inbound Gmail message into a Review entry. `fyi` and `noise` are ignored. Low, or a local-only block,
 * adds one Needs you entry and its question. Otherwise the reply is written, saved as a proposed draft addressed to the
 * inbound From, and added as a proposal (safe for High under the daily cap, else risky); when Trust Auto applied it on
 * arrival, the Done copy is written onto the entry. A second run for the same message adds nothing.
 */
export async function actOnThread(input: {
  scope: Scope
  inbound: SourceRecord
  judgement: Judgement
  evidence: Evidence[]
  localOnlyBlocked: boolean
}): Promise<'drafted' | 'asked' | 'ignored'> {
  const { scope, inbound, judgement, evidence, localOnlyBlocked } = input
  if (judgement.intent !== 'question' || inbound.sourceKind !== 'gmail') return 'ignored'
  const existing = (await pmStore.listDraftsByThread(inbound.threadOrTaskId)).find(
    (d) => d.inboundMessageId === inbound.externalId && d.accountId === inbound.accountId
  )
  if (existing) return 'drafted'

  const now = Date.now()
  const cited = evidence.filter((e) => judgement.evidenceIds.includes(e.id))
  const citedTexts = cited.map((e) => e.text)
  let tier = demoteUnsupported(tierFor(judgement), judgement.answer ?? '', citedTexts)
  // Counted before the model call, so a cap filled meanwhile is caught when the draft is applied.
  const draftsToday = await pmStore.countDraftsToday(now)
  if (entryShapeForTier({ tier, draftsToday, localOnlyBlocked }).kind === 'needs-you') {
    return ask({ scope, inbound, judgement, evidence, localOnlyBlocked, now })
  }

  const text = await writeDraftText({ inbound, answer: judgement.answer ?? '', evidence: cited })
  tier = demoteUnsupported(tier, text, citedTexts)
  const shape = entryShapeForTier({ tier, draftsToday, localOnlyBlocked })
  const entryId = uuidv4()
  const draft: ClientDraft = {
    id: uuidv4(),
    scopeId: scope.id,
    accountId: inbound.accountId,
    ...(inbound.sourceId ? { sourceId: inbound.sourceId } : {}),
    threadId: inbound.threadOrTaskId,
    inboundMessageId: inbound.externalId,
    // The inbound From only; `writeDraft` checks it against the thread again.
    to: inbound.author,
    subject: inbound.title,
    ...(inbound.rfcMessageId ? { inReplyTo: inbound.rfcMessageId } : {}),
    text,
    answer: judgement.answer ?? '',
    evidence: cited,
    state: 'proposed',
    reviewEntryId: entryId,
    createdAt: now,
  }
  await pmStore.saveDraft(draft)

  arriving.add(entryId)
  let entry: ReviewEntry
  try {
    entry = await addReviewEntry({ ...draftProposalEntry(draft, format), ...shape, id: entryId })
  } finally {
    arriving.delete(entryId)
  }
  if (entry.kind === 'done') await patchDoneCopy(entry)
  return 'drafted'
}

// ---------------------------------------------------------------------------------------------------------------------
// The applier

/**
 * Gmail refused the request (4xx) or Dango refused before calling: no draft was created. A 5xx or a network failure
 * proves nothing (Gmail may have created the draft), so those keep the write marker.
 */
function refusedBeforeWrite(error: unknown): boolean {
  return (
    error instanceof GmailRecipientError ||
    error instanceof GmailAuthError ||
    error instanceof GmailRateLimitError ||
    (error instanceof GmailRequestError && error.status !== undefined && error.status >= 400 && error.status < 500)
  )
}

async function recordUses(draft: ClientDraft): Promise<void> {
  const ids = draft.evidence.filter((e) => e.id.startsWith('k:')).map((e) => e.id.slice(2))
  if (ids.length === 0) return
  try {
    await recordKnowledgeUse(ids, {
      type: 'draft',
      id: draft.id,
      label: i18n.t('Reply to "{{subject}}"', inertValues({ subject: draft.subject })) as string,
    })
  } catch (e) {
    warn('Knowledge uses of a draft could not be recorded', e)
  }
}

/** The facts the user's edit changed, proposed against the original draft. A failure is logged, never thrown. */
async function proposeEdit(original: ClientDraft, edited: string): Promise<void> {
  try {
    const scope = await getScope(original.scopeId)
    if (scope) await proposeFactChanges({ draft: original, sentText: edited, scopeName: scope.name })
  } catch (e) {
    warn('Facts in an edited draft could not be proposed', e)
  }
}

async function apply(e: ReviewEntry): Promise<void> {
  const now = Date.now()
  // Checked and marked in one step under the store lock, so two windows never both write this draft.
  const claim = await pmStore.claimDraftWrite(e.ref.id, now)
  if (!claim.ok) {
    if (claim.reason === 'written') return
    if (claim.reason === 'interrupted') {
      // An earlier write was cut off and Gmail may hold it: tell the user once rather than write a second copy.
      await updateReviewEntry(e.id, {
        sub: t('This reply may already be in Gmail. Check the thread before you apply again.'),
      })
      throw new Error('An earlier write may have reached Gmail')
    }
    if (claim.reason === 'in-progress') throw new Error('This draft is being written to Gmail')
    throw new Error('The draft can no longer be applied')
  }
  const original = claim.draft
  // An edit is only what the edit sheet stored on the draft, never inferred from the row's text.
  const body = original.editedText ?? original.text
  const edited = body !== original.text && body.trim() !== ''
  const next: ClientDraft = edited ? { ...original, text: body } : original
  const release = () => pmStore.settleDraftWrite(original.id, now, {})

  const auto = arriving.has(e.id)
  let token: Awaited<ReturnType<typeof getFreshToken>>
  try {
    if (auto && !(await pmStore.tryBumpDraftsToday(now, DAILY_DRAFT_CAP))) {
      await release()
      await updateReviewEntry(e.id, { risk: 'risky' })
      throw new Error('Today’s draft limit is reached')
    }
    token = await getFreshToken(original.accountId)
  } catch (error) {
    await release()
    throw error
  }
  if (!token.ok) {
    await release()
    throw new Error('Gmail needs signing in again')
  }

  const from = (await pmStore.getCursor(original.accountId, 'gmail', 'mailbox'))?.ownAddress ?? ''
  let ids: { gmailDraftId: string; gmailMessageId?: string }
  try {
    ids = await writeDraft(token.token, next, from)
  } catch (error) {
    if (refusedBeforeWrite(error)) await release()
    if (error instanceof GmailRecipientError) {
      await updateReviewEntry(e.id, { sub: t('Not in Gmail: the reply would go to someone who is not on the thread') })
    }
    throw error
  }
  const written: ClientDraft = {
    ...next,
    gmailDraftId: ids.gmailDraftId,
    gmailMessageId: ids.gmailMessageId,
    state: 'written',
    reviewEntryId: e.id,
    editedText: undefined,
  }
  await pmStore.settleDraftWrite(original.id, now, written)
  if (!auto) await pmStore.bumpDraftsToday(now)
  await recordUses(written)
  if (edited) await proposeEdit(original, body)
}

async function undo(e: ReviewEntry): Promise<void> {
  const draft = await pmStore.getDraft(e.ref.id)
  if (!draft) return
  if (draft.state === 'sent') throw new Error('The reply was sent')
  if (draft.state !== 'written') return
  const token = await getFreshToken(draft.accountId)
  if (!token.ok) throw new Error('Gmail needs signing in again')
  const keepLabel = (await pmStore.listDraftsByThread(draft.threadId)).some(
    (d) => d.id !== draft.id && d.state === 'written' && d.accountId === draft.accountId
  )
  const result = await undoDraft(token.token, draft, { keepLabel })
  // The PM edited it in Gmail: their words stay, and slice 1b says "Couldn't undo. The change stays."
  if (result === 'kept-edited') throw new Error('kept-edited')
  const undone: ClientDraft = { ...draft, state: 'undone', gmailDraftId: undefined, gmailMessageId: undefined }
  await pmStore.saveDraft(undone)
  // Back to the waiting copy before slice 5 turns the row back into a proposal.
  const waiting = draftProposalEntry(undone, format)
  await updateReviewEntry(e.id, { text: waiting.text, sub: waiting.sub, source: waiting.source })
}

/** The one path that writes a draft into Gmail and the one that takes it back. */
export const draftApplier = { apply, undo }

/**
 * Applies a waiting draft with the user's edited text, as the edit sheet's Apply (preflight R2). The edit is stored on
 * the draft and on the row first, so a failed Apply keeps it (Cancel changes nothing only before the first Apply).
 * The current row and draft are read again: an entry already Done or a draft already written is not written again
 * (true), and a row that is no longer an open proposal is left alone (false). The apply uses the stored row, so a sub
 * changed by an earlier attempt does not make slice 5 take the write back.
 */
export async function applyEditedDraft(e: ReviewEntry, text: string): Promise<boolean> {
  const draft = await pmStore.getDraft(e.ref.id)
  const current = listReviewEntries().find((x) => x.id === e.id)
  if (draft?.state === 'written' || current?.kind === 'done') return true
  if (!draft || (current && (current.kind !== 'proposal' || current.state !== 'open'))) return false
  if (!(await pmStore.setDraftEdit(draft.id, text))) return false
  const updated = await updateReviewEntry(e.id, { text })
  if (!updated || updated.kind !== 'proposal' || updated.state !== 'open') return updated?.kind === 'done'
  return applyReviewEntry(updated, { silent: false, message: t('Reply drafted in Gmail') })
}

// ---------------------------------------------------------------------------------------------------------------------
// The Done copy, the opener and registration

/** Patches in flight per entry id; a second caller awaits the first. */
const patching = new Map<string, Promise<void>>()

/** Writes the RV1 Done copy onto a Done draft row whose draft is in Gmail and whose copy is not yet the Done one. */
function patchDoneCopy(e: ReviewEntry): Promise<void> {
  const pending = patching.get(e.id)
  if (pending) return pending
  const run = (async () => {
    const draft = await pmStore.getDraft(e.ref.id)
    if (draft?.state !== 'written') return
    const patch = doneDraftPatch(draft, format)
    const current = listReviewEntries().find((x) => x.id === e.id) ?? e
    if (current.kind !== 'done' || (current.text === patch.text && current.sub === patch.sub)) return
    // Again just before writing: an undo may have taken the draft back meanwhile.
    if ((await pmStore.getDraft(e.ref.id))?.state !== 'written') return
    await updateReviewEntry(e.id, patch)
  })().finally(() => patching.delete(e.id))
  patching.set(e.id, run)
  return run
}

/**
 * Done (or a Re-check on a draft's knowledge) opens the Gmail thread. A waiting draft opens the edit sheet in the main
 * window; any other window opens the thread instead (preflight R11).
 */
export async function openDraftEntry(e: ReviewEntry): Promise<void> {
  const draft = await pmStore.getDraft(e.ref.id)
  if (!draft) return
  if (e.kind === 'proposal' && e.state === 'open') {
    const { getWindowRole } = await import('@/platform/windowRole')
    if ((await getWindowRole()) === 'jobs') {
      const [{ default: NiceModal }, { DraftEditModal }] = await Promise.all([
        import('@ebay/nice-modal-react'),
        import('./DraftEditSheet'),
      ])
      void NiceModal.show(DraftEditModal, { entry: e })
      return
    }
  }
  const { default: platform } = await import('@/platform')
  const ownAddress = (await pmStore.getCursor(draft.accountId, 'gmail', 'mailbox'))?.ownAddress
  await platform.openLink(threadUrl(draft.threadId, ownAddress))
}

/** Registers the `'draft'` applier and opener, and keeps Done draft rows on the Done copy. Returns the cleanup. */
export function initPmReview(): () => void {
  const offApplier = registerReviewApplier('draft', draftApplier)
  const offOpener = registerReviewOpener('draft', openDraftEntry)
  const doneSub = t('Draft is in the thread, not sent')
  const offWatch = subscribeReviewEntries((entries) => {
    for (const e of entries) {
      if (e.ref.type !== 'draft' || e.kind !== 'done' || e.state !== 'done' || e.sub === doneSub) continue
      void patchDoneCopy(e).catch((error) => warn('The Done copy of a draft could not be written', error))
    }
  })
  return () => {
    offWatch()
    offOpener()
    offApplier()
  }
}
