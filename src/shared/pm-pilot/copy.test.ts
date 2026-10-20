import { describe, expect, it } from 'vitest'
import { ch6Opening, countWord, doneDraftPatch, draftProposalEntry, joinLabels, needsYouEntry } from './copy'
import type { ClientDraft, ClientQuestion, Evidence } from './types'

const at = (iso: string) => new Date(`${iso}T12:00:00`).getTime()

function ev(id: string, label: string): Evidence {
  return { id, label, date: at('2026-10-02'), text: 'x', source: { kind: 'email', label } }
}

function draft(over: Partial<ClientDraft> = {}): ClientDraft {
  return {
    id: 'd1',
    scopeId: 'acme',
    accountId: 'acc1',
    sourceId: 'src1',
    threadId: 't1',
    inboundMessageId: 'm1',
    to: 'jo@acme.com',
    subject: 'Launch',
    text: 'Hi Jo,\n\nThe launch is on 4 Nov.',
    answer: 'launch is 4 Nov',
    evidence: [ev('r:asana:1', 'Asana "Launch plan"'), ev('r:gmail:2', 'your 2 Oct email')],
    state: 'proposed',
    createdAt: 1,
    ...over,
  }
}

function question(over: Partial<ClientQuestion> = {}): ClientQuestion {
  return {
    id: 'q1',
    kind: 'which-answer',
    scopeId: 'acme',
    accountId: 'acc1',
    threadId: 't1',
    subject: 'Quote',
    from: 'jo@acme.com',
    summary: 'Client asks for the revised quote.',
    candidates: [
      { value: '8,400', date: at('2026-09-12'), sourceLabel: "Jo's 12 Sep email" },
      { value: '9,100', date: at('2026-09-30'), sourceLabel: 'Asana "Quote"' },
    ],
    state: 'open',
    createdAt: 1,
    ...over,
  }
}

describe('joinLabels and countWord', () => {
  it('joins with commas and a final "and"', () => {
    expect(joinLabels([])).toBe('')
    expect(joinLabels(['a'])).toBe('a')
    expect(joinLabels(['a', 'b'])).toBe('a and b')
    expect(joinLabels(['a', 'b', 'c'])).toBe('a, b and c')
  })

  it('spells two to four and keeps digits after', () => {
    expect([2, 3, 4, 5, 12].map((n) => countWord(n))).toEqual(['two', 'three', 'four', '5', '12'])
  })
})

describe('draft copy', () => {
  it('doneDraftPatch gives the RV1 Done copy', () => {
    expect(doneDraftPatch(draft())).toEqual({
      text: 'Reply drafted in Gmail: launch is 4 Nov, per Asana "Launch plan" and your 2 Oct email.',
      sub: 'Draft is in the thread, not sent',
    })
  })

  it('draftProposalEntry is an Apply proposal on the draft, with the body as text', () => {
    const e = draftProposalEntry(draft())
    expect(e).toMatchObject({
      kind: 'proposal',
      scopeId: 'acme',
      source: 'Gmail thread "Launch"',
      text: 'Hi Jo,\n\nThe launch is on 4 Nov.',
      sub: 'Not in Gmail yet · per Asana "Launch plan" and your 2 Oct email',
      actionLabel: 'Apply',
      ref: { type: 'draft', id: 'd1' },
    })
  })

  it('keeps braces in external text inert', () => {
    const e = draftProposalEntry(draft({ subject: 'x {{labels}} y' }))
    expect(e.source).not.toContain('{{labels}}')
    expect(e.source).toContain('labels')
  })
})

describe('needsYouEntry', () => {
  it('two candidates', () => {
    const e = needsYouEntry(question())
    expect(e).toMatchObject({
      kind: 'needs-you',
      scopeId: 'acme',
      source: 'two candidates',
      text: 'Client asks for the revised quote. I found 8,400 (12 Sep) and 9,100 (30 Sep). Which is current?',
      actionLabel: 'Answer',
      ref: { type: 'question', id: 'q1' },
    })
  })

  it('no answer found', () => {
    expect(needsYouEntry(question({ candidates: [] }))).toMatchObject({
      source: 'no answer found',
      text: "Client asks for the revised quote. I couldn't find the answer.",
      actionLabel: 'Answer',
    })
  })

  it('unknown client', () => {
    expect(needsYouEntry(question({ kind: 'which-client', scopeId: null, candidates: [] }))).toMatchObject({
      scopeId: 'everywhere',
      source: 'Gmail',
      text: 'Which client is this?',
      sub: 'jo@acme.com · "Quote"',
      actionLabel: 'Answer',
    })
  })

  it('Asana project, with the projects as options', () => {
    const q = question({
      kind: 'which-project',
      candidates: [
        { value: 'Website', sourceLabel: 'Asana', scopeId: 'g1' },
        { value: 'App', sourceLabel: 'Asana', scopeId: 'g2' },
      ],
    })
    expect(needsYouEntry(q, 'Acme Co')).toMatchObject({
      source: 'Asana',
      text: 'Which Asana project is Acme Co?',
      options: [
        { id: 'g1', text: 'Website' },
        { id: 'g2', text: 'App' },
      ],
      actionLabel: 'Answer',
    })
  })

  it('local-only: choose a model', () => {
    expect(needsYouEntry(question({ kind: 'choose-model', candidates: [] }), 'Acme Co')).toMatchObject({
      text: 'Acme Co Gmail stays on this device. Choose a local model to draft replies.',
      actionLabel: 'Choose a model',
    })
  })
})

describe('ch6Opening', () => {
  it('lists each candidate and ends with the save line', () => {
    const text = ch6Opening(question(), 'Acme Co')
    expect(text).toBe(
      [
        "Client asks for the revised quote. I found two answers and can't tell which is current:",
        `8,400 · 12 Sep · Jo's 12 Sep email`,
        '9,100 · 30 Sep · Asana "Quote"',
        "Pick one, or type the answer. I'll save it for Acme Co and draft the reply.",
      ].join('\n')
    )
  })
})
