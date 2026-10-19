import {
  Button,
  Collapse,
  Combobox,
  type ComboboxProps,
  Flex,
  SegmentedControl,
  Stack,
  Text,
  TextInput,
  useCombobox,
} from '@mantine/core'
import type { ProviderModelInfo } from '@shared/types'
import { IconSearch } from '@tabler/icons-react'
import clsx from 'clsx'
import { useAtom } from 'jotai'
import { cloneElement, forwardRef, isValidElement, type MouseEvent, type ReactElement, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviders } from '@/hooks/useProviders'
import { navigateToSettings } from '@/modals/Settings'
import { collapsedProvidersAtom } from '@/stores/atoms/uiAtoms'
import { ScalableIcon } from '../common/ScalableIcon'
import { ProviderHeader } from './ProviderHeader'
import { groupFavoriteModels, ModelItem, SELECTED_BG_CLASS } from './shared'

type FilteredProvider = {
  id: string
  name: string
  isCustom?: boolean
  models?: ProviderModelInfo[]
}

interface DesktopModelSelectorProps {
  children: React.ReactNode
  showAuto?: boolean
  autoText?: string
  selectedProviderId?: string
  selectedModelId?: string
  activeTab: string | null
  search: string
  filteredProviders: FilteredProvider[]
  onTabChange: (tab: string | null) => void
  onSearchChange: (search: string) => void
  onOptionSubmit: (val: string) => void
  onDropdownOpen?: () => void
  onDropdownClose?: () => void
  modelFilter?: (model: ProviderModelInfo) => boolean
  comboboxProps?: ComboboxProps
  searchPosition?: 'top' | 'bottom'
}

// Search + All/Favorite — pinned toolbar (not sticky-inside scroller)
const SearchBox = ({
  search,
  activeTab,
  onSearchChange,
  onTabChange,
  t,
}: {
  search: string
  activeTab: string | null
  onSearchChange: (value: string) => void
  onTabChange: (value: string | null) => void
  t: (key: string) => string
}) => (
  <Flex align="center" gap={8} className="model-picker-search">
    <Flex align="center" gap={6} className="model-picker-search-field flex-1 min-w-0">
      <ScalableIcon icon={IconSearch} size={14} className="text-[var(--chatbox-tint-tertiary)] shrink-0" />
      <TextInput
        value={search}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        placeholder={t('Search models') as string}
        aria-label={t('Search models') as string}
        variant="unstyled"
        className="flex-1 min-w-0"
        rightSection={
          search ? (
            <button
              type="button"
              className="model-picker-search-clear active:scale-[0.96]"
              onClick={() => onSearchChange('')}
              aria-label={t('Clear') as string}
            >
              ×
            </button>
          ) : null
        }
        styles={{
          input: {
            padding: 0,
            height: 'auto',
            minHeight: 'auto',
            fontSize: '0.8125rem',
            color: 'var(--chatbox-tint-primary)',
            background: 'transparent',
          },
        }}
      />
    </Flex>
    <SegmentedControl
      value={activeTab || 'all'}
      onChange={(value) => onTabChange(value)}
      data={[
        { label: t('All'), value: 'all' },
        { label: t('Favorite'), value: 'favorite' },
      ]}
      size="xs"
      className="model-picker-tabs shrink-0"
      styles={{
        root: {
          background: 'var(--chatbox-background-primary)',
          // soft inset chrome instead of hard border
          boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--chatbox-tint-primary) 10%, transparent)',
          border: 'none',
          borderRadius: 6,
          padding: 2,
        },
        label: {
          fontSize: '0.6875rem',
          fontWeight: 500,
          paddingLeft: 10,
          paddingRight: 10,
          color: 'var(--chatbox-tint-tertiary)',
          letterSpacing: '-0.01em',
        },
        indicator: {
          background: 'var(--chatbox-background-tertiary)',
          borderRadius: 4,
          boxShadow: '0 1px 2px color-mix(in srgb, var(--chatbox-tint-primary) 8%, transparent)',
        },
      }}
    />
  </Flex>
)

