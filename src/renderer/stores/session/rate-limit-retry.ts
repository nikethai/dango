import type { Message, Session } from '@shared/types'
import { RETRY_DELAYS_MS } from '@shared/types/background'
import type { ReviewEntry } from '@shared/types/review'
import { t } from 'i18next'
import { getLogger } from '@/lib/utils'
import { scopeIdForSession } from '@/packages/chat-review'
import { classifyModelError, modelErrorProviderName } from '@/packages/model-errors/classify'
import {
  addReviewEntry,
  loadReviewEntries,
  registerReviewOpener,
  reviewRegistryStore,
  reviewStore,
  setReviewEntryState,
} from '@/packages/review'
import queryClient from '@/stores/queryClient'
import * as chatStore from '../chatStore'
import { settingsStore } from '../settingsStore'

const log = getLogger('rate-limit-retry')

/**
 * Rate-limited answers retry on their own (ER3): the provider's Retry-After when it sent one, else 10 s, 1 min, 5 min;
 * after the third failed retry the chat waits in Review as a Needs you entry. Timers live in memory: a reload, Stop, a
 * new send or deleting the chat drops the pending retry, and the notice then offers Retry instead of a countdown.
 */

type Pending = { messageId: string; timer: ReturnType<typeof setTimeout> }

/** One pending retry per chat: a new turn in the chat replaces or cancels it. */
const pending = new Map<string, Pending>()
/** Automatic retries already scheduled per failed message; cleared when the message gets an answer. */
const attempts = new Map<string, number>()
const listeners = new Set<() => void>()

function notify() {
  for (const listener of listeners) listener()
}

/** For the notice: re-render when a retry is scheduled, fires or is cancelled. */
export function subscribeRateLimitRetries(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function isRateLimitRetryPending(sessionId: string, messageId: string): boolean {
  return pending.get(sessionId)?.messageId === messageId
}

/** Wait before automatic retry number `attempt` (0-based): Retry-After when sent, else the schedule; null when done. */
export function rateLimitDelayMs(attempt: number, retryAfterMs?: number): number | null {
  if (attempt >= RETRY_DELAYS_MS.length) return null
  if (retryAfterMs !== undefined && Number.isFinite(retryAfterMs) && retryAfterMs > 0) return retryAfterMs
  return RETRY_DELAYS_MS[attempt]
}

/** Retry-After from the header, else Gemini's `"retryDelay": "41s"` in the body. */
function providerRetryAfterMs(msg: Message): number | undefined {
  const header = msg.errorExtra?.retryAfterMs
  if (typeof header === 'number') return header
  const body = msg.errorExtra?.responseBody
  if (typeof body !== 'string') return undefined
  const match = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/)
  return match ? Math.ceil(Number(match[1]) * 1000) : undefined
}

function providerName(msg: Message): string {
  const id =
    typeof msg.errorExtra?.aiProvider === 'string' && msg.errorExtra.aiProvider
      ? msg.errorExtra.aiProvider
      : msg.aiProvider
  return modelErrorProviderName(id, settingsStore.getState().customProviders) ?? t('AI provider')
}

async function patchErrorExtra(sessionId: string, messageId: string, patch: Record<string, unknown>): Promise<void> {
  await chatStore.updateMessage(sessionId, messageId, (m) => {
    if (!m?.error) return m as Message
    return { ...m, errorExtra: { ...m.errorExtra, ...patch } }
  })
}

function failedWithRateLimit(msg: Message | undefined): msg is Message {
  return Boolean(msg?.error) && !msg?.generating && classifyModelError(msg as Message) === 'rate-limit'
}

/** A plan execution run or a multi-agent room turn: a bare retry would lose its plan or room options (R18, R20). */
function needsItsOwnRun(msg: Message): boolean {
  return Boolean(msg.roomRole) || msg.contentParts.some((part) => part.type === 'plan' && part.status === 'approved')
}

async function fire(sessionId: string, messageId: string) {
  const session = await chatStore.getSession(sessionId)
  const latest = session?.messages.find((m) => m.id === messageId)
  // Answered, removed or already running again (Retry now): nothing to do.
  if (!failedWithRateLimit(latest)) return
  const { retryFailedMessage } = await import('./retry')
  await retryFailedMessage(sessionId, latest)
}

