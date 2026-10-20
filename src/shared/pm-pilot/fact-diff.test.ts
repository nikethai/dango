import { describe, expect, it } from 'vitest'
import {
  extractFactTokens,
  FACT_CHANGE_MAX_ITEMS,
  FACT_CHANGE_MAX_SAID_CHARS,
  factsDiffer,
  parseFactChanges,
  SENT_DIFF_COPY,
  sentDiffText,
  validateFactChanges,
} from './fact-diff'

describe('extractFactTokens', () => {
  it('normalises dates in every supported form to day-month', () => {
    expect(extractFactTokens('Launch is 6 Nov.').dates).toEqual(['6-11'])
    expect(extractFactTokens('Launch is Nov 6, 2026.').dates).toEqual(['6-11'])
    expect(extractFactTokens('Launch is 6th November 2026.').dates).toEqual(['6-11'])
    expect(extractFactTokens('Launch is 6/11.').dates).toEqual(['6-11'])
    expect(extractFactTokens('Ra mắt ngày 6 tháng 11.').dates).toEqual(['6-11'])
  })

  it('keeps numbers of two or more digits without thousands separators, and not the digits of dates', () => {
    const t = extractFactTokens('The quote is 9,100 USD for 3 pages, due 6 Nov 2026 or 12/11.')
    expect(t.numbers).toEqual(['9100'])
    expect(t.dates).toEqual(['12-11', '6-11'])
  })

  it('takes names that do not start a sentence and are not months, weekdays or greetings', () => {
    const t = extractFactTokens('Launch is Monday. Anna will send it in November. We met Minh and Lan on Friday.')
    expect(t.names).toEqual(['Lan', 'Minh'])
  })

  it('ignores the greeting line and everything after a sign-off line', () => {
    const t = extractFactTokens('Hi Jo,\n\nThe call is 4 Nov.\n\nBest,\nPeter Smith\n+84 912 345 678')
    expect(t).toEqual({ dates: ['4-11'], numbers: [], names: [] })
  })

  it('does not treat a sentence that starts with Thanks as a sign-off', () => {
    expect(extractFactTokens('Thanks for waiting, the fee is 9100.').numbers).toEqual(['9100'])
  })

  it('cuts a Vietnamese sign-off', () => {
    expect(extractFactTokens('Phí là 9.100.\nTrân trọng,\nNguyễn Văn An 0912').numbers).toEqual(['9100'])
  })
})

describe('factsDiffer', () => {
  it('a reworded reply with the same facts does not differ', () =>
    expect(factsDiffer('Launch is on 4 Nov.', "We're launching 4 Nov, as planned!")).toBe(false))

  it('a changed date differs', () => expect(factsDiffer('Launch is on 4 Nov.', 'Launch is on 6 Nov.')).toBe(true))

  it('9,100 equals 9.100', () => expect(factsDiffer('The quote is 9,100.', 'The quote is 9.100.')).toBe(false))

  it('Vietnamese dates normalise', () =>
    expect(factsDiffer('Ra mắt ngày 6 tháng 11.', 'Ra mắt vào 6/11 nhé.')).toBe(false))

  it('a changed sign-off name does not differ', () =>
    expect(factsDiffer('Launch is on 4 Nov.\n\nBest,\nJo', 'Launch is on 4 Nov.\n\nBest,\nAnna')).toBe(false))

  it('a changed amount or name differs', () => {
    expect(factsDiffer('The quote is 8,400.', 'The quote is 9,100.')).toBe(true)
    expect(factsDiffer('The designer is Minh.', 'The designer is Lan.')).toBe(true)
  })
})

describe('sentDiffText', () => {
  it('fills the Global Constraints copy', () =>
    expect(sentDiffText('Acme Co', '6 Nov', '4 Nov', 'launch date')).toBe(
      'You told Acme Co 6 Nov; the draft said 4 Nov. Save 6 Nov as the launch date?'
    ))

  it('passes the copy key and values to a translator, and values with $ stay literal', () => {
    const seen: Array<[string, Record<string, string>]> = []
    const out = sentDiffText('A$1', '$&', '4 Nov', 'fee', (key, values) => {
      seen.push([key, values])
      return 'translated'
    })
    expect(out).toBe('translated')
    expect(seen).toEqual([[SENT_DIFF_COPY, { scope: 'A$1', sent: '$&', draft: '4 Nov', what: 'fee' }]])
    expect(sentDiffText('A$1', '$&', '4 Nov', 'fee')).toBe('You told A$1 $&; the draft said 4 Nov. Save $& as the fee?')
  })
})

describe('parseFactChanges and validateFactChanges', () => {
  const draft = 'Hi Jo,\nLaunch is on 4 Nov and the fee is 8,400.\nBest,\nAn'
  const sent = 'Hi Jo,\nLaunch is on 6 Nov and the fee is 8,400.\nBest,\nAn'
  const item = { what: 'launch date', fact: 'Launch is on 6 Nov.', draftSaid: '4 Nov', sentSaid: '6 Nov' }

  it('reads a fenced reply and rejects prose or wrong types', () => {
    expect(parseFactChanges(`\`\`\`json\n${JSON.stringify({ changes: [item] })}\n\`\`\``)).toEqual([item])
    expect(parseFactChanges('No changes found.')).toBeNull()
    expect(parseFactChanges(JSON.stringify({ changes: [{ ...item, fact: 3 }] }))).toBeNull()
    expect(parseFactChanges(JSON.stringify({ changes: 'none' }))).toBeNull()
  })

  it('keeps a change whose values are in both texts and whose fact states the sent value', () =>
    expect(validateFactChanges([item], { draft, sent })).toEqual([item]))

  it('drops a change whose values are not in both texts (Review Focus 3)', () => {
    expect(validateFactChanges([{ ...item, sentSaid: '8 Nov', fact: 'Launch is 8 Nov.' }], { draft, sent })).toEqual([])
    expect(validateFactChanges([{ ...item, draftSaid: '2 Nov' }], { draft, sent })).toEqual([])
  })

  it('drops a change whose fact does not contain the sent value', () =>
    expect(validateFactChanges([{ ...item, fact: 'Launch is on 9 Dec.' }], { draft, sent })).toEqual([]))

  it('drops a change whose values are the same, empty or too long, and dedupes facts', () => {
    expect(validateFactChanges([{ ...item, draftSaid: '8,400', sentSaid: '8,400' }], { draft, sent })).toEqual([])
    expect(validateFactChanges([{ ...item, what: ' ' }], { draft, sent })).toEqual([])
    const long = 'x'.repeat(FACT_CHANGE_MAX_SAID_CHARS + 1)
    expect(validateFactChanges([{ ...item, sentSaid: long, fact: long }], { draft, sent: `${sent}${long}` })).toEqual(
      []
    )
    expect(validateFactChanges([item, { ...item, what: 'date' }], { draft, sent })).toHaveLength(1)
  })

  it('matches across whitespace and case, keeps the wording of the texts, flattens what and caps the count', () => {
    const kept = validateFactChanges([{ ...item, what: 'launch\n date', sentSaid: '6  nov' }], { draft, sent })
    expect(kept).toEqual([item])
    const many = Array.from({ length: FACT_CHANGE_MAX_ITEMS + 3 }, (_, i) => ({ ...item, fact: `${i}: 6 Nov` }))
    expect(validateFactChanges(many, { draft, sent })).toHaveLength(FACT_CHANGE_MAX_ITEMS)
  })
})
