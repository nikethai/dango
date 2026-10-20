import { HIGH_CONFIDENCE, MEDIUM_CONFIDENCE, type Tier } from './types'

/*
 * The judge's reply: what a client thread asks and what the evidence answers. Pure. The model's reply is untrusted:
 * `parseJudgement` rejects wrong types, and `validateJudgement` keeps only evidence ids the prompt listed (Review
 * Focus 3), clamps confidence and caps lengths, so nothing the model invents reaches a draft or a question.
 */

export type JudgementCandidate = { value: string; evidenceIds: string[] }
export type Judgement = {
  intent: 'question' | 'fyi' | 'noise'
  /** One sentence, in the thread's language. */
  summary: string
  answer?: string
  evidenceIds: string[]
  confidence: number
  candidates: JudgementCandidate[]
}

export const JUDGE_MAX_SUMMARY_CHARS = 400
export const JUDGE_MAX_ANSWER_CHARS = 1000
export const JUDGE_MAX_VALUE_CHARS = 200
export const JUDGE_MAX_CANDIDATES = 6
export const JUDGE_MAX_EVIDENCE_IDS = 32

const INTENTS: ReadonlySet<string> = new Set(['question', 'fyi', 'noise'])

/** A model reply as JSON: a leading `<think>` block and an outer fence removed, then the outermost braces tried. */
export function jsonOf(raw: string): unknown {
  // Only a leading reasoning block and an outer fence are removed: fences inside string values must survive.
  let cleaned = raw.trim()
  if (/^<think>/i.test(cleaned)) {
    const close = cleaned.search(/<\/think>/i)
    if (close >= 0) cleaned = cleaned.slice(close + '</think>'.length)
    else {
      // A truncated reasoning model: the block never closes; skip to the first brace.
      const brace = cleaned.indexOf('{')
      cleaned = brace >= 0 ? cleaned.slice(brace) : ''
    }
  }
  cleaned = cleaned
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()
  try {
    return JSON.parse(cleaned)
  } catch {
    // A model may wrap the object in a sentence; only the outermost braces are tried.
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const isStringList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** The reply as a `Judgement`, or `null` when it is not one (prose, wrong types). Fences and `<think>` are stripped. */
export function parseJudgement(text: string): Judgement | null {
  const o = jsonOf(text)
  if (!isRecord(o)) return null
  if (typeof o.intent !== 'string' || !INTENTS.has(o.intent)) return null
  if (typeof o.summary !== 'string') return null
  if (o.answer !== undefined && o.answer !== null && typeof o.answer !== 'string') return null
  if (o.evidenceIds !== undefined && !isStringList(o.evidenceIds)) return null
  if (typeof o.confidence !== 'number') return null
  if (o.candidates !== undefined && !Array.isArray(o.candidates)) return null
  const candidates: JudgementCandidate[] = []
  for (const c of (o.candidates as unknown[] | undefined) ?? []) {
    if (!isRecord(c) || typeof c.value !== 'string') return null
    if (c.evidenceIds !== undefined && !isStringList(c.evidenceIds)) return null
    candidates.push({ value: c.value, evidenceIds: (c.evidenceIds as string[] | undefined) ?? [] })
  }
  const judgement: Judgement = {
    intent: o.intent as Judgement['intent'],
    summary: o.summary,
    evidenceIds: (o.evidenceIds as string[] | undefined) ?? [],
    confidence: o.confidence,
    candidates,
  }
  if (typeof o.answer === 'string') judgement.answer = o.answer
  return judgement
}

function clip(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : t.slice(0, max).trimEnd()
}

function keepGiven(ids: string[], given: Set<string>): string[] {
  return [...new Set(ids.filter((id) => given.has(id)))].slice(0, JUDGE_MAX_EVIDENCE_IDS)
}

/**
 * Keeps only evidence ids in `given`; drops candidates left without evidence or without a value; clamps confidence
 * to 0..1 (NaN is 0); caps the summary, answer and candidate values. An empty answer is no answer.
 */
export function validateJudgement(j: Judgement, given: Set<string>): Judgement {
  const confidence = Number.isNaN(j.confidence) ? 0 : Math.min(1, Math.max(0, j.confidence))
  const candidates = j.candidates
    .map((c) => ({ value: clip(c.value, JUDGE_MAX_VALUE_CHARS), evidenceIds: keepGiven(c.evidenceIds, given) }))
    .filter((c) => c.value !== '' && c.evidenceIds.length > 0)
    .slice(0, JUDGE_MAX_CANDIDATES)
  const answer = typeof j.answer === 'string' ? clip(j.answer, JUDGE_MAX_ANSWER_CHARS) : ''
  const out: Judgement = {
    intent: j.intent,
    summary: clip(j.summary, JUDGE_MAX_SUMMARY_CHARS),
    evidenceIds: keepGiven(j.evidenceIds, given),
    confidence,
    candidates,
  }
  if (answer) out.answer = answer
  return out
}

const sameValue = (v: string) => v.normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * Two or more distinct candidates → low; no answer or no evidence → low; otherwise by confidence
 * (`HIGH_CONFIDENCE`, `MEDIUM_CONFIDENCE`).
 */
export function tierFor(j: Judgement): Tier {
  if (new Set(j.candidates.map((c) => sameValue(c.value))).size >= 2) return 'low'
  if (!j.answer?.trim() || j.evidenceIds.length === 0) return 'low'
  if (j.confidence >= HIGH_CONFIDENCE) return 'high'
  if (j.confidence >= MEDIUM_CONFIDENCE) return 'medium'
  return 'low'
}
