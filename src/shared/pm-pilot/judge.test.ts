import { describe, expect, it } from 'vitest'
import {
  JUDGE_MAX_ANSWER_CHARS,
  JUDGE_MAX_SUMMARY_CHARS,
  JUDGE_MAX_VALUE_CHARS,
  type Judgement,
  parseJudgement,
  tierFor,
  validateJudgement,
} from './judge'
import { inboundMayReachCloud, mayReachCloud } from './local-only'
import type { Evidence } from './types'

function j(over: Partial<Judgement> = {}): Judgement {
  return {
    intent: 'question',
    summary: 'Jo asks for the launch date.',
    answer: '12 Sep',
    evidenceIds: ['r:gmail:1'],
    confidence: 0.9,
    candidates: [],
    ...over,
  }
}

describe('validateJudgement', () => {
  it('drops evidence ids that were not given', () => {
    const out = validateJudgement(
      j({
        evidenceIds: ['r:gmail:1', 'r:gmail:invented', 'k:k1'],
        candidates: [
          { value: '12 Sep', evidenceIds: ['r:gmail:1', 'r:gmail:invented'] },
          { value: '14 Sep', evidenceIds: ['r:gmail:invented'] },
        ],
      }),
      new Set(['r:gmail:1', 'k:k1'])
    )
    expect(out.evidenceIds).toEqual(['r:gmail:1', 'k:k1'])
    expect(out.candidates).toEqual([{ value: '12 Sep', evidenceIds: ['r:gmail:1'] }])
  })

  it('clamps confidence to 0..1 and reads NaN as 0', () => {
    expect(validateJudgement(j({ confidence: 7 }), new Set()).confidence).toBe(1)
    expect(validateJudgement(j({ confidence: -2 }), new Set()).confidence).toBe(0)
    expect(validateJudgement(j({ confidence: Number.NaN }), new Set()).confidence).toBe(0)
  })

  it('caps the lengths of summary, answer and candidate values', () => {
    const long = 'x'.repeat(10_000)
    const out = validateJudgement(
      j({ summary: long, answer: long, candidates: [{ value: long, evidenceIds: ['r:gmail:1'] }] }),
      new Set(['r:gmail:1'])
    )
    expect(out.summary.length).toBeLessThanOrEqual(JUDGE_MAX_SUMMARY_CHARS)
    expect(out.answer?.length).toBeLessThanOrEqual(JUDGE_MAX_ANSWER_CHARS)
    expect(out.candidates[0].value.length).toBeLessThanOrEqual(JUDGE_MAX_VALUE_CHARS)
  })

  it('drops empty answers and empty candidate values', () => {
    const out = validateJudgement(
      j({ answer: '  ', candidates: [{ value: ' ', evidenceIds: ['r:gmail:1'] }] }),
      new Set(['r:gmail:1'])
    )
    expect(out.answer).toBeUndefined()
    expect(out.candidates).toEqual([])
  })
})

describe('tierFor', () => {
  it('an answer left without evidence is low', () => {
    const out = validateJudgement(j({ evidenceIds: ['r:gmail:invented'], confidence: 0.99 }), new Set(['r:gmail:1']))
    expect(tierFor(out)).toBe('low')
    expect(tierFor(j({ answer: undefined, confidence: 0.99 }))).toBe('low')
  })

  it('two different candidates are low', () => {
    expect(
      tierFor(
        j({
          confidence: 0.95,
          candidates: [
            { value: '12 Sep', evidenceIds: ['r:gmail:1'] },
            { value: '14 Sep', evidenceIds: ['r:gmail:2'] },
          ],
        })
      )
    ).toBe('low')
    // The same value twice is one candidate.
    expect(
      tierFor(
        j({
          confidence: 0.95,
          candidates: [
            { value: '12 Sep', evidenceIds: ['r:gmail:1'] },
            { value: ' 12 sep ', evidenceIds: ['r:gmail:2'] },
          ],
        })
      )
    ).toBe('high')
  })

  it('0.9 with evidence is high, 0.7 is medium, 0.5 is low', () => {
    expect(tierFor(j({ confidence: 0.9 }))).toBe('high')
    expect(tierFor(j({ confidence: 0.7 }))).toBe('medium')
    expect(tierFor(j({ confidence: 0.5 }))).toBe('low')
  })
})

