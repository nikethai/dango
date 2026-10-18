import { Text } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'

export const Route = createFileRoute('/settings/sources')({
  component: SourcesSettingsPage,
})

export function SourcesSettingsPage() {
  const { t } = useTranslation()
  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t('Sources')}
        description={t(
          'Folders, Gmail, Asana, Codex threads and documents Dango reads from. Each source belongs to one scope.'
        )}
      />
      <SettingsCard>
        <Text size="sm" c="chatbox-secondary">
          {t('No sources connected yet.')}
        </Text>
      </SettingsCard>
    </SettingsPage>
  )
}
