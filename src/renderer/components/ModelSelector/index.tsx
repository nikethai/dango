import type { ComboboxProps } from '@mantine/core'
import type { ModelProvider, ProviderModelInfo } from '@shared/types'
import { useRouterState } from '@tanstack/react-router'
import { forwardRef, type PropsWithChildren, useMemo, useState } from 'react'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { formatModelDisplayName, isNonChatComposerModel } from '@/utils/modelDisplayName'
import { DesktopModelSelector } from './DesktopModelSelector'
import { MobileModelSelector } from './MobileModelSelector'

export type { FavoriteModel } from './shared'
// Re-export shared components and utilities
export { groupFavoriteModels, ModelItem, ModelItemInDrawer, SELECTED_BG_CLASS, TRANSITION_DURATION } from './shared'

export type ModelSelectorProps = PropsWithChildren<
  {
    showAuto?: boolean
    autoText?: string
    onSelect?: (provider: ModelProvider | string, model: string) => void
    onDropdownOpen?: () => void
    /** The list closed (picked, dismissed or Escape). */
    onDropdownClose?: () => void
    modelFilter?: (model: ProviderModelInfo) => boolean
    selectedProviderId?: string
    selectedModelId?: string
    searchPosition?: 'top' | 'bottom'
  } & ComboboxProps
>

export const ModelSelector = forwardRef<HTMLDivElement, ModelSelectorProps>(
  (
    {
      showAuto,
      autoText,
      onSelect,
      onDropdownOpen,
      onDropdownClose,
      children,
      modelFilter,
      selectedProviderId,
      selectedModelId,
      searchPosition = 'top',
      ...comboboxProps
    },
    ref
  ) => {
    const { providers, isFavoritedModel } = useProviders()
    const [activeTab, setActiveTab] = useState<string | null>('all')
    const [search, setSearch] = useState('')

    const filteredProviders = useMemo(() => {
      const q = search.toLowerCase().trim()
      const filtered = providers.map((provider) => {
        const models = provider.models?.filter((model) => {
          if (model.type && model.type !== 'chat') return false
          // Chat picker only — keep image/video/paint out of the main model list
          if (!modelFilter && isNonChatComposerModel(model)) return false
          if (modelFilter && !modelFilter(model)) return false
          if (!q) return true
          const label = formatModelDisplayName(model.modelId, model.nickname).toLowerCase()
          return (
            provider.id.toLowerCase().includes(q) ||
            provider.name.toLowerCase().includes(q) ||
            label.includes(q) ||
            model.nickname?.toLowerCase().includes(q) ||
            model.modelId?.toLowerCase().includes(q)
          )
        })
        return {
          ...provider,
          models,
        }
      })

      return filtered
    }, [providers, search, modelFilter, activeTab, isFavoritedModel])

    const handleOptionSubmit = (val: string) => {
      if (!val) {
        onSelect?.('', '')
      } else {
        const selectedProvider = providers.find((p) =>
          (p.models || p.defaultSettings?.models)?.find((m) => val === `${p.id}/${m.modelId}`)
        )
        const selectedModel = (selectedProvider?.models || selectedProvider?.defaultSettings?.models)?.find(
          (m) => val === `${selectedProvider.id}/${m.modelId}`
        )

        if (selectedProvider && selectedModel) {
          onSelect?.(selectedProvider.id, selectedModel.modelId)
        }
      }
    }

    // Quick Chat is ~520px so sm-breakpoint would pick the 85vh mobile drawer — force
    // the compact desktop combobox for the floating HUD instead.
    const isQuickChat = useRouterState({
      select: (s) => s.location.pathname === '/quick',
    })
    const isSmallScreen = useIsSmallScreen() && !isQuickChat

    return isSmallScreen ? (
      <MobileModelSelector
        ref={ref}
        showAuto={showAuto}
        autoText={autoText}
        selectedProviderId={selectedProviderId}
        selectedModelId={selectedModelId}
        activeTab={activeTab}
        search={search}
        filteredProviders={filteredProviders}
        onTabChange={setActiveTab}
        onSearchChange={setSearch}
        onOptionSubmit={handleOptionSubmit}
        onDropdownOpen={onDropdownOpen}
        onDropdownClose={onDropdownClose}
        modelFilter={modelFilter}
      >
        {children}
      </MobileModelSelector>
    ) : (
      <DesktopModelSelector
        ref={ref}
        showAuto={showAuto}
        autoText={autoText}
        selectedProviderId={selectedProviderId}
        selectedModelId={selectedModelId}
        activeTab={activeTab}
        search={search}
        filteredProviders={filteredProviders}
        onTabChange={setActiveTab}
        onSearchChange={setSearch}
        onOptionSubmit={handleOptionSubmit}
        onDropdownOpen={onDropdownOpen}
        onDropdownClose={onDropdownClose}
        modelFilter={modelFilter}
        comboboxProps={isQuickChat ? { width: 320, ...comboboxProps } : comboboxProps}
        searchPosition={searchPosition}
      >
        {children}
      </DesktopModelSelector>
    )
  }
)

export default ModelSelector
