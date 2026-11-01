import { getProviderDefinition, getSystemProviders } from '@shared/providers'
import {
  type ModelProvider,
  type ModelProviderType,
  type SessionSettings,
  type SessionType,
  type Settings,
} from '@shared/types'
import CustomProviderSettingUtil from './custom-provider-setting-util'
import type { ModelSettingUtil } from './interface'
import RegistrySettingUtil from './registry-setting-util'

export function getModelSettingUtil(
  aiProvider: ModelProvider,
  customProviderType?: ModelProviderType
): ModelSettingUtil {
  if (getProviderDefinition(aiProvider)) {
    return new RegistrySettingUtil(aiProvider)
  }
  return new CustomProviderSettingUtil(aiProvider, customProviderType)
}

export function getModelDisplayName(
  settings: SessionSettings,
  globalSettings: Settings,
  sessionType: SessionType
): Promise<string> {
  // No model chosen: no name (never another provider's).
  const provider = settings.provider
  if (!provider) return Promise.resolve('')
  const model = settings.modelId ?? ''

  const registryProviders = getSystemProviders()
  const providerBaseInfo =
    globalSettings.customProviders?.find((p) => p.id === provider) || registryProviders.find((p) => p.id === provider)

  const util = getModelSettingUtil(provider, providerBaseInfo?.isCustom ? providerBaseInfo.type : undefined)
  const providerSettings = globalSettings.providers?.[provider]
  return util.getCurrentModelDisplayName(model, sessionType, providerSettings, providerBaseInfo)
}
