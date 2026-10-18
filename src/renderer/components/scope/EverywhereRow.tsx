import { EVERYWHERE_SCOPE_ID } from '@shared/types'
import { Link } from '@tanstack/react-router'
import clsx from 'clsx'
import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/** The built-in scope row: always first, no count, no menu, not a drop target. */
export function EverywhereRow({ active }: { active: boolean }) {
  const { t } = useTranslation()
  return (
    <Link
      to="/scope/$scopeId"
      params={{ scopeId: EVERYWHERE_SCOPE_ID }}
      search={{ tab: 'overview' }}
      className={clsx(
        'project-folder-row flex items-center gap-2 mx-1.5 px-2 py-[7px]',
        active && 'studio-rail-row-active'
      )}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <Globe size={16} strokeWidth={1.8} aria-hidden className="project-row-icon" />
      <span className="truncate project-folder-name" style={{ fontSize: '0.8125rem', fontWeight: 550 }}>
        {t('Everywhere')}
      </span>
    </Link>
  )
}
