import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { SettingsNavEntry } from './settingsNav'

export interface SettingsTabsProps {
  entry: SettingsNavEntry
  pathname: string
}

export function SettingsTabs({ entry, pathname }: SettingsTabsProps) {
  const { t } = useTranslation()
  if (entry.pages.length < 2) return null
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return (
    <nav aria-label={t(entry.label)} className="settings-tabs">
      {entry.pages.map((page) => {
        const active = path === page.to || path.startsWith(`${page.to}/`)
        return (
          <Link key={page.key} to={page.to as never} aria-current={active ? 'page' : undefined}>
            {t(page.label)}
          </Link>
        )
      })}
    </nav>
  )
}
