import { ModelProviderEnum } from '../types/provider'
import type { ProviderBaseInfo, ProviderSettings, Settings } from '../types'

/**
 * True when the provider has usable credentials for chat:
 * developer API key and/or OAuth access token (e.g. SuperGrok / X Premium).
 */
export function hasProviderCredentials(settings?: ProviderSettings | null): boolean {
  if (!settings) return false
  if (typeof settings.apiKey === 'string' && settings.apiKey.trim().length > 0) {
    return true
  }
  if (typeof settings.oauth?.accessToken === 'string' && settings.oauth.accessToken.length > 0) {
    return true
  }
  return false
}

const LOCAL_PROVIDER_IDS = new Set<string>([
  ModelProviderEnum.Ollama,
  ModelProviderEnum.LMStudio,
  ModelProviderEnum.OpenClaw,
  ModelProviderEnum.ComfyUI,
])

/**
 * Whether a provider should appear in the settings provider list (configured / usable).
 * - Cloud builtins: need API key or OAuth
 * - Local / custom: models list (or default models for OpenClaw / ComfyUI)
 * - Custom providers always list once created
 */
export function isProviderListedInSettings(
  base: Pick<ProviderBaseInfo, 'id' | 'isCustom' | 'defaultSettings'>,
  settings?: ProviderSettings | null
): boolean {
  if (base.isCustom) {
    return true
  }
  if (hasProviderCredentials(settings)) {
    return true
  }
  if (LOCAL_PROVIDER_IDS.has(base.id)) {
    if (settings?.models?.length) {
      return true
    }
    if (
      (base.id === ModelProviderEnum.OpenClaw || base.id === ModelProviderEnum.ComfyUI) &&
      base.defaultSettings?.models?.length
    ) {
      return true
    }
    // Ollama / LM Studio: show when user has visited and set host, or always offer via Add
    return false
  }
  return false
}

/**
 * Whether the user has set up this provider: a custom provider they created, a built-in one with a key or sign-in, or
 * a local one with models (OpenClaw and ComfyUI count with their default models, as in the model picker). Model calls
 * refuse any other provider, so nothing is sent to a provider the user never chose.
 */
export function isProviderSetUp(
  providerId: string,
  settings: Pick<Settings, 'providers' | 'customProviders'>,
  defaultModelCount = 0
): boolean {
  if (settings.customProviders?.some((p) => p.id === providerId)) return true
  const providerSettings = settings.providers?.[providerId]
  if (hasProviderCredentials(providerSettings)) return true
  if (!LOCAL_PROVIDER_IDS.has(providerId)) return false
  if (providerSettings?.models?.length) return true
  return (
    (providerId === ModelProviderEnum.OpenClaw || providerId === ModelProviderEnum.ComfyUI) && defaultModelCount > 0
  )
}
