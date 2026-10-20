import { SystemProviders } from '@shared/defaults'
import { hasProviderCredentials } from '@shared/providers/provider-credentials'
import { ModelProviderEnum, type ProviderInfo, type Settings } from '@shared/types'
import { useCallback, useMemo } from 'react'
import { useSettingsStore } from '@/stores/settingsStore'

/** Providers ready for chat model selection (credentials / local models), from the settings outside React. */
export function chatProvidersFromSettings(
  providerSettingsMap: Settings['providers'],
  customProviders: Settings['customProviders']
): ProviderInfo[] {
  return [...SystemProviders(), ...(customProviders || [])]
    .map((p) => {
      const providerSettings = providerSettingsMap?.[p.id]
      // Builtin: API key OR OAuth. Local/custom: models list (OpenClaw/ComfyUI may use defaults).
      if (
        (!p.isCustom && hasProviderCredentials(providerSettings)) ||
        ((p.isCustom ||
          p.id === ModelProviderEnum.Ollama ||
          p.id === ModelProviderEnum.LMStudio ||
          p.id === ModelProviderEnum.OpenClaw ||
          p.id === ModelProviderEnum.ComfyUI) &&
          (providerSettings?.models?.length ||
            ((p.id === ModelProviderEnum.OpenClaw || p.id === ModelProviderEnum.ComfyUI) &&
              p.defaultSettings?.models?.length)))
      ) {
        return {
          models: p.defaultSettings?.models,
          ...p,
          ...providerSettings,
        } as ProviderInfo
      }
      return null
    })
    .filter((p) => !!p)
}

/** Providers ready for chat model selection (credentials / local models). */
export const useProviders = () => {
  const setSettings = useSettingsStore((state) => state.setSettings)
  const providerSettingsMap = useSettingsStore((state) => state.providers)
  const customProviders = useSettingsStore((state) => state.customProviders)
  const favoritedModelsSettings = useSettingsStore((state) => state.favoritedModels)

  const providers = useMemo(
    () => chatProvidersFromSettings(providerSettingsMap, customProviders),
    [providerSettingsMap, customProviders]
  )

  const favoritedModels = useMemo(
    () =>
      favoritedModelsSettings
        ?.map((m) => {
          const provider = providers.find((p) => p.id === m.provider)
          const model = (provider?.models || provider?.defaultSettings?.models)?.find((mm) => mm.modelId === m.model)

          if (provider && model) {
            return {
              provider,
              model,
            }
          }
        })
        .filter((fm) => !!fm),
    [favoritedModelsSettings, providers]
  )

  const favoriteModel = useCallback(
    (provider: string, model: string) => {
      setSettings({
        favoritedModels: [
          ...(favoritedModelsSettings || []),
          {
            provider,
            model,
          },
        ],
      })
    },
    [favoritedModelsSettings, setSettings]
  )

  const unfavoriteModel = useCallback(
    (provider: string, model: string) => {
      setSettings({
        favoritedModels: (favoritedModelsSettings || []).filter((m) => m.provider !== provider || m.model !== model),
      })
    },
    [favoritedModelsSettings, setSettings]
  )

  const isFavoritedModel = useCallback(
    (provider: string, model: string) =>
      !!favoritedModels?.find((m) => m.provider?.id === provider && m.model?.modelId === model),
    [favoritedModels]
  )

  return {
    providers,
    favoritedModels,
    favoriteModel,
    unfavoriteModel,
    isFavoritedModel,
  }
}