describe('parseJudgement', () => {
  const json = JSON.stringify(j())

  it('parseJudgement returns null for prose and strips code fences', () => {
    expect(parseJudgement('I think the launch is on 12 Sep.')).toBeNull()
    expect(parseJudgement(`\`\`\`json\n${json}\n\`\`\``)).toEqual(j())
    expect(parseJudgement(`<think>hmm</think>${json}`)).toEqual(j())
  })

  it('reads a missing answer, evidence or candidates as none', () => {
    expect(parseJudgement(JSON.stringify({ intent: 'fyi', summary: 'Thanks.', confidence: 0.2 }))).toEqual({
      intent: 'fyi',
      summary: 'Thanks.',
      evidenceIds: [],
      confidence: 0.2,
      candidates: [],
    })
    expect(parseJudgement(JSON.stringify({ ...j(), answer: null }))?.answer).toBeUndefined()
  })

  it('rejects wrong types', () => {
    const bad: Record<string, unknown>[] = [
      { intent: 'urgent' },
      { summary: 3 },
      { answer: 12 },
      { evidenceIds: 'r:gmail:1' },
      { evidenceIds: [1] },
      { confidence: '0.9' },
      { candidates: 'x' },
      { candidates: [{ value: 1, evidenceIds: [] }] },
      { candidates: [{ value: 'a', evidenceIds: 'r:gmail:1' }] },
    ]
    for (const over of bad) expect(parseJudgement(JSON.stringify({ ...j(), ...over }))).toBeNull()
    expect(parseJudgement('[1,2]')).toBeNull()
    expect(parseJudgement('null')).toBeNull()
  })

  it('strips only a leading and trailing fence, so fences inside the answer survive', () => {
    const answer = 'Use this:\n```json\n{"a":1}\n```\nThen run ```npm i```.'
    const body = JSON.stringify(j({ answer }))
    expect(parseJudgement(`\`\`\`json\n${body}\n\`\`\``)?.answer).toBe(answer)
    expect(parseJudgement(body)?.answer).toBe(answer)
    expect(parseJudgement(`  \`\`\`\n${body}\`\`\`  `)?.answer).toBe(answer)
  })

  it('strips a leading think block, closed or unclosed', () => {
    const body = JSON.stringify(j({ summary: 'About <think> tags.' }))
    expect(parseJudgement(`<think>let me {think}</think>\n${body}`)?.summary).toBe('About <think> tags.')
    expect(parseJudgement(`<think>reasoning that never closes\n${body}`)?.summary).toBe('About <think> tags.')
  })
})

describe('mayReachCloud', () => {
  const local = new Set(['src-local'])
  const ev = (id: string, sourceIds?: string[], sourceId?: string): Evidence => ({
    id,
    label: 'x',
    date: 0,
    text: 't',
    source: { kind: 'email', label: 'x', ...(sourceId ? { sourceId } : {}) },
    ...(sourceIds ? { sourceIds } : {}),
  })

  it('drops knowledge when any of its sources is local-only', () => {
    expect(mayReachCloud(ev('k:1', ['src-cloud', 'src-local']), local)).toBe(false)
    expect(mayReachCloud(ev('k:2', ['src-cloud']), local)).toBe(true)
    // Knowledge the user typed has no source id and is the user's own text.
    expect(mayReachCloud(ev('k:3', []), local)).toBe(true)
  })

  it('drops a record with a local-only source or with no source id', () => {
    expect(mayReachCloud(ev('r:gmail:1', undefined, 'src-local'), local)).toBe(false)
    expect(mayReachCloud(ev('r:gmail:2', undefined, 'src-cloud'), local)).toBe(true)
    expect(mayReachCloud(ev('r:gmail:3'), local)).toBe(false)
  })

  it('inboundMayReachCloud refuses a local-only record and one without a source id', () => {
    expect(inboundMayReachCloud({ sourceId: 'src-local' }, local)).toBe(false)
    expect(inboundMayReachCloud({ sourceId: null }, local)).toBe(false)
    expect(inboundMayReachCloud({ sourceId: 'src-cloud' }, local)).toBe(true)
  })
})
