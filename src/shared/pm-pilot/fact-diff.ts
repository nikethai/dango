import { inertValues } from './i18n-values'
import { jsonOf } from './judge'

/*
 * Sent replies read back (flow 10 step 5). Pure. `extractFactTokens` pulls the facts a reply states (dates, numbers,
 * names) so a reworded reply with the same facts costs no model call; when unsure it leans to "differ", since a missed
 * change leaves knowledge stale while a needless call costs one validated reply. The model's list of changes is
 * untrusted: `validateFactChanges` pins each change to the token diff of the two texts and the proposed fact to the
 * sent text (Review Focus 3).
 */

export type FactTokens = { dates: string[]; numbers: string[]; names: string[] }
export type FactChange = { what: string; fact: string; draftSaid: string; sentSaid: string }

export const FACT_CHANGE_MAX_ITEMS = 5
export const FACT_CHANGE_MAX_WHAT_CHARS = 60
export const FACT_CHANGE_MAX_FACT_CHARS = 200
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
  // ISO `2026-11-06` and dotted `6.11.2026` (the year is required, so `9.100` stays a number).
  { re: /(?<![\p{N}.\-/])\d{4}-(\d{1,2})-(\d{1,2})(?![\p{N}-])/gu, dayMonth: (m) => [m[2], m[1]] },
  { re: /(?<![\p{N}.,])(\d{1,2})\.(\d{1,2})\.\d{4}(?![\p{N}])/gu, dayMonth: (m) => [m[1], m[2]] },
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

function isSignOff(line: string): boolean {
  const m = SIGN_OFF.exec(line)
  return !!m && SIGN_OFF_REST.test(line.slice(m[0].length))
}

/**
 * The text a reply's facts come from. The first non-empty line is dropped when it is a greeting or a thank-you
 * (`Hi Jo,`, `Thanks Jo,`, `Cảm ơn anh,`): an opener, not a sign-off. A sign-off line cuts the rest only after at
 * least one content line, so an opener never hides the facts below it.
 */
function factText(text: string): string {
  const lines = text.normalize('NFC').replace(/\r\n?/g, '\n').split('\n')
  const first = lines.findIndex((l) => l.trim() !== '')
  if (first >= 0 && (GREETING_LINE.test(lines[first].trim()) || isSignOff(lines[first].trim()))) lines[first] = ''
  let content = false
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '') continue
    if (content && isSignOff(line)) return lines.slice(0, i).join('\n')
    content = true
  }
  return lines.join('\n')
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

const CURRENCY_BEFORE = /[$€£¥₫]\s?$/u
const UNIT_AFTER =
  /^\s?(?:%|k|m|tr|days?|weeks?|months?|years?|hours?|hrs?|mins?|minutes?|pages?|screens?|rounds?|people|ngày|tuần|tháng|năm|giờ|trang|triệu|nghìn|ngàn)(?![\p{L}\p{N}])/iu

/**
 * A number's value as text: a separator followed by exactly three digits groups thousands and is removed; any other
 * is a decimal point (`9,100` and `9.100` → `9100`, `9.5` → `9.5`, `1,000.50` and `1.250,50` → `1000.5`, `1250.5`).
 */
function numberValue(raw: string): string {
  const parts = raw.split(/[.,]/)
  let out = parts[0]
  for (const group of parts.slice(1)) out += group.length === 3 ? group : `.${group}`
  if (out.includes('.')) out = out.replace(/0+$/, '').replace(/\.$/, '')
  return out
}

/**
 * Dates (`6 Nov`, `Nov 6`, `6/11`, `ngày 6 tháng 11` → `6-11`), numbers of two or more digits with `,` and `.`
 * removed (not the digits of a date), and capitalised words that neither start a sentence nor name a month, weekday
 * or greeting. A greeting line and everything from a sign-off line on are ignored.
 */
export function extractFactTokens(text: string): FactTokens {
  return tokensOf(factText(text), false)
}

/**
 * The tokens of `prepared`. `span`: a fragment rather than a reply, so a capitalised word counts as a name even at
 * its start (the validator then checks it against the full texts' names).
 */
