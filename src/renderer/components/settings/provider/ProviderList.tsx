/// <reference types="vite/client" />

import {
  Button,
  Flex,
  Image,
  Indicator,
  Popover,
  ScrollArea,
  Stack,
  Text,
  TextInput,
  UnstyledButton,
} from '@mantine/core'
import { isProviderListedInSettings } from '@shared/providers/provider-credentials'
import type { ProviderBaseInfo } from '@shared/types'
import { IconChevronRight, IconFileImport, IconPlus, IconPuzzle, IconSearch } from '@tabler/icons-react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CustomProviderIcon from '@/components/CustomProviderIcon'
import Divider from '@/components/common/Divider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'

// @ts-ignore - import.meta.glob is a Vite feature
const iconsModules = import.meta.glob<{ default: string }>('../../../static/icons/providers/*.png', { eager: true })

const icons: { name: string; src: string }[] = Object.entries(iconsModules).map(([path, module]) => {
  const filename = path.split('/').pop() || ''
  const name = filename.replace('.png', '')
  return {
    name,
    src: (module as { default: string }).default,
  }
})

function ProviderIcon({ provider, size = 28 }: { provider: ProviderBaseInfo; size?: number }) {
  if (provider.isCustom) {
    return provider.iconUrl ? (
      <Image w={size} h={size} src={provider.iconUrl} alt={provider.name} className="rounded-md shrink-0" />
    ) : (
      <CustomProviderIcon providerId={provider.id} providerName={provider.name} size={size} />
    )
  }
  const iconSrc = icons.find((icon) => icon.name === provider.id)?.src
  return iconSrc ? (
    <Image w={size} h={size} src={iconSrc} alt={provider.name} className="rounded-md shrink-0" />
  ) : (
    <CustomProviderIcon providerId={provider.id} providerName={provider.name} size={size} />
  )
}

interface ProviderListProps {
  /** Full catalog (system + custom), not only active */
  providers: ProviderBaseInfo[]
  onAddCustomProvider: () => void
  onImportProvider: () => void
  isImporting: boolean
}

