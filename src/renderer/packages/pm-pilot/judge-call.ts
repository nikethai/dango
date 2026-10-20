import {
  type Evidence,
  inboundMayReachCloud,
  type Judgement,
  mayReachCloud,
  parseJudgement,
  type SourceRecord,
  validateJudgement,
} from '@shared/pm-pilot'
import { type BackgroundModel, errorClassName, localOnlySourceIds, resolveBackgroundModel } from './background-model'
import { buildJudgePrompt } from './prompts'

/*
 * One judge call with the background model (preflight R8). Dango never switches models: the configured model is the
 * only one tried, and any failure comes back as an error. Error strings are fixed text plus an error class name, so
 * they never carry prompt text, mail text or keys from a provider's error message.
 */

export const JUDGE_NO_MODEL = 'No model is set up'
export const JUDGE_LOCAL_ONLY = 'This source stays on this device; choose a local model'
export const JUDGE_UNREADABLE = 'The model reply could not be read'
export const JUDGE_FAILED = 'The model call failed'

export type JudgeResult = { judgement: Judgement | null; error?: string }

/** `JUDGE_FAILED`, with the error's class name when it is a plain identifier (never its message). */
function failure(e: unknown): string {
  const name = errorClassName(e)
  return name ? `${JUDGE_FAILED} (${name})` : JUDGE_FAILED
}

/**
 * Judges an inbound client message against the evidence. Never throws. With a cloud model, a local-only inbound record
 * (or one with no source id) is refused before any call, and evidence `mayReachCloud` refuses is dropped (ADR 0003).
 * `localOnlySourceIds` defaults to the connected sources marked "Keep on this device only". `model` is the background
 * model the caller already resolved for this run (so cloud or local is decided once); omitted, it is resolved here.
 */
export async function judgeThread(input: {
  scopeName: string
  inbound: SourceRecord
  evidence: Evidence[]
  localOnlySourceIds?: Set<string>
  model?: BackgroundModel | null
}): Promise<JudgeResult> {
  try {
    const model = input.model !== undefined ? input.model : await resolveBackgroundModel()
    if (!model) return { judgement: null, error: JUDGE_NO_MODEL }

    const cloud = model.cloud
    const localOnly = await localOnlySourceIds(input.localOnlySourceIds)
    if (cloud && !inboundMayReachCloud(input.inbound, localOnly)) return { judgement: null, error: JUDGE_LOCAL_ONLY }
    const evidence = cloud ? input.evidence.filter((e) => mayReachCloud(e, localOnly)) : input.evidence

    const { system, user, evidenceIds } = buildJudgePrompt(input.scopeName, input.inbound, evidence)
    const raw = await model.generate(system, user)
    const parsed = parseJudgement(raw)
    if (!parsed) return { judgement: null, error: JUDGE_UNREADABLE }
    return { judgement: validateJudgement(parsed, new Set(evidenceIds)) }
  } catch (e) {
    return { judgement: null, error: failure(e) }
  }
}