export const DesktopModelSelector = forwardRef<HTMLDivElement, DesktopModelSelectorProps>(
  (
    {
      children,
      showAuto,
      autoText,
      selectedProviderId,
      selectedModelId,
      activeTab,
      search,
      filteredProviders,
      onTabChange,
      onSearchChange,
      onOptionSubmit,
      onDropdownOpen,
      onDropdownClose,
      comboboxProps,
      searchPosition = 'bottom',
    },
    ref
  ) => {
    const { t } = useTranslation()
    const { favoritedModels, favoriteModel, unfavoriteModel, isFavoritedModel } = useProviders()
    const [collapsedProviders, setCollapsedProviders] = useAtom(collapsedProvidersAtom)

    const toggleProviderCollapse = (providerId: string) => {
      setCollapsedProviders((prev) => ({
        ...prev,
        [providerId]: !prev[providerId],
      }))
    }

    const combobox = useCombobox({
      onDropdownClose: () => {
        combobox.resetSelectedOption()
        onSearchChange('')
        onDropdownClose?.()
      },
      onDropdownOpen: () => {
        onDropdownOpen?.()
      },
    })

    const isEmpty = useMemo(
      () => filteredProviders.reduce((pre, cur) => pre + (cur.models?.length || 0), 0) === 0,
      [filteredProviders]
    )

    const groups = filteredProviders.map((provider) => {
      const isCollapsed = collapsedProviders[provider.id] || false
      const options = provider.models?.map((model: ProviderModelInfo) => {
        const isFavorited = isFavoritedModel(provider.id, model.modelId)
        return (
          <ModelItem
            key={`${provider.id}/${model.modelId}`}
            providerId={provider.id}
            model={model}
            isFavorited={isFavorited}
            isSelected={selectedProviderId === provider.id && selectedModelId === model.modelId}
            onToggleFavorited={() => {
              if (isFavorited) {
                unfavoriteModel(provider.id, model.modelId)
              } else {
                favoriteModel(provider.id, model.modelId)
              }
            }}
          />
        )
      })

      if (!provider.models?.length) return null

      return (
        <div key={provider.id} className="model-picker-group">
          <ProviderHeader
            provider={provider}
            modelCount={provider.models?.length || 0}
            isCollapsed={isCollapsed}
            onClick={() => toggleProviderCollapse(provider.id)}
          />
          <Collapse in={!isCollapsed}>
            <div className="model-picker-models pb-1 relative z-0">{options}</div>
          </Collapse>
        </div>
      )
    })

    const handleOptionSubmit = (val: string) => {
      onOptionSubmit(val)
      combobox.closeDropdown()
    }

    // Prefer search on top (app picker DNA); allow override via prop
    const searchAtTop = searchPosition !== 'bottom'

    return (
      <Combobox
        store={combobox}
        width={340}
        withinPortal={true}
        shadow="none"
        transitionProps={{ transition: 'pop', duration: 140, timingFunction: 'cubic-bezier(0.2, 0, 0, 1)' }}
        {...comboboxProps}
        onOptionSubmit={handleOptionSubmit}
        classNames={{
          dropdown: 'model-picker-dropdown',
          options: 'model-picker-options',
        }}
      >
        <Combobox.Target targetType="button">
          {isValidElement(children) ? (
            cloneElement(children as ReactElement, {
              onClick: (e: MouseEvent<HTMLButtonElement, MouseEvent>) => {
                children.props?.onClick?.(e)
                combobox.toggleDropdown()
              },
              ref,
            })
          ) : (
            <button onClick={() => combobox.toggleDropdown()} className="border-none bg-transparent p-0 flex">
              {children}
            </button>
          )}
        </Combobox.Target>

        <Combobox.Dropdown className="model-picker-dropdown !p-0 overflow-hidden flex flex-col">
          {searchAtTop && (
            <div className="model-picker-toolbar shrink-0">
              <SearchBox
                search={search}
                activeTab={activeTab}
                onSearchChange={onSearchChange}
                onTabChange={onTabChange}
                t={t}
              />
            </div>
          )}

          <Combobox.Options
            mah={360}
            style={{ overflowY: 'auto', flex: '1 1 auto' }}
            className="model-picker-options px-1.5 pb-1.5 pt-1"
          >
            {showAuto && activeTab === 'all' && (
              <Combobox.Option
                value={''}
                className={clsx(
                  'model-picker-option',
                  !selectedProviderId && !selectedModelId && 'model-picker-option-on'
                )}
              >
                {autoText || t('Auto')}
              </Combobox.Option>
            )}
            {(isEmpty && !showAuto) ||
            (activeTab === 'favorite' && (!favoritedModels || favoritedModels.length === 0)) ? (
              <Stack gap="xs" py="md" align="center" className="overflow-hidden">
                <Text c="chatbox-tertiary" size="xs">
                  {activeTab === 'favorite' ? t('No favorite models') : t('No eligible models available')}
                </Text>
                {activeTab === 'all' && (
                  <Button
                    variant="light"
                    size="compact-xs"
                    color="chatbox-brand"
                    onClick={() => navigateToSettings('/provider')}
                  >
                    {t('Set up providers')}
                  </Button>
                )}
              </Stack>
            ) : activeTab === 'favorite' ? (
              <div>
                {Object.entries(groupFavoriteModels(favoritedModels)).map(([providerId, group]) => (
                  <div key={providerId} className="model-picker-group">
                    <ProviderHeader
                      provider={group.provider || { id: providerId, name: providerId }}
                      showChevron={false}
                      showModelCount={false}
                    />
                    <div>
                      {group.models.map((fm) => {
                        if (!fm.provider || !fm.model) return null
                        return (
                          <ModelItem
                            key={`${fm.provider.id}/${fm.model.modelId}`}
                            providerId={fm.provider.id}
                            model={fm.model}
                            isFavorited={true}
                            isSelected={selectedProviderId === fm.provider.id && selectedModelId === fm.model.modelId}
                            hideFavoriteIcon={true}
                            onToggleFavorited={() => {
                              if (fm.provider && fm.model) {
                                unfavoriteModel(fm.provider.id, fm.model.modelId)
                              }
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <>
                {favoritedModels && favoritedModels.length > 0 && (
                  <div className="model-picker-group">
                    <ProviderHeader
                      provider={{ id: 'favorite', name: t('Favorite') }}
                      variant="favorite"
                      showChevron={false}
                      showModelCount={false}
                    />
                    <div>
                      {favoritedModels?.map((fm) => {
                        if (!fm.provider || !fm.model) return null
                        return (
                          <ModelItem
                            key={`${fm.provider.id}/${fm.model.modelId}`}
                            providerId={fm.provider.id}
                            providerName={fm.provider.name}
                            model={fm.model}
                            isFavorited={true}
                            isSelected={selectedProviderId === fm.provider.id && selectedModelId === fm.model.modelId}
                            hideFavoriteIcon={true}
                            onToggleFavorited={() => {
                              if (fm.provider && fm.model) {
                                unfavoriteModel(fm.provider.id, fm.model.modelId)
                              }
                            }}
                          />
                        )
                      })}
                    </div>
                  </div>
                )}
                {groups}
              </>
            )}
          </Combobox.Options>

          {!searchAtTop && (
            <div className="model-picker-toolbar shrink-0">
              <SearchBox
                search={search}
                activeTab={activeTab}
                onSearchChange={onSearchChange}
                onTabChange={onTabChange}
                t={t}
              />
            </div>
          )}
        </Combobox.Dropdown>
      </Combobox>
    )
  }
)
