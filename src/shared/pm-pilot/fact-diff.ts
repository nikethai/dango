import { jsonOf } from './judge'

/*
 * Sent replies read back (flow 10 step 5). Pure. `extractFactTokens` pulls the facts a reply states (dates, numbers,
 * names) so a reworded reply with the same facts costs no model call. The model's list of changes is untrusted:
 * `validateFactChanges` keeps a change only when the value it says the draft gave is in the draft, the value it says
 * was sent is in the sent text, and the fact it proposes states the sent value (Review Focus 3), with lengths capped.
 */

export type FactTokens = { dates: string[]; numbers: string[]; names: string[] }
export type FactChange = { what: string; fact: string; draftSaid: string; sentSaid: string }

export const FACT_CHANGE_MAX_ITEMS = 5
export const FACT_CHANGE_MAX_WHAT_CHARS = 60
export const FACT_CHANGE_MAX_FACT_CHARS = 300
export const FACT_CHANGE_MAX_SAID_CHARS = 120

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
}
const MONTH =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'
const ORDINAL = '(?:st|nd|rd|th)?'
const YEAR = '(?:,?\\s+\\d{4}(?![\\p{L}\\p{N}]))?'

// Each pattern captures day and month (in that order, or month first where named). Years are consumed, not kept.
const DATE_PATTERNS: Array<{ re: RegExp; dayMonth: (m: string[]) => [string, string] }> = [
  {
    re: /(?<![\p{L}\p{N}])(?:ngày\s+)?(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s*(?:năm|,)?\s*\d{4})?/giu,
    dayMonth: (m) => [m[1], m[2]],
  },
  {
    re: new RegExp(`(?<![\\p{L}\\p{N}])(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH}(?![\\p{L}])\\.?${YEAR}`, 'giu'),
    dayMonth: (m) => [m[1], m[2]],
  },
  {
    re: new RegExp(`(?<![\\p{L}\\p{N}])${MONTH}\\.?\\s+(\\d{1,2})${ORDINAL}(?![\\p{L}\\p{N}])${YEAR}`, 'giu'),
    dayMonth: (m) => [m[2], m[1]],
  },
  {
    re: /(?<![\p{N}/.-])(\d{1,2})\/(\d{1,2})(?:\/(?:\d{4}|\d{2}))?(?![\p{N}/])/gu,
    dayMonth: (m) => [m[1], m[2]],
  },
]

function monthNumber(token: string): number {
  return /^\d+$/.test(token) ? Number(token) : (MONTHS[token.toLowerCase().slice(0, 3)] ?? 0)
}

const NOT_NAMES = new Set(
  [
    // Months and weekdays, full and short.
    'january',
    'february',
    'march',
    'april',
    'may',
    'june',
    'july',
    'august',
    'september',
    'october',
    'november',
    'december',
    'jan',
    'feb',
    'mar',
    'apr',
    'jun',
    'jul',
    'aug',
    'sep',
    'sept',
    'oct',
    'nov',
    'dec',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
    'sunday',
    'mon',
    'tue',
    'tues',
    'wed',
    'thu',
    'thur',
    'thurs',
    'fri',
    'sat',
    'sun',
    // Greetings and sign-off words.
    'hi',
    'hello',
    'hey',
    'dear',
    'thanks',
    'thank',
    'best',
    'regards',
    'cheers',
    'chào',
    'kính',
    'gửi',
    'trân',
    'cảm',
    // Vietnamese date words.
    'ngày',
    'tháng',
    'thứ',
  ].map((w) => w.normalize('NFC'))
)

const GREETING_LINE =
  /^(?:hi|hello|hey|dear|good (?:morning|afternoon|evening)|chào|xin chào|kính gửi|gửi)(?![\p{L}])[^.?\d\n]{0,40}$/iu
const SIGN_OFF =
  /^(?:best regards|best wishes|kind regards|warm regards|many thanks|thanks again|thank you|best|regards|thanks|cheers|trân trọng|xin cảm ơn|cảm ơn|thân ái)(?![\p{L}])/iu
