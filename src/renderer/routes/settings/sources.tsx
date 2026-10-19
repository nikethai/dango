import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SourcesSettings } from '@/components/sources/SourcesSettings'

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
      <SourcesSettings />
    </SettingsPage>
  )
}
