import { useLocation, useNavigate } from '@tanstack/react-router'
import clsx from 'clsx'
import { Inbox } from 'lucide-react'
import { type ButtonHTMLAttributes, forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { useReviewWaitingCount } from '@/packages/review/hooks'

export type SidebarReviewRowProps = {
  variant: 'rail' | 'expanded'
  onNavigate(): void
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>

/** Sidebar entry for the Review home at `/`. Blue badge = things waiting on you. */
// forwardRef + prop spread so a Mantine Tooltip can wrap the rail button.
export const SidebarReviewRow = forwardRef<HTMLButtonElement, SidebarReviewRowProps>(function SidebarReviewRow(
  { variant, onNavigate, ...rest },
  ref
) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const count = useReviewWaitingCount()
  const active = pathname === '/'
  const label = count > 0 ? t('Review, {{count}} waiting', { count }) : t('Review')
  // The accessible name already carries the count, so the visible badge is hidden from screen readers.
  const badge = count > 0 && (
    <span className="dg-badge" aria-hidden="true">
      {count > 99 ? '99+' : count}
    </span>
  )
  const go = () => {
    navigate({ to: '/' })
    onNavigate()
  }

  if (variant === 'rail') {
    return (
      <button
        {...rest}
        ref={ref}
        type="button"
        className={clsx('rail-icon-btn active:scale-[0.96]', active && 'studio-rail-row-active')}
        onClick={go}
        aria-label={label}
        aria-current={active ? 'page' : undefined}
      >
        <Inbox size={16} strokeWidth={1.8} aria-hidden />
        {badge}
      </button>
    )
  }
  return (
    <button
      {...rest}
      ref={ref}
      type="button"
      className={clsx('rail-nav-item', active && 'studio-rail-row-active')}
      onClick={go}
      aria-label={label}
      aria-current={active ? 'page' : undefined}
    >
      <Inbox size={16} strokeWidth={1.8} aria-hidden />
      <span>{t('Review')}</span>
      {badge}
    </button>
  )
})
