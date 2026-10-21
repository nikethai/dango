/**
 * Product waiting / streaming chrome — calm dots + short label.
 * Used when the assistant is generating and there is no answer text yet.
 */

import clsx from 'clsx'
import type { FC, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export type AssistantPendingProps = {
  /** Accessible + visible label. Defaults to “Thinking…”. */
  label?: string
  className?: string
  /** Hide label, dots only (tight agent header). */
  dotsOnly?: boolean
}

/** Three-dot pulse — prefers-reduced-motion falls back to static opacity. */
export function PendingDots({ className }: { className?: string }) {
  return (
    <span className={clsx('assistant-pending-dots', className)} aria-hidden>
      <i />
      <i />
      <i />
    </span>
  )
}

export const AssistantPending: FC<AssistantPendingProps> = ({ label, className, dotsOnly = false }) => {
  const { t } = useTranslation()
  const text = label ?? t('Thinking…')

  return (
    <div className={clsx('assistant-pending', className)}>
      <PendingDots />
      {!dotsOnly ? <span className="assistant-pending-label">{text}</span> : null}
    </div>
  )
}

/** Quiet status row for file read / webpage load / retry (not a blue bootstrap card). */
export function AssistantStatusRow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('assistant-status-row', className)}>
      <PendingDots />
      <div className="assistant-status-row-body">{children}</div>
    </div>
  )
}

export default AssistantPending
