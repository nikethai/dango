import { chatProvidersFromSettings } from '@/hooks/useProviders'
import { type SelectedModel, usableChatModel, usablePictureModel } from '@/utils/modelReadiness'
import { lastUsedModelStore } from './lastUsedModelStore'
import { settingsStore } from './settingsStore'

/** The set-up providers, read from the settings store outside React. */
export function setUpProviders() {
  const settings = settingsStore.getState().getSettings()
  return chatProvidersFromSettings(settings.providers, settings.customProviders)
}

/** The model a new chat or picture chat is created with (see `usableChatModel`), or none. */
export function newSessionModel(type: 'chat' | 'picture' = 'chat'): SelectedModel | undefined {
  const providers = setUpProviders()
  const lastUsed = lastUsedModelStore.getState()
  if (type === 'picture') return usablePictureModel(lastUsed.picture, providers)
  const { defaultChatModel } = settingsStore.getState().getSettings()
  return usableChatModel({ defaultChatModel, lastUsedChat: lastUsed.chat }, providers)
}
