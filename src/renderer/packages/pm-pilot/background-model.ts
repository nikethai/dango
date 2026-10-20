import { backgroundModelChoice, hasUsableModel, isLocalModelProvider, listSources, loadSources } from './bridge'

/*
 * The model every pipeline call uses: slice 7's background model (preflight R8). Dango never switches models: the
 * configured model is the only one tried, and a failed call is the caller's to report. Shared by the judge and the
 * sent-reply read-back.
 */

export type BackgroundModel = {
  /** True unless the provider runs on this device (ADR 0003: local-only sources may not reach it). */
  cloud: boolean
  /** One call; the reply's text parts joined. Throws when the call fails. */
  generate(system: string, user: string): Promise<string>
}

/** The configured background model, or `null` when there is none or it is not usable. */
export async function resolveBackgroundModel(): Promise<BackgroundModel | null> {
  const [{ settingsStore }, { lastUsedModelStore }] = await Promise.all([
    import('@/stores/settingsStore'),
    import('@/stores/lastUsedModelStore'),
  ])
  const global = settingsStore.getState().getSettings()
  const lastUsed = lastUsedModelStore.getState().chat
  const choice = backgroundModelChoice(global, lastUsed)
  if (!choice || !hasUsableModel(global, lastUsed)) return null
  return {
    cloud: !isLocalModelProvider(choice.provider),
    async generate(system, user) {
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
      return (result.contentParts ?? [])
        .filter((c) => c.type === 'text')
        .map((c) => (c as { text: string }).text)
        .join('')
    },
  }
}

/** The connected sources marked "Keep on this device only", unless the caller already has them. */
export async function localOnlySourceIds(given?: Set<string>): Promise<Set<string>> {
  if (given) return given
  await loadSources()
  return new Set(
    listSources()
      .filter((s) => s.localOnly)
      .map((s) => s.id)
  )
}

/** An error's class name when it is a plain identifier other than `Error`, never its message (which can hold mail). */
export function errorClassName(e: unknown): string | undefined {
  const name = e instanceof Error ? e.name : ''
  return /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) && name !== 'Error' ? name : undefined
}
