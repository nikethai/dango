import {
  type Evidence,
  inboundMayReachCloud,
  type Judgement,
  mayReachCloud,
  parseJudgement,
  type SourceRecord,
  validateJudgement,
} from '@shared/pm-pilot'
import { backgroundModelChoice, hasUsableModel, isLocalModelProvider, listSources, loadSources } from './bridge'
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
  const name = e instanceof Error ? e.name : ''
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) && name !== 'Error' ? `${JUDGE_FAILED} (${name})` : JUDGE_FAILED
}

async function localOnlyIds(given?: Set<string>): Promise<Set<string>> {
  if (given) return given
  await loadSources()
  return new Set(
    listSources()
      .filter((s) => s.localOnly)
      .map((s) => s.id)
  )
}

/**
 * Judges an inbound client message against the evidence. Never throws. With a cloud model, a local-only inbound record
 * (or one with no source id) is refused before any call, and evidence `mayReachCloud` refuses is dropped (ADR 0003).
 * `localOnlySourceIds` defaults to the connected sources marked "Keep on this device only".
 */
export async function judgeThread(input: {
  scopeName: string
  inbound: SourceRecord
  evidence: Evidence[]
  localOnlySourceIds?: Set<string>
}): Promise<JudgeResult> {
  try {
    const [{ settingsStore }, { lastUsedModelStore }] = await Promise.all([
      import('@/stores/settingsStore'),
      import('@/stores/lastUsedModelStore'),
    ])
    const global = settingsStore.getState().getSettings()
    const lastUsed = lastUsedModelStore.getState().chat
    const choice = backgroundModelChoice(global, lastUsed)
    if (!choice || !hasUsableModel(global, lastUsed)) return { judgement: null, error: JUDGE_NO_MODEL }

    const cloud = !isLocalModelProvider(choice.provider)
    const localOnly = await localOnlyIds(input.localOnlySourceIds)
    if (cloud && !inboundMayReachCloud(input.inbound, localOnly)) return { judgement: null, error: JUDGE_LOCAL_ONLY }
    const evidence = cloud ? input.evidence.filter((e) => mayReachCloud(e, localOnly)) : input.evidence

    const { system, user, evidenceIds } = buildJudgePrompt(input.scopeName, input.inbound, evidence)
    const [{ getModel }, { createModelDependencies }, { generateText }, { default: platform }, { createMessage }] =
      await Promise.all([
        import('@shared/models'),
        import('@/adapters'),
        import('@/packages/model-calls'),
        import('@/platform'),
        import('@shared/types'),
      ])
    const settings = { ...global, provider: choice.provider, modelId: choice.modelId }
    const model = getModel(settings, global, await platform.getConfig(), await createModelDependencies())
    const result = await generateText(model, [createMessage('system', system), createMessage('user', user)])
    const raw = (result.contentParts ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => (c as { text: string }).text)
      .join('')
    const parsed = parseJudgement(raw)
    if (!parsed) return { judgement: null, error: JUDGE_UNREADABLE }
    return { judgement: validateJudgement(parsed, new Set(evidenceIds)) }
  } catch (e) {
    return { judgement: null, error: failure(e) }
  }
}
