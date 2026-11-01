import { hasProviderCredentials } from '@shared/providers/provider-credentials'
import { ModelProviderEnum, type ProviderInfo, type Settings } from '@shared/types'
import { chatProvidersFromSettings } from '@/hooks/useProviders'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { settingsStore } from '@/stores/settingsStore'
import { type SelectedModel, usableChatModel } from '@/utils/modelReadiness'

/** The provider's first chat model (models without a type are chat models). */
function firstChatModelId(provider: ProviderInfo): string | undefined {
  return (provider.models ?? provider.defaultSettings?.models)?.find((m) => !m.type || m.type === 'chat')?.modelId
}

/**
 * Providers the user set up themselves for chat. ComfyUI only makes pictures, and OpenClaw counts only once the user
 * configured it (the picker also lists it from its default model alone).
 */
function userChatProviders(settings: Pick<Settings, 'providers' | 'customProviders'>): ProviderInfo[] {
  return chatProvidersFromSettings(settings.providers, settings.customProviders).filter((p) => {
    if (p.id === ModelProviderEnum.ComfyUI) return false
    if (p.id === ModelProviderEnum.OpenClaw) {
      const own = settings.providers?.[p.id]
      return hasProviderCredentials(own) || Boolean(own?.models?.length)
    }
    return Boolean(firstChatModelId(p))
  })
}

/**
 * The default chat model to save, if the choice is obvious: there is no usable default or last-used model, and exactly
 * one provider the user set up has a chat model. With two or more, nothing is chosen for the user (Review's "no model"
 * item asks).
 */
export function obviousDefaultChatModel(
  settings: Pick<Settings, 'providers' | 'customProviders' | 'defaultChatModel'>,
  lastUsedChat: SelectedModel | undefined
): { provider: string; model: string } | undefined {
  const providers = chatProvidersFromSettings(settings.providers, settings.customProviders)
  if (usableChatModel({ defaultChatModel: settings.defaultChatModel, lastUsedChat }, providers)) return undefined
  const candidates = userChatProviders(settings)
  if (candidates.length !== 1) return undefined
  const model = firstChatModelId(candidates[0])
  return model ? { provider: candidates[0].id, model } : undefined
}

/**
 * Saves the obvious default chat model (see `obviousDefaultChatModel`). Called whenever providers change in the main
 * window, so a model set up outside first run's model step (the "Ollama and other providers" link, Settings, an
 * upgrade) still leaves a default for chats and background review (finding 13).
 */
export function ensureDefaultChatModel(): void {
  const settings = settingsStore.getState()
  const next = obviousDefaultChatModel(settings, lastUsedModelStore.getState().chat)
  if (next) settings.setSettings({ defaultChatModel: next })
}
