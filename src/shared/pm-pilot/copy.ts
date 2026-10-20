import type { ReviewEntryInput } from '@shared/types/review'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import dayjs from 'dayjs'
import type { CopyFormat } from './fact-diff'
import { inertValues } from './i18n-values'
import type { ClientDraft, ClientQuestion } from './types'

/*
 * The Global Constraints copy for slice 10's Review entries and the CH6 chat opening. Pure. Each string is its own
 * translation key; pass `i18n.t` as `format` to translate (the default fills English). Subjects, names, labels,
 * summaries, answers and draft text are external or model text: they are only ever interpolation values, made inert
 * with `inertValues`, and rendered as plain text, never inside `<Trans>`.
 */

const english: CopyFormat = (key, values) => key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '')

const fill = (format: CopyFormat, key: string, values: Record<string, string> = {}) => format(key, inertValues(values))

const dayMonth = (at: number) => dayjs(at).format('D MMM')

const COUNT_WORDS: Record<number, string> = { 2: 'two', 3: 'three', 4: 'four' }

/** `two`, `three`, `four`, then digits. */
export function countWord(n: number, format: CopyFormat = english): string {
  const word = COUNT_WORDS[n]
  return word ? format(word, {}) : String(n)
}

/** `a`, `a and b`, `a, b and c`. */
export function joinLabels(labels: string[], format: CopyFormat = english): string {
  if (labels.length <= 1) return labels[0] ?? ''
  return fill(format, '{{list}} and {{last}}', {
    list: labels.slice(0, -1).join(', '),
    last: labels[labels.length - 1],
  })
}

const evidenceLabels = (d: ClientDraft) => [...new Set(d.evidence.map((e) => e.label))]

/** A waiting draft: the body as text, `Apply` as the action. Shape (`kind`, `risk`) comes from `entryShapeForTier`. */
export function draftProposalEntry(d: ClientDraft, format: CopyFormat = english): ReviewEntryInput {
  return {
    kind: 'proposal',
    scopeId: d.scopeId,
    source: fill(format, 'Gmail thread "{{subject}}"', { subject: d.subject }),
    text: d.text,
    sub: fill(format, 'Not in Gmail yet · per {{labels}}', { labels: joinLabels(evidenceLabels(d), format) }),
    ref: { type: 'draft', id: d.id },
    actionLabel: format('Apply', {}),
  }
}

/** RV1 Done copy, written onto the entry once the draft is in Gmail. */
export function doneDraftPatch(d: ClientDraft, format: CopyFormat = english): { text: string; sub: string } {
  return {
    text: fill(format, 'Reply drafted in Gmail: {{answer}}, per {{labels}}.', {
      answer: d.answer,
      labels: joinLabels(evidenceLabels(d), format),
    }),
    sub: format('Draft is in the thread, not sent', {}),
  }
}

function candidateFound(q: ClientQuestion, format: CopyFormat): string {
  return joinLabels(
    q.candidates.map((c) =>
      c.date === undefined ? c.value : fill(format, '{{value}} ({{date}})', { value: c.value, date: dayMonth(c.date) })
    ),
    format
  )
}

/** The Needs you entry for a question. `scopeName` fills the Asana project and local-only copy. */
export function needsYouEntry(q: ClientQuestion, scopeName = '', format: CopyFormat = english): ReviewEntryInput {
  const base = {
    kind: 'needs-you' as const,
    scopeId: q.scopeId ?? EVERYWHERE_SCOPE_ID,
    ref: { type: 'question' as const, id: q.id },
    actionLabel: format('Answer', {}),
  }
  switch (q.kind) {
    case 'which-client':
      return {
        ...base,
        source: format('Gmail', {}),
        text: format('Which client is this?', {}),
        sub: fill(format, '{{from}} · "{{subject}}"', { from: q.from, subject: q.subject }),
      }
    case 'which-project':
      return {
        ...base,
        source: format('Asana', {}),
        text: fill(format, 'Which Asana project is {{scope}}?', { scope: scopeName }),
        options: q.candidates.map((c) => ({ id: c.scopeId ?? c.value, text: c.value })),
      }
    case 'choose-model':
      return {
        ...base,
        source: format('Gmail', {}),
        text: fill(format, '{{scope}} Gmail stays on this device. Choose a local model to draft replies.', {
          scope: scopeName,
        }),
        actionLabel: format('Choose a model', {}),
      }
    case 'which-answer':
      if (q.candidates.length >= 2) {
        return {
          ...base,
          source: fill(format, '{{count}} candidates', { count: countWord(q.candidates.length, format) }),
          text: fill(format, '{{summary}} I found {{found}}. Which is current?', {
            summary: q.summary,
            found: candidateFound(q, format),
          }),
        }
      }
      return {
        ...base,
        source: format('no answer found', {}),
        text: fill(format, "{{summary}} I couldn't find the answer.", { summary: q.summary }),
      }
  }
}

/** The CH6 chat's opening assistant message: the candidates, one per line, then what happens with the answer. */
export function ch6Opening(q: ClientQuestion, scopeName: string, format: CopyFormat = english): string {
  const lines = [
    fill(format, "{{summary}} I found {{count}} answers and can't tell which is current:", {
      summary: q.summary,
      count: countWord(q.candidates.length, format),
    }),
    ...q.candidates.map((c) =>
      c.date === undefined
        ? fill(format, '{{value}} · {{source}}', { value: c.value, source: c.sourceLabel })
        : fill(format, '{{value}} · {{date}} · {{source}}', {
            value: c.value,
            date: dayMonth(c.date),
            source: c.sourceLabel,
          })
    ),
    fill(format, "Pick one, or type the answer. I'll save it for {{scope}} and draft the reply.", { scope: scopeName }),
  ]
  return lines.join('\n')
}