async function giveUp(sessionId: string, msg: Message) {
  await patchErrorExtra(sessionId, msg.id, { rateLimitGaveUp: true, retryAt: undefined })
  const session = await chatStore.getSession(sessionId)
  if (!session) return
  const provider = providerName(msg)
  // External text (provider and chat names) is substituted once and stored as plain text.
  const literal = { interpolation: { escapeValue: false } }
  await addReviewEntry({
    kind: 'needs-you',
    scopeId: scopeIdForSession(session),
    source: provider,
    text: t('{{provider}} is still limiting requests', { ...literal, provider }),
    sub: t('The chat "{{chat}}" is waiting for a retry.', { ...literal, chat: session.name }),
    actionLabel: 'Retry',
    ref: { type: 'chat', id: sessionId },
    chatId: sessionId,
  })
}

/**
 * After a rate-limited answer: retry it on schedule, or file the Needs you entry once retries are used up.
 * `autoRetry: false` (plan runs, room turns) goes to Review at once.
 */
export function scheduleRateLimitRetry(sessionId: string, msg: Message, options?: { autoRetry?: boolean }): void {
  cancelRateLimitRetry(sessionId)
  const attempt = attempts.get(msg.id) ?? 0
  const delay = options?.autoRetry === false ? null : rateLimitDelayMs(attempt, providerRetryAfterMs(msg))
  if (delay === null) {
    void giveUp(sessionId, msg).catch((error) => log.error('rate limit: Needs you entry failed', error))
    return
  }
  attempts.set(msg.id, attempt + 1)
  const timer = setTimeout(() => {
    if (pending.get(sessionId)?.timer !== timer) return
    pending.delete(sessionId)
    notify()
    void fire(sessionId, msg.id).catch((error) => log.error('rate limit: retry failed to start', error))
  }, delay)
  pending.set(sessionId, { messageId: msg.id, timer })
  notify()
  void patchErrorExtra(sessionId, msg.id, {
    rateLimitAttempt: attempt + 1,
    retryAt: Date.now() + delay,
    rateLimitGaveUp: undefined,
  }).catch((error) => log.error('rate limit: could not mark the message', error))
}

/** Stop, a new send, any new turn or deleting the chat: the pending retry never fires. */
export function cancelRateLimitRetry(sessionId: string): void {
  const entry = pending.get(sessionId)
  if (!entry) return
  clearTimeout(entry.timer)
  pending.delete(sessionId)
  notify()
}

/** The message got an answer (or the person asked again from Review): the next rate limit starts at 10 s again. */
export function clearRateLimitAttempts(messageId: string): void {
  attempts.delete(messageId)
}

/** After an answer in this chat: a Needs you entry left from an earlier rate limit is done (R22). */
export async function resolveRateLimitNeedsYou(sessionId: string): Promise<void> {
  if (!reviewStore.getState().loaded) await loadReviewEntries()
  const open = reviewStore
    .getState()
    .entries.some((e) => e.state === 'open' && e.ref.type === 'chat' && e.ref.id === sessionId)
  if (open) await setReviewEntryState({ ref: { type: 'chat', id: sessionId } }, 'done')
}

/** Review's Open on a rate-limit Needs you entry: go to the chat and retry its failed answer there. */
export async function openChatAndRetry(sessionId: string): Promise<void> {
  const session = await chatStore.getSession(sessionId)
  if (!session) {
    const { add } = await import('@/stores/toastActions')
    add(t('This chat was deleted.'))
    return
  }
  // crud pulls in the router: loaded on use, so the stores that cancel retries stay router-free.
  const { switchCurrentSession } = await import('./crud')
  switchCurrentSession(sessionId)
  const last = lastAssistant(session)
  if (!failedWithRateLimit(last) || needsItsOwnRun(last)) return
  cancelRateLimitRetry(sessionId)
  // The person asked: a fresh schedule if this fails again.
  clearRateLimitAttempts(last.id)
  const { retryFailedMessage } = await import('./retry')
  await retryFailedMessage(sessionId, last)
}

function lastAssistant(session: Session): Message | undefined {
  for (let i = session.messages.length - 1; i >= 0; i--) {
    if (session.messages[i].role === 'assistant') return session.messages[i]
  }
  return undefined
}

/** False only when the cached chat list is loaded and lacks the chat (deleted); unknown counts as present. */
function chatExists(chatId: string): boolean {
  const list = queryClient.getQueryData<{ id: string }[]>(chatStore.ChatQueryKeys.ChatSessionsList)
  return !list || list.some((s) => s.id === chatId)
}

/** Registers Review's 'chat' opener once (R23); returns the cleanup, a no-op when one was already registered. */
export function registerChatReviewOpener(): () => void {
  if (reviewRegistryStore.getState().openers.chat) return () => {}
  return registerReviewOpener('chat', (entry: ReviewEntry) => openChatAndRetry(entry.ref.id), {
    canOpen: (entry) => chatExists(entry.ref.id),
  })
}
