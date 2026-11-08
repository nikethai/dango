import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { ShortcutConfig } from '@/components/Shortcut'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/hotkeys')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const shortcuts = useSettingsStore((state) => state.shortcuts)
  const setSettings = useSettingsStore((state) => state.setSettings)
  return (
    <SettingsPage>
      <SettingsPageHeader title={t('Keyboard shortcuts')} />
      <ShortcutConfig shortcuts={shortcuts} setShortcuts={(shortcuts) => setSettings({ shortcuts })} />
    </SettingsPage>
  )
}
