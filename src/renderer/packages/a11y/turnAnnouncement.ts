// A11Y1 rule 1 (slice 09 Task 9): what the one polite live region says for a turn. Pure, so the throttle and the
// once-only final answer are tested without timers; TurnAnnouncer calls it on a 1 s tick.

import type { Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { t } from 'i18next'
import { rollingSummary, THINKING_ANNOUNCE_MS } from '@/packages/thinking/thinking'

export type AnnouncerState = {
  lastSpokenAt: number | null
  final: boolean
  /** The visible timer's origin (the turn's live start), when known. */
  startedAt?: number
  /** Answer text and last reasoning already there when following started (a resumed run keeps the stopped run's). */
  baseAnswer?: string
  baseReasoning?: string
}

/**
 * A turn first seen while generating is followed from its start; one already finished (opening a chat, switching
 * sessions) starts final, so the last answer is never read aloud on open. `startedAt` is the turn's live start, the
 * visible timer's origin (`getLiveGenerationStartedAt`).
 */
export function initialAnnouncerState(message: Message | undefined, startedAt?: number): AnnouncerState {
  if (!message?.generating) return { lastSpokenAt: null, final: true }
  return { lastSpokenAt: null, final: false, startedAt }
}

/**
 * A finished message that generates again (Continue on a stopped plan keeps the stopped run's parts): what is already
 * there is the old run's, so only new reasoning and new answer text count.
 */
export function resumedAnnouncerState(message: Message, startedAt?: number): AnnouncerState {
  return {
    lastSpokenAt: null,
    final: false,
    startedAt,
    baseAnswer: answerText(message),
    baseReasoning: lastReasoning(message),
  }
}

const FENCE_LINE = /^\s*(```|~~~)/
const TABLE_SEPARATOR = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/

/** Markdown as it reads aloud: code blocks named, images dropped, links as their text, no syntax characters. */
export function plainTextForSpeech(markdown: string): string {
  const lines: string[] = []
  let inFence = false
  for (const raw of markdown.split(/\r?\n/)) {
    if (FENCE_LINE.test(raw)) {
      if (!inFence) lines.push(t('Code block.'))
      inFence = !inFence
      continue
    }
    if (inFence || TABLE_SEPARATOR.test(raw)) continue
    const line = raw
      .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^\s*(?:>\s*)+/, '')
      .replace(/^\s*#{1,6}(?=\s|$)/, '')
      .replace(/[`*]/g, '')
      .replace(/(^|[^\p{L}\p{N}])_+|_+(?=[^\p{L}\p{N}]|$)/gu, '$1')
      .replace(/\|/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (line) lines.push(line)
  }
  return lines.join('\n')
}

/** Answer text as spoken; a lone streaming placeholder counts as no answer yet. */
function answerText(m: Message): string {
  const text = plainTextForSpeech(getMessageText(m, false, false))
  return text === '...' || text === '…' ? '' : text
}

function lastReasoning(m: Message): string {
  const part = m.contentParts?.filter((p) => p.type === 'reasoning').at(-1)
  return part?.type === 'reasoning' ? part.text : ''
}

/** Seconds on the visible timer: from the live start, else the first reasoning part's start, else the message time. */
function secondsSinceStart(m: Message, s: AnnouncerState, now: number): number {
  const started = m.contentParts?.find((p) => p.type === 'reasoning' && p.startTime)
  const origin = s.startedAt ?? (started?.type === 'reasoning' ? started.startTime : undefined) ?? m.timestamp ?? now
  return Math.max(0, Math.floor((now - origin) / 1000))
}

/** A Swarm plan or task turn: folded away in the thread; the captain's deliver turn is the one that answers. */
function isSwarmWorkerTurn(m: Message): boolean {
  return Boolean(m.swarm?.runId && (m.roomRole === 'plan' || m.roomRole === 'do') && !m.swarm.note)
}

/**
 * The next thing to say for this turn, or null. While generating: at most every 5 s, "Thinking…" with the last new
 * reasoning line until new answer text exists, then "Writing the answer…". When generating ends: the answer once, else
 * "Stopped before answering."; then final and silent forever. Final with empty text (nothing to say) when the turn
 * failed (ModelErrorNotice's role="alert" says the error in plain words) or is a Swarm plan or task turn (the captain
 * still answers, even after Stop). `live`: the turn is still registered as running (Thinking and Stop show), so a
 * stored message that briefly reads as not generating is not yet stopped.
 */
export function nextAnnouncement(
  m: Message,
  s: AnnouncerState,
  now: number,
  live = false
): { text: string; state: AnnouncerState } | null {
  if (s.final) return null
  if (!m.generating) {
    const state = { lastSpokenAt: now, final: true }
    if (m.error?.trim() || m.errorCode !== undefined || isSwarmWorkerTurn(m)) return { text: '', state }
    const answer = answerText(m)
    if (answer) return { text: answer, state }
    if (live) return null
    return { text: t('Stopped before answering.'), state }
  }
  if (s.lastSpokenAt !== null && now - s.lastSpokenAt < THINKING_ANNOUNCE_MS) return null
  const count = secondsSinceStart(m, s, now)
  const state = { ...s, lastSpokenAt: now }
  const answer = answerText(m)
  if (answer && answer !== (s.baseAnswer ?? '')) {
    return { text: t('Writing the answer, {{count}} seconds', { count }), state }
  }
  const reasoning = lastReasoning(m)
  const summary = reasoning && reasoning !== s.baseReasoning ? rollingSummary(reasoning) : ''
  const text = summary
    ? t('Thinking, {{count}} seconds, {{summary}}', { count, summary })
    : t('Thinking, {{count}} seconds', { count })
  return { text, state }
}