export function ProviderList({ providers, onAddCustomProvider, onImportProvider, isImporting }: ProviderListProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isSmallScreen = useIsSmallScreen()
  const routerState = useRouterState()
  const providersMap = useSettingsStore((s) => s.providers)
  const [addOpen, setAddOpen] = useState(false)
  // Off when the menu closes into a dialog, so focus stays in the dialog instead of returning to Add
  const [returnFocusOnClose, setReturnFocusOnClose] = useState(true)
  const [query, setQuery] = useState('')

  const selectedProviderId = useMemo(() => {
    const pathSegments = routerState.location.pathname.split('/').filter(Boolean)
    const providerIndex = pathSegments.indexOf('provider')
    return providerIndex !== -1 ? pathSegments[providerIndex + 1] : undefined
  }, [routerState.location.pathname])

  const { providers: chatReadyProviders } = useProviders()
  const chatReadyIds = useMemo(() => new Set(chatReadyProviders.map((p) => p.id)), [chatReadyProviders])

  /** Configured providers (+ currently open unconfigured, so setup still works after Add). */
  const listedProviders = useMemo(() => {
    return providers.filter((p) => {
      if (selectedProviderId && p.id === selectedProviderId) return true
      return isProviderListedInSettings(p, providersMap?.[p.id])
    })
  }, [providers, providersMap, selectedProviderId])

  /** Built-in templates not yet configured — offered under Add. */
  const addableTemplates = useMemo(() => {
    return providers.filter((p) => {
      if (p.isCustom) return false
      return !isProviderListedInSettings(p, providersMap?.[p.id])
    })
  }, [providers, providersMap])

  const filteredTemplates = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return addableTemplates
    return addableTemplates.filter((p) => {
      const name = t(p.name).toLowerCase()
      return name.includes(q) || p.id.toLowerCase().includes(q)
    })
  }, [addableTemplates, query, t])

  const closeAdd = () => {
    setAddOpen(false)
    setQuery('')
  }

  const handleAddTemplate = (providerId: string) => {
    closeAdd()
    void navigate({
      to: '/settings/provider/$providerId',
      params: { providerId },
    })
  }

  const handleCustom = () => {
    setReturnFocusOnClose(false)
    closeAdd()
    onAddCustomProvider()
  }

  const handleImport = () => {
    setReturnFocusOnClose(false)
    closeAdd()
    onImportProvider()
  }

  return (
    <Stack
      maw={isSmallScreen ? undefined : 256}
      className={clsx(
        'border-solid border-0 min-h-0',
        isSmallScreen ? 'w-full' : 'flex-[1_0_auto] settings-provider-list'
      )}
      gap={0}
    >
      <ScrollArea flex={1} type={isSmallScreen ? 'never' : 'hover'} scrollHideDelay={100} className="min-h-0">
        <Stack p={isSmallScreen ? 0 : 'xs'} gap={isSmallScreen ? 0 : 4}>
          {listedProviders.length === 0 && (
            <Text size="sm" c="chatbox-tertiary" px="sm" py="md" className="text-pretty">
              {t('No providers configured yet. Add a provider to get started.')}
            </Text>
          )}

          {listedProviders.map((provider) => {
            const isReady = chatReadyIds.has(provider.id)
            const isSelected = provider.id === selectedProviderId
            return (
              <Link
                key={provider.id}
                to="/settings/provider/$providerId"
                params={{ providerId: provider.id }}
                className="block no-underline"
              >
                <Flex
                  component="span"
                  align="center"
                  gap="xs"
                  p="md"
                  pr="xl"
                  py={isSmallScreen ? 'sm' : undefined}
                  c={isSelected ? 'chatbox-primary' : 'chatbox-secondary'}
                  bg={isSelected ? 'var(--chatbox-background-brand-secondary)' : 'transparent'}
                  className={clsx(
                    'settings-provider-row cursor-pointer select-none rounded-md',
                    isSelected ? 'settings-provider-row-on' : 'hover:!bg-chatbox-background-gray-secondary'
                  )}
                >
                  <ProviderIcon provider={provider} />

                  <Text
                    span
                    size="sm"
                    flex={1}
                    className="!text-inherit whitespace-nowrap overflow-hidden text-ellipsis min-w-0"
                  >
                    {t(provider.name)}
                  </Text>

                  {isReady && <Indicator size={8} color="chatbox-success" className="shrink-0" />}

                  {!isReady && isSelected && (
                    <Text size="xs" c="chatbox-tertiary" className="shrink-0">
                      {t('Setup')}
                    </Text>
                  )}

                  {isSmallScreen && (
                    <ScalableIcon icon={IconChevronRight} size={20} className="!text-chatbox-tint-tertiary shrink-0" />
                  )}
                </Flex>

                {isSmallScreen && <Divider />}
              </Link>
            )
          })}
        </Stack>
      </ScrollArea>

      <div className="settings-provider-list-footer shrink-0">
        <Popover
          opened={addOpen}
          onChange={setAddOpen}
          position={isSmallScreen ? 'top' : 'right-end'}
          offset={10}
          shadow="md"
          radius="md"
          width={isSmallScreen ? 'target' : 300}
          withinPortal
          middlewares={{ flip: true, shift: true, size: true }}
          trapFocus
          returnFocus={returnFocusOnClose}
        >
          <Popover.Target>
            <Button
              variant="outline"
              fullWidth
              leftSection={<ScalableIcon icon={IconPlus} />}
              onClick={() => {
                setReturnFocusOnClose(true)
                setAddOpen((v) => !v)
              }}
              aria-expanded={addOpen}
            >
              {t('Add')}
            </Button>
          </Popover.Target>
          <Popover.Dropdown className="settings-provider-add-popover p-0 overflow-hidden" p={0}>
            <div className="settings-provider-add-panel">
              <div className="settings-provider-add-header">
                <Text size="xs" fw={600} c="chatbox-tertiary" className="settings-section-label">
                  {t('Add provider')}
                </Text>
                <TextInput
                  placeholder={t('Search templates…')}
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  leftSection={<ScalableIcon icon={IconSearch} size={14} />}
                  size="sm"
                  autoFocus
                  className="settings-provider-add-search"
                />
              </div>

              <ScrollArea.Autosize mah="min(52vh, 360px)" type="scroll" offsetScrollbars scrollbarSize={6}>
                <div className="settings-provider-add-list">
                  {filteredTemplates.length === 0 ? (
                    <Text size="sm" c="chatbox-tertiary" px="sm" py="md">
                      {addableTemplates.length === 0
                        ? t('All built-in providers are already added.')
                        : t('No templates match your search.')}
                    </Text>
                  ) : (
                    filteredTemplates.map((provider) => (
                      <UnstyledButton
                        key={provider.id}
                        className="settings-provider-add-item"
                        onClick={() => handleAddTemplate(provider.id)}
                      >
                        <ProviderIcon provider={provider} size={24} />
                        <Text size="sm" className="min-w-0 truncate">
                          {t(provider.name)}
                        </Text>
                      </UnstyledButton>
                    ))
                  )}
                </div>
              </ScrollArea.Autosize>

              <div className="settings-provider-add-footer">
                <UnstyledButton className="settings-provider-add-item" onClick={handleCustom}>
                  <ScalableIcon icon={IconPuzzle} size={20} className="text-chatbox-tint-secondary shrink-0" />
                  <Text size="sm">{t('Custom provider…')}</Text>
                </UnstyledButton>
                {platform.formFactor !== 'mobile' && (
                  <UnstyledButton className="settings-provider-add-item" onClick={handleImport} disabled={isImporting}>
                    <ScalableIcon icon={IconFileImport} size={20} className="text-chatbox-tint-secondary shrink-0" />
                    <Text size="sm">{t('Import from clipboard')}</Text>
                  </UnstyledButton>
                )}
              </div>
            </div>
          </Popover.Dropdown>
        </Popover>
      </div>
    </Stack>
  )
}
