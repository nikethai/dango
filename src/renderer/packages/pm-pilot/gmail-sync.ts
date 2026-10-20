import {
  GMAIL_BACKFILL_DAYS,
  type GmailThread,
  normalizeGmailThread,
  type SourceRecord,
  type SyncCursor,
} from '@shared/pm-pilot'
import { FetchError, ofetch } from 'ofetch'

// Slice 10: read-only Gmail sync by history polling. Reads only; nothing here writes to Gmail.

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'
const THREAD_CONCURRENCY = 5
const DAY_MS = 86_400_000
/** Messages that are not mail the PM received or sent: Dango's own drafts among them. */
const SKIPPED_LABELS = ['DRAFT', 'SPAM', 'TRASH']

/** Gmail refused the token (401 or 403): the account needs signing in again. */
export class GmailAuthError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'GmailAuthError'
  }
}

/** `from:(@a.com OR x@b.com) OR to:(@a.com OR x@b.com)`; `''` when there are no matchers. */
export function buildMatcherQuery(matchers: string[]): string {
  // Whitespace, quotes, braces and parentheses would break out of the OR group.
  const cleaned = matchers.map((m) => m.toLowerCase().replace(/[\s()"{}]/g, ''))
  const terms = [...new Set(cleaned.filter((m) => m.length > 0))]
  if (terms.length === 0) return ''
  const list = terms.join(' OR ')
  return `from:(${list}) OR to:(${list})`
}

export type GmailSyncInput = {
  accountId: string
  accessToken: string
  cursor: SyncCursor | null
  /** `buildMatcherQuery` over every Gmail source on the account; `''` means nothing to backfill. */
  backfillQuery: string
  now?: number
  signal?: AbortSignal
}

export type GmailSyncResult = {
  records: SourceRecord[]
  cursor: SyncCursor
  /** True when this call pulled up to `GMAIL_BACKFILL_DAYS` of history (first sync or an expired history id). */
  backfilled: boolean
  /** The mailbox's own address, lower-cased, from `users/me/profile` (preflight R12). */
  ownAddress: string
}

type Profile = { emailAddress?: string; historyId?: string }
type MessageList = { messages?: Array<{ id: string; threadId: string }>; nextPageToken?: string }
type HistoryList = {
  history?: Array<{ messagesAdded?: Array<{ message?: { id?: string; threadId?: string } }> }>
  historyId?: string
  nextPageToken?: string
}

function statusOf(error: unknown): number | undefined {
  if (error instanceof FetchError) return error.status ?? error.response?.status
  return undefined
}

async function gmailGet<T>(
  token: string,
  path: string,
  query: Record<string, string | number | undefined>,
  signal?: AbortSignal
): Promise<T> {
  try {
    return await ofetch<T>(`${API}/${path}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      query,
      signal,
    })
  } catch (error) {
    const status = statusOf(error)
    if (status === 401 || status === 403) {
      throw new GmailAuthError(`Gmail refused the sign-in (${status})`, status)
    }
    throw error
  }
}

async function readProfile(token: string, signal?: AbortSignal): Promise<{ ownAddress: string; historyId: string }> {
  const profile = await gmailGet<Profile>(token, 'profile', {}, signal)
  if (!profile.historyId) throw new Error('Gmail profile has no history id')
  return { ownAddress: (profile.emailAddress ?? '').trim().toLowerCase(), historyId: profile.historyId }
}

async function listBackfillThreads(token: string, query: string, now: number, signal?: AbortSignal): Promise<string[]> {
  const after = Math.floor((now - GMAIL_BACKFILL_DAYS * DAY_MS) / 1000)
  const q = `after:${after} (${query})`
  const threadIds = new Set<string>()
  let pageToken: string | undefined
  do {
    const page = await gmailGet<MessageList>(token, 'messages', { q, maxResults: 500, pageToken }, signal)
    for (const m of page.messages ?? []) if (m.threadId) threadIds.add(m.threadId)
    pageToken = page.nextPageToken
  } while (pageToken)
  return [...threadIds]
}

/** Thread ids touched since `startHistoryId`, and the mailbox's history id now; null when the id has expired (404). */
async function listHistoryThreads(
  token: string,
  startHistoryId: string,
  signal?: AbortSignal
): Promise<{ threadIds: string[]; historyId: string } | null> {
  const threadIds = new Set<string>()
  let historyId = startHistoryId
  let pageToken: string | undefined
  try {
    do {
      const page = await gmailGet<HistoryList>(
        token,
        'history',
        { startHistoryId, historyTypes: 'messageAdded', maxResults: 500, pageToken },
        signal
      )
      for (const h of page.history ?? []) {
        for (const added of h.messagesAdded ?? []) {
          if (added.message?.threadId) threadIds.add(added.message.threadId)
        }
      }
      if (page.historyId) historyId = page.historyId
      pageToken = page.nextPageToken
    } while (pageToken)
  } catch (error) {
    if (statusOf(error) === 404) return null
    throw error
  }
  return { threadIds: [...threadIds], historyId }
}

/** Fetches threads `THREAD_CONCURRENCY` at a time. A thread deleted since it was listed (404) is skipped. */
async function fetchThreads(token: string, threadIds: string[], signal?: AbortSignal): Promise<GmailThread[]> {
  const threads: GmailThread[] = []
  let next = 0
  const worker = async () => {
    while (next < threadIds.length) {
      const id = threadIds[next++]
      try {
        threads.push(
          await gmailGet<GmailThread>(token, `threads/${encodeURIComponent(id)}`, { format: 'full' }, signal)
        )
      } catch (error) {
        if (statusOf(error) !== 404) throw error
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(THREAD_CONCURRENCY, threadIds.length) }, worker))
  return threads
}

/**
 * Normalises message by message: one message that throws is logged and skipped, and the thread's other messages
 * are kept (slice 10 T2 decision). Drafts (Dango's own included), spam and trash are left out.
 */
function toRecords(threads: GmailThread[], accountId: string, ownAddress: string): SourceRecord[] {
  const records: SourceRecord[] = []
  for (const thread of threads) {
    for (const message of thread.messages ?? []) {
      if (message.labelIds?.some((label) => SKIPPED_LABELS.includes(label))) continue
      try {
        records.push(...normalizeGmailThread({ ...thread, messages: [message] }, accountId, ownAddress))
      } catch (error) {
        console.warn(
          `[pm-pilot] Skipped Gmail message ${message.id} in thread ${thread.id}: it could not be read`,
          error instanceof Error ? error.name : 'Error'
        )
      }
    }
  }
  return records
}

/**
 * One Gmail mailbox poll. With no cursor, or a history id Gmail has expired, it backfills `GMAIL_BACKFILL_DAYS` of
 * mail matching `backfillQuery` (none when the query is empty) and starts the cursor at the profile's history id,
 * read before listing so nothing arriving meanwhile is missed. Otherwise it reads `history.list` for added messages
 * and returns every touched thread; routing decides what matters. Records are unrouted. The caller stores the cursor.
 * Throws `GmailAuthError` on 401/403; any other failure throws, so the caller keeps its old cursor and retries.
 */
export async function syncGmailMailbox(input: GmailSyncInput): Promise<GmailSyncResult> {
  const { accountId, accessToken: token, cursor, backfillQuery, signal } = input
  const now = input.now ?? Date.now()

  let ownAddress = cursor?.ownAddress ?? ''
  let threadIds: string[]
  let historyId: string
  let backfilled: boolean

  const incremental = cursor ? await listHistoryThreads(token, cursor.value, signal) : null
  if (incremental) {
    threadIds = incremental.threadIds
    historyId = incremental.historyId
    backfilled = false
    if (!ownAddress) ownAddress = (await readProfile(token, signal)).ownAddress
  } else {
    const profile = await readProfile(token, signal)
    ownAddress = profile.ownAddress
    historyId = profile.historyId
    threadIds = backfillQuery.trim() ? await listBackfillThreads(token, backfillQuery, now, signal) : []
    backfilled = true
  }

  const threads = await fetchThreads(token, threadIds, signal)
  return {
    records: toRecords(threads, accountId, ownAddress),
    cursor: { accountId, sourceKind: 'gmail', scope: 'mailbox', value: historyId, updatedAt: now, ownAddress },
    backfilled,
    ownAddress,
  }
}
