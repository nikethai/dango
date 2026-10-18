import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import Divider from '@/components/common/Divider'
import {
  ADVANCED_LABEL,
  findSettingsEntry,
  type SettingsNavEntry,
  type SettingsNav as SettingsNavModel,
} from './settingsNav'

export interface SettingsNavProps {
  nav: SettingsNavModel
  pathname: string
  compact: boolean
}

export function SettingsNav({ nav, pathname, compact }: SettingsNavProps) {
  const { t } = useTranslation()
  const listId = useId()
  const found = findSettingsEntry(nav, pathname)
  const currentId = found?.entry.id ?? null
  const inAdvanced = !!found?.inAdvanced
  const [advancedOpen, setAdvancedOpen] = useState(inAdvanced)

  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname re-opens Advanced when navigating within it
  useEffect(() => {
    if (inAdvanced) setAdvancedOpen(true)
  }, [inAdvanced, pathname])

  const renderRow = (entry: SettingsNavEntry, index: number) => {
    const active = entry.id === currentId
    const Icon = entry.icon
    return (
      <Link
        key={entry.id}
        to={entry.pages[0].to as never}
        aria-current={active ? 'page' : undefined}
        className="settings-nav-link block no-underline w-full"
        style={{ ['--settings-nav-i' as string]: index }}
      >
        <span
          className={clsx(
            'settings-nav-item flex items-center gap-2 px-3 cursor-pointer select-none rounded-lg relative',
            compact ? 'py-3' : 'py-2.5',
            active ? 'settings-nav-item-on' : undefined
          )}
          style={{ color: active ? 'var(--chatbox-tint-primary)' : 'var(--chatbox-tint-secondary)' }}
        >
          <span className="settings-nav-icon flex flex-none opacity-90" aria-hidden>
            <Icon size={16} strokeWidth={1.8} />
          </span>
          <span
            className={clsx('flex-1 truncate tracking-tight', compact && 'min-h-[32px] leading-[32px]')}
            style={{ fontSize: '0.875rem', fontWeight: active ? 600 : 500 }}
          >
            {t(entry.label)}
          </span>
          {compact && (
            <ChevronRight size={18} className="settings-nav-chevron !text-chatbox-tint-tertiary" aria-hidden />
          )}
        </span>
        {compact && <Divider />}
      </Link>
    )
  }

  return (
    <>
      {nav.sections.map((entry, i) => renderRow(entry, i))}
      {nav.advanced.length > 0 && (
        <>
          <button
            type="button"
            className="settings-nav-group"
            aria-expanded={advancedOpen}
            aria-controls={listId}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <ChevronRight size={14} strokeWidth={1.8} className="settings-nav-group-chevron" aria-hidden />
            {t(ADVANCED_LABEL)}
          </button>
          <div id={listId} hidden={!advancedOpen}>
            {advancedOpen && nav.advanced.map((entry, i) => renderRow(entry, nav.sections.length + i))}
          </div>
        </>
      )}
    </>
  )
}