const SIGN_OFF_REST = /^[,.!]*(?:\s+(?:anh|chị|em|bạn))?(?:\s+\p{Lu}[\p{L}'.-]*){0,3}[,.!]*$/u

/** The text a reply's facts come from: no greeting line and nothing from a sign-off line on. */
function factText(text: string): string {
  const lines = text.normalize('NFC').replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex((l) => l.trim() !== '')
  if (first >= 0 && GREETING_LINE.test(lines[first].trim())) lines[first] = ''
  const cut = lines.findIndex((l) => {
    const line = l.trim()
    const m = SIGN_OFF.exec(line)
    return !!m && SIGN_OFF_REST.test(line.slice(m[0].length))
  })
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n')
}

/** True when the word at `index` starts a sentence (text start, a new line, or after `.`, `!` or `?`). */
function startsSentence(text: string, index: number): boolean {
  for (let i = index - 1; i >= 0; i--) {
    const c = text[i]
    if (c === '\n' || c === '.' || c === '!' || c === '?') return true
    if (!/[\s"'“”‘’([{*•-]/u.test(c)) return false
  }
  return true
}

const sorted = (values: Iterable<string>) => [...new Set(values)].sort()

/**
 * Dates (`6 Nov`, `Nov 6`, `6/11`, `ngày 6 tháng 11` → `6-11`), numbers of two or more digits with `,` and `.`
 * removed (not the digits of a date), and capitalised words that neither start a sentence nor name a month, weekday
 * or greeting. A greeting line and everything from a sign-off line on are ignored.
 */
export function extractFactTokens(text: string): FactTokens {
  const prepared = factText(text)
  const dates: string[] = []
  let rest = prepared
  for (const { re, dayMonth } of DATE_PATTERNS) {
    rest = rest.replace(re, (whole: string, ...args: unknown[]) => {
      // The groups come before the offset and the whole string (no named groups).
      const match = [whole, ...args.slice(0, -2)] as string[]
      const [d, m] = dayMonth(match)
      const day = Number(d)
      const month = monthNumber(m)
      if (day < 1 || day > 31 || month < 1 || month > 12) return whole
      dates.push(`${day}-${month}`)
      return ' '
    })
  }
  const numbers = (rest.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,]/g, '')).filter((n) => n.length >= 2)
  const names: string[] = []
  for (const m of prepared.matchAll(/(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+(?![\p{L}\p{N}])/gu)) {
    if (NOT_NAMES.has(m[0].toLowerCase()) || startsSentence(prepared, m.index ?? 0)) continue
    names.push(m[0])
  }
  return { dates: sorted(dates), numbers: sorted(numbers), names: sorted(names) }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

/** True when the two texts state different dates, numbers or names. */
export function factsDiffer(a: string, b: string): boolean {
  const x = extractFactTokens(a)
  const y = extractFactTokens(b)
  return !sameList(x.dates, y.dates) || !sameList(x.numbers, y.numbers) || !sameList(x.names, y.names)
}

/** The Global Constraints copy for a sent-reply proposal's sub; also its translation key. */
export const SENT_DIFF_COPY = 'You told {{scope}} {{sent}}; the draft said {{draft}}. Save {{sent}} as the {{what}}?'

export type CopyFormat = (key: string, values: Record<string, string>) => string

const english: CopyFormat = (key, values) => key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => values[name] ?? '')

/**
 * `You told {scope name} {sent}; the draft said {draft}. Save {sent} as the {what}?` The values are external text
 * (scope name, mail, model output) and stay plain values: pass `i18n.t` as `format` to translate, never `<Trans>`.
 */
export function sentDiffText(scopeName: string, sent: string, draft: string, what: string, format = english): string {
  return format(SENT_DIFF_COPY, { scope: scopeName, sent, draft, what })
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const FIELDS = ['what', 'fact', 'draftSaid', 'sentSaid'] as const

/** The reply's `changes`, or `null` when it is not `{ changes: [{ what, fact, draftSaid, sentSaid }] }`. */
export function parseFactChanges(raw: string): FactChange[] | null {
  const o = jsonOf(raw)
  if (!isRecord(o) || !Array.isArray(o.changes)) return null
  const out: FactChange[] = []
  for (const c of o.changes) {
    if (!isRecord(c) || !FIELDS.every((f) => typeof c[f] === 'string')) return null
    out.push({
      what: c.what as string,
      fact: c.fact as string,
      draftSaid: c.draftSaid as string,
      sentSaid: c.sentSaid as string,
    })
  }
  return out
}

const flat = (s: string) => s.normalize('NFC').replace(/\s+/g, ' ').trim()

/** `needle` as it is written in `haystack` (whitespace and case aside), or `null` when it is not there. */
function spanIn(haystack: string, needle: string): string | null {
  const hay = flat(haystack)
  const lower = hay.toLowerCase()
  const at = lower.indexOf(needle.toLowerCase())
  if (at < 0) return null
  // Lower-casing can change a string's length (rare letters); then the model's spelling is kept.
  return lower.length === hay.length ? hay.slice(at, at + needle.length) : needle
}

/**
 * The changes worth proposing: every field present and within its cap, `draftSaid` in `draft`, `sentSaid` in `sent`,
 * the two different, and `fact` containing `sentSaid`. Values come back as the texts spell them; `what` is one line.
 * At most `FACT_CHANGE_MAX_ITEMS`, one per fact.
 */
export function validateFactChanges(changes: FactChange[], texts: { draft: string; sent: string }): FactChange[] {
  const out: FactChange[] = []
  const facts = new Set<string>()
  for (const c of changes) {
    const what = flat(c.what)
    const fact = flat(c.fact)
    const draftSaid = flat(c.draftSaid)
    const sentSaid = flat(c.sentSaid)
    if (!what || !fact || !draftSaid || !sentSaid) continue
    if (what.length > FACT_CHANGE_MAX_WHAT_CHARS || fact.length > FACT_CHANGE_MAX_FACT_CHARS) continue
    if (draftSaid.length > FACT_CHANGE_MAX_SAID_CHARS || sentSaid.length > FACT_CHANGE_MAX_SAID_CHARS) continue
    if (draftSaid.toLowerCase() === sentSaid.toLowerCase()) continue
    if (!fact.toLowerCase().includes(sentSaid.toLowerCase())) continue
    const draftSpan = spanIn(texts.draft, draftSaid)
    const sentSpan = spanIn(texts.sent, sentSaid)
    if (!draftSpan || !sentSpan || facts.has(fact.toLowerCase())) continue
    facts.add(fact.toLowerCase())
    out.push({ what, fact, draftSaid: draftSpan, sentSaid: sentSpan })
    if (out.length >= FACT_CHANGE_MAX_ITEMS) break
  }
  return out
}
