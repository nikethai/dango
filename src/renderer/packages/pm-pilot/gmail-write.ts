import {
  buildReplyMime,
  type ClientDraft,
  DRAFT_LABEL,
  type GmailThread,
  isPlainAddress,
  parseAddresses,
} from '@shared/pm-pilot'
import { gmailRequest, gmailStatus } from './gmail-http'

// Slice 10: the only Gmail writes Dango makes: a label and a draft in the client's thread. Nothing here sends;
// `gmailRequest` refuses `messages/send`, `drafts/send` and `messages/import` outright.

/** The draft is addressed to someone who is not on the thread. Nothing was written. */
export class GmailRecipientError extends Error {
  constructor() {
    super('The reply is addressed to someone who is not on the Gmail thread')
    this.name = 'GmailRecipientError'
  }
}

type Label = { id?: string; name?: string }
type DraftResource = { id?: string; message?: { id?: string; threadId?: string } }

/** Label ids per token and name. Tokens change on refresh, so only the newest few are kept. */
const labelCache = new Map<string, Map<string, Promise<string>>>()
const LABEL_CACHE_TOKENS = 8

function cacheFor(token: string): Map<string, Promise<string>> {
  let byName = labelCache.get(token)
  if (!byName) {
    byName = new Map()
    labelCache.set(token, byName)
    while (labelCache.size > LABEL_CACHE_TOKENS) labelCache.delete(labelCache.keys().next().value as string)
  }
  return byName
}

async function listLabelId(token: string, name: string): Promise<string | undefined> {
  const { labels } = await gmailRequest<{ labels?: Label[] }>(token, 'GET', 'labels')
  const all = labels ?? []
  const match = all.find((l) => l.name === name) ?? all.find((l) => l.name?.toLowerCase() === name.toLowerCase())
  return match?.id
}

async function findOrCreateLabel(token: string, name: string): Promise<string> {
  const existing = await listLabelId(token, name)
  if (existing) return existing
  try {
    const created = await gmailRequest<Label>(token, 'POST', 'labels', {
      body: { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' },
    })
    if (created.id) return created.id
  } catch (error) {
    // Another window created it meanwhile.
    if (gmailStatus(error) !== 409) throw error
  }
  const raced = await listLabelId(token, name)
  if (!raced) throw new Error('Gmail did not return the label id')
  return raced
}

/** The id of the user label `name`, created when missing. Cached per token; a failed lookup is not cached. */
export function ensureLabel(token: string, name: string): Promise<string> {
  const byName = cacheFor(token)
  const cached = byName.get(name)
  if (cached) return cached
  const pending = findOrCreateLabel(token, name)
  byName.set(name, pending)
  pending.catch(() => {
    if (byName.get(name) === pending) byName.delete(name)
  })
  return pending
}

/** The label's id without creating it: undo never adds a label. */
function existingLabelId(token: string, name: string): Promise<string | undefined> {
  const cached = labelCache.get(token)?.get(name)
  if (cached) return cached.catch(() => undefined)
  return listLabelId(token, name)
}

/** Every From/To/Cc address on the thread, read from Gmail itself rather than from the draft. */
async function threadParticipants(token: string, threadId: string): Promise<Set<string>> {
  const thread = await gmailRequest<GmailThread>(token, 'GET', `threads/${encodeURIComponent(threadId)}`, {
    query: { format: 'metadata', metadataHeaders: ['From', 'To', 'Cc'] },
  })
  const out = new Set<string>()
  for (const message of thread.messages ?? []) {
    for (const header of message.payload?.headers ?? []) {
      if (/^(from|to|cc)$/i.test(header.name)) for (const a of parseAddresses(header.value)) out.add(a)
    }
  }
  return out
}

async function modifyThreadLabels(
  token: string,
  threadId: string,
  change: { addLabelIds: string[] } | { removeLabelIds: string[] }
): Promise<void> {
  await gmailRequest(token, 'POST', `threads/${encodeURIComponent(threadId)}/modify`, { body: change })
}

function warnLabel(what: string, error: unknown): void {
  console.warn(`[pm-pilot] Could not ${what} the Gmail thread label`, error instanceof Error ? error.name : 'Error')
}

/**
 * Writes `draft` into its Gmail thread as an unsent draft, then labels the thread `DRAFT_LABEL`. The draft goes
 * only to plain addresses already on the thread (checked against Gmail, never trusting `draft.to` alone), less the
 * mailbox's own `from`; otherwise `GmailRecipientError` and nothing is written. A failed label is logged and the draft kept. Never sends.
 */
export async function writeDraft(
  token: string,
  draft: ClientDraft,
  from: string
): Promise<{ gmailDraftId: string; gmailMessageId?: string }> {
  const own = new Set(parseAddresses(from.replace(/[\r\n]+/g, ' ')))
  const recipients = parseAddresses(draft.to.replace(/[\r\n]+/g, ' ')).filter((a) => !own.has(a))
  if (recipients.length === 0 || !recipients.every(isPlainAddress)) throw new GmailRecipientError()
  const participants = await threadParticipants(token, draft.threadId)
  if (recipients.some((a) => !participants.has(a))) throw new GmailRecipientError()

  const raw = buildReplyMime({
    from,
    to: recipients.join(', '),
    subject: draft.subject,
    inReplyTo: draft.inReplyTo,
    body: draft.text,
  })
  const created = await gmailRequest<DraftResource>(token, 'POST', 'drafts', {
    body: { message: { raw, threadId: draft.threadId } },
  })
  if (!created.id) throw new Error('Gmail did not return the draft id')

  try {
    await modifyThreadLabels(token, draft.threadId, { addLabelIds: [await ensureLabel(token, DRAFT_LABEL)] })
  } catch (error) {
    warnLabel('add', error)
  }
  // Without the message id, undo cannot prove the draft is untouched and keeps it.
  return created.message?.id
    ? { gmailDraftId: created.id, gmailMessageId: created.message.id }
    : { gmailDraftId: created.id }
}

/**
 * Takes back a draft Dango wrote, only when Gmail still holds the very message Dango wrote. A draft the user has
 * edited in Gmail has a new message id and is kept (`'kept-edited'`, nothing deleted); so is one whose written
 * message id was never recorded. A draft already deleted or sent is `'already-gone'`. Otherwise the draft is
 * deleted and the thread label removed (`'removed'`). Other failures throw and nothing is deleted.
 */
export async function undoDraft(
  token: string,
  draft: ClientDraft
): Promise<'removed' | 'kept-edited' | 'already-gone'> {
  if (!draft.gmailDraftId) return 'already-gone'
  const path = `drafts/${encodeURIComponent(draft.gmailDraftId)}`
  let current: DraftResource
  try {
    current = await gmailRequest<DraftResource>(token, 'GET', path, { query: { format: 'minimal' } })
  } catch (error) {
    if (gmailStatus(error) === 404) return 'already-gone'
    throw error
  }
  if (!draft.gmailMessageId || current.message?.id !== draft.gmailMessageId) return 'kept-edited'

  try {
    await gmailRequest(token, 'DELETE', path)
  } catch (error) {
    if (gmailStatus(error) === 404) return 'already-gone'
    throw error
  }
  try {
    const labelId = await existingLabelId(token, DRAFT_LABEL)
    if (labelId) await modifyThreadLabels(token, draft.threadId, { removeLabelIds: [labelId] })
  } catch (error) {
    warnLabel('remove', error)
  }
  return 'removed'
}
