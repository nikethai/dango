// A11Y1 rule 1 (slice 09 Task 9): what the one polite live region says for a turn. Pure, so the throttle and the
// once-only final answer are tested without timers; TurnAnnouncer calls it on a 1 s tick.

import type { Message } from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import { t } from 'i18next'
import { rollingSummary, THINKING_ANNOUNCE_MS } from '@/packages/thinking/thinking'

export type AnnouncerState = { lastSpokenAt: number | null; final: boolean }

/**
 * A turn first seen while generating is followed; one already finished (opening a chat, switching sessions) starts
 * final, so the last answer is never read aloud on open.
 */
export function initialAnnouncerState(message: Message | undefined): AnnouncerState {
  return { lastSpokenAt: null, final: !message?.generating }
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

function firstLine(text: string): string {
  return (
    text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? ''
  )
}

/** Seconds since the turn started thinking: the first reasoning part's start, else the message time. */
function secondsSinceStart(m: Message, now: number): number {
  const started = m.contentParts?.find((p) => p.type === 'reasoning' && p.startTime)
  const origin = (started?.type === 'reasoning' ? started.startTime : undefined) ?? m.timestamp ?? now
  return Math.max(0, Math.floor((now - origin) / 1000))
}

/**
 * The next thing to say for this turn, or null. While generating: at most every 5 s, "Thinking…" with the last
 * reasoning line until answer text exists, then "Writing the answer…". When generating ends: the answer once, its
 * error's first line when there is no answer, else "Stopped before answering."; then final and silent forever.
 * A turn that failed with only an error code ends final with empty text (nothing to say, nothing more to come).
 */
export function nextAnnouncement(
  m: Message,
  s: AnnouncerState,
  now: number
): { text: string; state: AnnouncerState } | null {
  if (s.final) return null
  if (!m.generating) {
    const state = { lastSpokenAt: now, final: true }
    const answer = answerText(m)
    if (answer) return { text: answer, state }
    if (m.error?.trim()) return { text: firstLine(m.error), state }
    if (m.errorCode !== undefined) return { text: '', state }
    return { text: t('Stopped before answering.'), state }
  }
  if (s.lastSpokenAt !== null && now - s.lastSpokenAt < THINKING_ANNOUNCE_MS) return null
  const count = secondsSinceStart(m, now)
  const state = { lastSpokenAt: now, final: false }
  if (answerText(m)) return { text: t('Writing the answer, {{count}} seconds', { count }), state }
  const reasoning = m.contentParts?.filter((p) => p.type === 'reasoning').at(-1)
  const summary = reasoning?.type === 'reasoning' ? rollingSummary(reasoning.text) : ''
  const text = summary
    ? t('Thinking, {{count}} seconds, {{summary}}', { count, summary })
    : t('Thinking, {{count}} seconds', { count })
  return { text, state }
}