function tokensOf(prepared: string, span: boolean): FactTokens {
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
  const numbers: string[] = []
  for (const m of rest.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const at = m.index ?? 0
    const value = numberValue(m[0])
    const digits = value.replace('.', '').length
    const unit = CURRENCY_BEFORE.test(rest.slice(0, at)) || UNIT_AFTER.test(rest.slice(at + m[0].length))
    if (digits >= 2 || unit) numbers.push(value)
  }
  const names: string[] = []
  for (const m of prepared.matchAll(/(?<![\p{L}\p{N}])\p{Lu}\p{Ll}+(?![\p{L}\p{N}])/gu)) {
    if (NOT_NAMES.has(m[0].toLowerCase()) || (!span && startsSentence(prepared, m.index ?? 0))) continue
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
 * (scope name, mail, model output) and stay plain values, with `{{`/`}}` made inert (`inertValues`): pass `i18n.t` as
 * `format` to translate, never `<Trans>`.
 */
export function sentDiffText(scopeName: string, sent: string, draft: string, what: string, format = english): string {
  return format(SENT_DIFF_COPY, inertValues({ scope: scopeName, sent, draft, what }))
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
const isWordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c)

/**
 * `needle` as it is written in `haystack` (whitespace and case aside), as a whole token: no letter or digit runs on
 * into it at either end. `null` when it is not there.
 */
function spanIn(haystack: string, needle: string): string | null {
  const hay = flat(haystack)
  const lower = hay.toLowerCase()
  const want = needle.toLowerCase()
  // Lower-casing can change a string's length (rare letters); then positions are not comparable, so nothing matches.
  if (lower.length !== hay.length) return null
  for (let at = lower.indexOf(want); at >= 0; at = lower.indexOf(want, at + 1)) {
    const end = at + want.length
    const startOk = !(isWordChar(lower[at - 1]) && isWordChar(want[0]))
    const endOk = !(isWordChar(lower[end]) && isWordChar(want[want.length - 1]))
    if (startOk && endOk) return hay.slice(at, end)
  }
  return null
}

const keyed = (t: FactTokens) => [
  ...t.dates.map((d) => `d:${d}`),
  ...t.numbers.map((n) => `n:${n}`),
  ...t.names.map((n) => `p:${n}`),
]
/** Every token of a text, names included wherever they stand (for grounding a fact in that text). */
const allTokens = (text: string) => new Set(keyed(tokensOf(flat(text), true)))

/** True when the said value carries a fact token its own text states and the other text does not. */
function carriesChange(said: string, own: Set<string>, other: Set<string>): boolean {
  return keyed(tokensOf(said, true)).some((t) => own.has(t) && !other.has(t))
}

const LINK = /https?:\/\/[^\s<>"']+|www\.[^\s<>"']+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+/giu

/** The fact adds no link, email address or `@` the sent text does not have. */
function noNewLinks(fact: string, sent: string): boolean {
  const lowerSent = sent.toLowerCase()
  if (fact.includes('@') && !sent.includes('@')) return false
  return [...fact.matchAll(LINK)].every((m) => lowerSent.includes(m[0].replace(/[.,!?]+$/, '').toLowerCase()))
}

/** One sentence: no line break or `;`, and at most one `.`, `!` or `?` ending a sentence, at the very end. */
function oneSentence(raw: string): boolean {
  if (/[\n\r;]/.test(raw)) return false
  const fact = raw.trim()
  const ends = [...fact.matchAll(/[.!?]+(?=\s|$)/g)]
  return ends.length === 0 || (ends.length === 1 && (ends[0].index ?? 0) + ends[0][0].length === fact.length)
}

/**
 * The changes worth proposing (Review Focus 3). A change is kept only when:
 * - every field is present and within its cap, and `fact` is one sentence;
 * - `draftSaid` is a whole token span of the draft and `sentSaid` of the sent text, and the two differ;
 * - each said value carries a date, number or name its own text has and the other text lacks (the deterministic diff
 *   that justified the call);
 * - `fact` contains `sentSaid`, every date, number and name in it is in the sent text or the scope name, and it adds
 *   no link, email address or `@` the sent text lacks.
 * Values come back as the texts spell them; `what` is one line. At most `FACT_CHANGE_MAX_ITEMS`, one per fact.
 */
export function validateFactChanges(
  changes: FactChange[],
  texts: { draft: string; sent: string; scopeName?: string }
): FactChange[] {
  const draftTokens = new Set(keyed(extractFactTokens(texts.draft)))
  const sentTokens = new Set(keyed(extractFactTokens(texts.sent)))
  const grounded = new Set([...allTokens(texts.sent), ...allTokens(texts.scopeName ?? '')])
  const out: FactChange[] = []
  const facts = new Set<string>()
  for (const c of changes) {
    const what = flat(c.what)
    const fact = flat(c.fact)
    const draftSaid = flat(c.draftSaid)
    const sentSaid = flat(c.sentSaid)
    if (!what || !fact || !draftSaid || !sentSaid || !oneSentence(c.fact)) continue
    if (what.length > FACT_CHANGE_MAX_WHAT_CHARS || fact.length > FACT_CHANGE_MAX_FACT_CHARS) continue
    if (draftSaid.length > FACT_CHANGE_MAX_SAID_CHARS || sentSaid.length > FACT_CHANGE_MAX_SAID_CHARS) continue
    if (draftSaid.toLowerCase() === sentSaid.toLowerCase()) continue
    if (!spanIn(fact, sentSaid)) continue
    const draftSpan = spanIn(texts.draft, draftSaid)
    const sentSpan = spanIn(texts.sent, sentSaid)
    if (!draftSpan || !sentSpan || facts.has(fact.toLowerCase())) continue
    if (!carriesChange(sentSpan, sentTokens, draftTokens) || !carriesChange(draftSpan, draftTokens, sentTokens))
      continue
    if (!keyed(extractFactTokens(fact)).every((t) => grounded.has(t)) || !noNewLinks(fact, texts.sent)) continue
    facts.add(fact.toLowerCase())
    out.push({ what, fact, draftSaid: draftSpan, sentSaid: sentSpan })
    if (out.length >= FACT_CHANGE_MAX_ITEMS) break
  }
  return out
}
