import {
  type ClientDraft,
  type Evidence,
  type FactChange,
  factsDiffer,
  mayReachCloud,
  parseFactChanges,
  type SourceRecord,
  sentDiffText,
  validateFactChanges,
} from '@shared/pm-pilot'
import i18n from '@/i18n'
import { errorClassName, localOnlySourceIds, resolveBackgroundModel } from './background-model'
import {
  getScope,
  gmailConfig,
  listReviewEntries,
  listSources,
  loadSources,
  proposeKnowledge,
  setReviewEntryState,
  updateReviewEntry,
} from './bridge'
import { buildFactDiffPrompt } from './prompts'
import { pmStore } from './store'

/*
 * Flow 10 step 5: when the PM sends a reply in a thread Dango drafted for, the facts the sent text changed become
 * knowledge proposals the PM approves in Review. Nothing from Gmail is approved here (ADR 0001): only
 * `proposeKnowledge`. The sent text is the record's new text (the normaliser cut the quoted inbound). The model sees
 * the draft and the sent text as data, and its list of changes is checked against both texts before anything is
 * proposed. Logs carry fixed text and error class names only, never mail text.
 */

function warn(what: string, e?: unknown): void {
  const name = errorClassName(e)
  console.warn(`[pm-pilot] ${what}`, ...(name ? [name] : []))
}

/**
 * One model call listing the facts `sent` changed from `draft`; only changes `validateFactChanges` keeps. Never throws:
 * no usable model, a failed call or an unreadable reply give `[]`. On a cloud model nothing is sent unless every id in
 * `sourceIds` names a source that is not local-only (an empty list or a missing id is unknown, so refused) and every
 * `evidence` item the draft was built from may reach the cloud (ADR 0003).
 */
export async function phraseFactChanges(input: {
  draft: string
  sent: string
  scopeName: string
  /** The sources the draft and the sent text came from. */
  sourceIds?: Array<string | null | undefined>
  /** The draft's evidence. */
  evidence?: Evidence[]
  localOnlySourceIds?: Set<string>
}): Promise<FactChange[]> {
  try {
    const model = await resolveBackgroundModel()
    if (!model) return []
    if (model.cloud) {
      const localOnly = await localOnlySourceIds(input.localOnlySourceIds)
      const ids = input.sourceIds ?? []
      const sourcesOk = ids.length > 0 && ids.every((id) => !!id && !localOnly.has(id))
      if (!sourcesOk || !(input.evidence ?? []).every((e) => mayReachCloud(e, localOnly))) {
        warn('Sent reply not compared: its mailbox stays on this device')
        return []
      }
    }
    const { system, user } = buildFactDiffPrompt(input.scopeName, input.draft, input.sent)
    const parsed = parseFactChanges(await model.generate(system, user))
    if (!parsed) {
      warn('Sent reply not compared: the model reply could not be read')
      return []
    }
    return validateFactChanges(parsed, { draft: input.draft, sent: input.sent })
  } catch (e) {
    warn('Sent reply not compared: the model call failed', e)
    return []
  }
}

/** The Gmail sources a draft's thread came from: this account's, on the draft's scope. Empty when none is known. */
async function draftSourceIds(draft: ClientDraft): Promise<string[]> {
  await loadSources()
  return listSources({ scopeId: draft.scopeId, kind: 'gmail' })
    .filter((s) => gmailConfig(s).accountId === draft.accountId)
    .map((s) => s.id)
}

/**
 * Proposes each fact the sent reply changed, as slice 4 knowledge for the draft's scope (slice 4 adds the Proposal or
 * Conflict entry). No model call when the texts state the same facts. A plain proposal gets the sent-reply note as its
 * entry's sub; a conflicting one keeps slice 4's copy, and one slice 4 declines (null) gets nothing. Returns how many
 * proposals were filed.
 */
export async function proposeFactChanges(input: {
  draft: ClientDraft
  sentText: string
  sentRecord?: SourceRecord
  scopeName: string
}): Promise<number> {
  const { draft, sentText, sentRecord, scopeName } = input
  if (!factsDiffer(draft.text, sentText)) return 0
  const fromDraft = await draftSourceIds(draft)
  const changes = await phraseFactChanges({
    draft: draft.text,
    sent: sentText,
    scopeName,
    // Unknown origins stay in the list as `undefined`, so a cloud model refuses them.
    sourceIds: [sentRecord?.sourceId, ...(fromDraft.length > 0 ? fromDraft : [undefined])],
    evidence: draft.evidence,
  })
  let filed = 0
  for (const change of changes) {
    const source = {
      kind: 'email' as const,
      label: i18n.t('your sent reply'),
      ...(sentRecord ? { ref: sentRecord.link.url } : {}),
      ...(sentRecord?.sourceId ? { sourceId: sentRecord.sourceId } : {}),
    }
    const proposal = await proposeKnowledge({
      scopeId: draft.scopeId,
      kind: 'fact',
      text: change.fact,
      sources: [source],
      origin: 'background-review',
    })
    if (!proposal) continue
    filed++
    if (proposal.conflictsWith?.length) continue
    const entry = listReviewEntries({ states: ['open'] }).find(
      (e) => e.ref.type === 'proposal' && e.ref.id === proposal.id
    )
    if (!entry) continue
    await updateReviewEntry(entry.id, {
      sub: sentDiffText(scopeName, change.sentSaid, change.draftSaid, change.what, (key, values) =>
        i18n.t(key, values)
      ),
    })
  }
  return filed
}

/**
 * Reads back the PM's sent replies. Only records Gmail labelled `SENT` count (`sentByMe`): inbound mail never does,
 * whatever its From says. For each, oldest first, when its thread's newest draft is `written` or `proposed`, belongs
 * to the same account and is older than the reply: propose the changed facts, then mark the draft `sent` (written) or
 * `dismissed` (only proposed, its Review entry closed). A draft is read back once, so a second run proposes nothing.
 */
export async function readBackSent(records: SourceRecord[]): Promise<void> {
  const sent = records.filter((r) => r.sentByMe && r.sourceKind === 'gmail').sort((a, b) => a.occurredAt - b.occurredAt)
  for (const record of sent) {
    const draft = await pmStore.findDraftByThread(record.threadOrTaskId)
    if (!draft || (draft.state !== 'written' && draft.state !== 'proposed')) continue
    if (draft.accountId !== record.accountId || draft.createdAt >= record.occurredAt) continue
    try {
      const scope = await getScope(draft.scopeId)
      if (scope) await proposeFactChanges({ draft, sentText: record.text, sentRecord: record, scopeName: scope.name })
    } catch (e) {
      warn('Sent reply facts could not be proposed', e)
    }
    if (draft.state === 'written') {
      await pmStore.saveDraft({ ...draft, state: 'sent' })
    } else {
      await pmStore.saveDraft({ ...draft, state: 'dismissed' })
      await setReviewEntryState({ ref: { type: 'draft', id: draft.id } }, 'dismissed')
    }
  }
}
