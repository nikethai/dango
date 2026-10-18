/** biome-ignore-all lint/style/noNonNullAssertion: <todo> */
import { Flex, Text } from '@mantine/core'
import { SystemProviders } from '@shared/defaults'
import { readCostWarningUsd } from '@shared/types/settings'
import { IconSelector } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { forwardRef, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import ModelSelector from '@/components/ModelSelector'
import { CostWarningRow } from '@/components/settings/CostWarningRow'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsPrefRow } from '@/components/settings/SettingsPrefRow'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/default-models')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t('Default Models')}
        description={t('Models used when a session does not pick one explicitly.')}
      />

      <SettingsSection title={t('Models')}>
        <SettingsCard divided>
          <SettingsPrefRow
            title={t('Default Chat Model')}
            description={t('Dango will use this model as the default for new chats.')}
            align="start"
            control={
              <ModelSelector
                position="bottom-start"
                transitionProps={{
                  transition: 'fade-down',
                  duration: 200,
                }}
                keepMounted
                width={280}
                showAuto={true}
                autoText={t('Auto (Use Last Used)')!}
                selectedProviderId={settings.defaultChatModel?.provider}
                selectedModelId={settings.defaultChatModel?.model}
                searchPosition="top"
                onSelect={(provider, model) => {
                  setSettings({
                    defaultChatModel:
                      provider && model
                        ? {
                            provider,
                            model,
                          }
                        : undefined,
                  })
                }}
              >
                <ModelSelectContent
                  autoText={t('Auto (Use Last Used)')!}
                  provider={settings.defaultChatModel?.provider}
                  model={settings.defaultChatModel?.model}
                />
              </ModelSelector>
            }
          />

          <SettingsPrefRow
            title={t('Default Thread Naming Model')}
            description={t('Dango will automatically use this model to rename threads.')}
            align="start"
            control={
              <ModelSelector
                position="bottom-start"
                width={280}
                showAuto={true}
                autoText={t('Auto (Use Chat Model)')!}
                selectedProviderId={settings.threadNamingModel?.provider}
                selectedModelId={settings.threadNamingModel?.model}
                searchPosition="top"
                onSelect={(provider, model) =>
                  setSettings({
                    threadNamingModel:
                      provider && model
                        ? {
                            provider,
                            model,
                          }
                        : undefined,
                  })
                }
              >
                <ModelSelectContent
                  autoText={t('Auto (Use Chat Model)')!}
                  provider={settings.threadNamingModel?.provider}
                  model={settings.threadNamingModel?.model}
                />
              </ModelSelector>
            }
          />

          <SettingsPrefRow
            title={t('Search Term Construction Model')}
            description={t('Dango will automatically use this model to construct search term.')}
            align="start"
            control={
              <ModelSelector
                position="bottom-start"
                width={280}
                showAuto={true}
                autoText={t('Auto (Use Chat Model)')!}
                selectedProviderId={settings.searchTermConstructionModel?.provider}
                selectedModelId={settings.searchTermConstructionModel?.model}
                searchPosition="top"
                onSelect={(provider, model) =>
                  setSettings({
                    searchTermConstructionModel:
                      provider && model
                        ? {
                            provider,
                            model,
                          }
                        : undefined,
                  })
                }
              >
                <ModelSelectContent
                  autoText={t('Auto (Use Chat Model)')!}
                  provider={settings.searchTermConstructionModel?.provider}
                  model={settings.searchTermConstructionModel?.model}
                />
              </ModelSelector>
            }
          />

          <SettingsPrefRow
            title={t('OCR Model')}
            description={t('Dango OCRs images with this model and sends the text to models without image support.')}
            align="start"
            control={
              <ModelSelector
                position="bottom-start"
                showAuto={true}
                autoText={t('None')!}
                width={280}
                modelFilter={(model) => model.capabilities?.includes('vision') ?? false}
                selectedProviderId={settings.ocrModel?.provider}
                selectedModelId={settings.ocrModel?.model}
                searchPosition="top"
                onSelect={(provider, model) =>
                  setSettings({
                    ocrModel:
                      provider && model
                        ? {
                            provider,
                            model,
                          }
                        : undefined,
                  })
                }
              >
                <ModelSelectContent
                  autoText={t('None')!}
                  provider={settings.ocrModel?.provider}
                  model={settings.ocrModel?.model}
                />
              </ModelSelector>
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('Cost')}>
        <SettingsCard>
          <CostWarningRow
            value={readCostWarningUsd(settings.costWarningUsd)}
            onChange={(costWarningUsd) => setSettings({ costWarningUsd })}
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}

const ModelSelectContent = forwardRef<
  HTMLButtonElement,
  { provider?: string; model?: string; autoText?: string; onClick?: () => void }
>(({ provider, model, autoText, onClick }, ref) => {
  const { t } = useTranslation()
  const customProviders = useSettingsStore((state) => state.customProviders)
  const providers = useSettingsStore((state) => state.providers)
  const displayText = useMemo(
    () =>
      !provider || !model
        ? autoText || t('Auto')
        : ([...SystemProviders(), ...(customProviders || [])].find((p) => p.id === provider)?.name || provider) +
          '/' +
          ((
            providers?.[provider]?.models || SystemProviders().find((p) => p.id === provider)?.defaultSettings?.models
          )?.find((m) => m.modelId === model)?.nickname || model),
    [provider, model, autoText, t, customProviders, providers]
  )
  return (
    <Flex
      ref={ref}
      px={12}
      py={6}
      component="button"
      align="center"
      c="chatbox-tertiary"
      w={280}
      className="settings-model-trigger border-solid border border-chatbox-border-primary cursor-pointer"
      onClick={onClick}
    >
      <Text span flex={1} className="text-left" lineClamp={1}>
        {displayText}
      </Text>
      <ScalableIcon icon={IconSelector} className="text-inherit" />
    </Flex>
  )
})
