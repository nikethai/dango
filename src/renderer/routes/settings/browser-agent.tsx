import { Alert, NumberInput, Switch, TagsInput, Text } from '@mantine/core'
import { IconInfoCircle } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsPrefRow } from '@/components/settings/SettingsPrefRow'
import { SettingsSection } from '@/components/settings/SettingsSection'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/browser-agent')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((s) => s.setSettings)
  const extension = useSettingsStore((s) => s.extension)
  const browserAgent = useMemo(
    () => ({
      enabled: false,
      headless: false,
      maxStepsPerTurn: 12,
      allowlist: [] as string[],
      ...(extension.browserAgent || {}),
    }),
    [extension.browserAgent]
  )

  const desktop = platform.type === 'desktop'

  const patch = (partial: Partial<typeof browserAgent>) => {
    setSettings({
      extension: {
        ...extension,
        browserAgent: { ...browserAgent, ...partial },
      },
    })
  }

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t('Browser agent')}
        description={t('Isolated browser for multi-step web tasks. Not your personal Chrome.')}
      />

      {!desktop && (
        <Alert icon={<IconInfoCircle size={16} />} color="yellow" mb="md">
          {t('Browser agent is only available in the desktop app.')}
        </Alert>
      )}

      <SettingsSection title={t('General')}>
        <SettingsCard divided>
          <SettingsPrefRow
            title={t('Enable browser agent')}
            description={t('Master switch. Arm “Dango Browser” per chat from the composer + menu.')}
            control={
              <Switch
                checked={browserAgent.enabled}
                disabled={!desktop}
                onChange={(e) => patch({ enabled: e.currentTarget.checked })}
                aria-label={t('Enable browser agent')}
              />
            }
          />
          <SettingsPrefRow
            title={t('Show browser window')}
            description={t('Recommended. Off runs headless.')}
            control={
              <Switch
                checked={!browserAgent.headless}
                disabled={!desktop || !browserAgent.enabled}
                onChange={(e) => patch({ headless: !e.currentTarget.checked })}
                aria-label={t('Show browser window')}
              />
            }
          />
          <SettingsPrefRow
            title={t('Max steps per turn')}
            description={t('Soft cap on browser tool calls per reply.')}
            control={
              <NumberInput
                min={1}
                max={50}
                step={1}
                size="sm"
                clampBehavior="strict"
                value={browserAgent.maxStepsPerTurn}
                disabled={!desktop || !browserAgent.enabled}
                onChange={(v) => patch({ maxStepsPerTurn: typeof v === 'number' ? v : 12 })}
                w={88}
                styles={{ input: { textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }}
                aria-label={t('Max steps per turn')}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('Allowlist')}
        description={t('Optional. Empty = any http(s) host, still approval-gated.')}
      >
        <SettingsCard>
          <TagsInput
            placeholder={t('example.com')}
            value={browserAgent.allowlist || []}
            disabled={!desktop || !browserAgent.enabled}
            onChange={(allowlist) => patch({ allowlist })}
            clearable
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('Safety')}>
        <SettingsCard divided>
          <SettingsPrefRow
            title={t('Isolated profile')}
            description={t('Fresh cookies each session — never your daily Chrome profile.')}
            control={
              <Text size="xs" c="dimmed">
                {t('Always on')}
              </Text>
            }
          />
          <SettingsPrefRow
            title={t('Approvals')}
            description={t('Navigate, click, and type require approval. Critical tools never auto-approve.')}
            control={
              <Text size="xs" c="dimmed">
                {t('Required')}
              </Text>
            }
          />
          <SettingsPrefRow
            title={t('Downloads')}
            description={t('Only into the session workspace folder. Blocked if no workspace is set.')}
            control={
              <Text size="xs" c="dimmed">
                {t('Workspace')}
              </Text>
            }
          />
          <SettingsPrefRow
            title={t('Rooms')}
            description={t('Discuss: off. Work / swarm: lead only.')}
            control={
              <Text size="xs" c="dimmed">
                {t('Policy')}
              </Text>
            }
          />
        </SettingsCard>
      </SettingsSection>
    </SettingsPage>
  )
}
