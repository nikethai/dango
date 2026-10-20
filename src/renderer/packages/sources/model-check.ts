import { getSystemProviders } from '@shared/providers'
import { isProviderListedInSettings } from '@shared/providers/provider-credentials'
import type { Settings } from '@shared/types'
import { ModelProviderEnum } from '@shared/types/provider'

type ChatModel = { provider: string; modelId: string }

/** Providers that run on this device: the only ones a local-only source's text may reach (ADR 0003). */
export const LOCAL_PROVIDERS: ReadonlySet<string> = new Set<string>([
  ModelProviderEnum.Ollama,
  ModelProviderEnum.LMStudio,
])

export function isLocalModelProvider(provider: string | undefined | null): boolean {
  return !!provider && LOCAL_PROVIDERS.has(provider)
}

/** The model background work uses: the default chat model, else the last model used in chat. */
export function backgroundModelChoice(settings: Settings, lastUsedChat?: ChatModel): ChatModel | null {
  const chosen = settings.defaultChatModel
    ? { provider: settings.defaultChatModel.provider, modelId: settings.defaultChatModel.model }
    : lastUsedChat
  return chosen?.provider && chosen.modelId ? chosen : null
}

/** True when that model's provider is set up (credentials, or a local or custom provider with models). */
export function hasUsableModel(settings: Settings, lastUsedChat?: ChatModel): boolean {
  const chosen = backgroundModelChoice(settings, lastUsedChat)
  if (!chosen) return false
  const base = [...getSystemProviders(), ...(settings.customProviders ?? [])].find((p) => p.id === chosen.provider)
  return !!base && isProviderListedInSettings(base, settings.providers?.[chosen.provider])
}
