import { getProviderDefinition } from '@shared/providers'
import type { ProviderModelInfo, ProviderSettings, Settings } from '@shared/types'
import { createModelDependencies } from '@/adapters'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'
import { type ModelTestState, testBasicModelRequest } from '@/utils/model-tester'

export type KeyCheck = 'ok' | 'rejected' | 'unreachable'

// Matches across lines: providers return pretty-printed JSON bodies (Google: "API key not valid", PERMISSION_DENIED).
const REJECTED =
  /401|403|unauthori[sz]ed|unauthenticated|permission_denied|invalid[\s\S]{0,40}key|incorrect api key|api key not valid|api_key_invalid|authentication_error/i

/** A failed basic request reads as a rejected key or as an unreachable provider. The error text is never shown. */
export function classifyKeyError(error: string | undefined): Exclude<KeyCheck, 'ok'> {
  return error && REJECTED.test(error) ? 'rejected' : 'unreachable'
}

/**
 * Sends one basic request to `modelId` and resolves as soon as it leaves `pending` (no vision or tool calls).
 * `settings` is the settings to test with, e.g. a copy carrying a key that is not saved yet; defaults to the saved
 * settings.
 */
export async function checkProviderKey(
  providerId: string,
  modelId: string,
  settings: Settings = settingsStore.getState()
): Promise<KeyCheck> {
  try {
    const [configs, dependencies] = await Promise.all([platform.getConfig(), createModelDependencies()])
    return await new Promise<KeyCheck>((resolve) => {
      const settle = (state: ModelTestState) => {
        const basic = state.basicTest
        if (!basic || basic.status === 'pending') return false
        resolve(basic.status === 'success' ? 'ok' : classifyKeyError(basic.error))
        return true
      }
      testBasicModelRequest({ providerId, modelId, settings, configs, dependencies, onStateChange: settle })
        .then((state) => {
          if (!settle(state)) resolve('unreachable')
        })
        .catch(() => resolve('unreachable'))
    })
  } catch {
    return 'unreachable'
  }
}

/** The provider's models: the saved list, else the definition's defaults. */
export function providerModels(
  providerId: string,
  providerSettings: ProviderSettings | undefined
): ProviderModelInfo[] {
  if (providerSettings?.models?.length) return providerSettings.models
  return getProviderDefinition(providerId)?.defaultSettings?.models ?? []
}

/**
 * The model first run checks the key with and makes the default: the provider's first model whose id has no
 * "preview" (preview models are often quota-limited on free keys), else the first model.
 */
export function firstModelId(providerId: string, providerSettings: ProviderSettings | undefined): string | undefined {
  const models = providerModels(providerId, providerSettings)
  return (models.find((m) => !/preview/i.test(m.modelId)) ?? models[0])?.modelId
}

/**
 * What saving `apiKey` writes. A provider left in OAuth mode (ChatGPT or Google chosen, then a key entered instead)
 * goes back to the API key with the definition's models, since OAuth never falls back to the key and the seeded
 * OAuth models are not API models.
 */
export function apiKeyPatch(
  providerId: string,
  providerSettings: ProviderSettings | undefined,
  apiKey: string
): Partial<ProviderSettings> {
  if (providerSettings?.authMode !== 'oauth') return { apiKey }
  return {
    apiKey,
    authMode: 'api_key',
    models: (getProviderDefinition(providerId)?.defaultSettings?.models ?? []).map((m) => ({ ...m })),
  }
}

/** A copy of `settings` with `patch` merged into the provider, for testing before saving. */
export function withProviderPatch(settings: Settings, providerId: string, patch: Partial<ProviderSettings>): Settings {
  return {
    ...settings,
    providers: {
      ...(settings.providers ?? {}),
      [providerId]: { ...(settings.providers?.[providerId] ?? {}), ...patch },
    },
  }
}
