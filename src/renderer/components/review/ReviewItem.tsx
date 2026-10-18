import type { ReviewKind } from '@shared/types/review'
import type { ReactNode } from 'react'

export type { ReviewKind } from '@shared/types/review'

export type ReviewAction = { label: string; onClick: () => void; variant?: 'primary' | 'secondary' | 'ghost' }

export type ReviewItemProps = {
  kind: ReviewKind
  scope: string
  source?: string
  text: string
  sub?: string
  /** At most three are rendered. */
  actions: ReviewAction[]
  focused?: boolean
  /** Replaces the text line (a proposal being edited); the accessible name still uses `text`. */
  children?: ReactNode
}

const MAX_ACTIONS = 3

const KIND_LABEL: Record<ReviewKind, string> = {
  proposal: 'Proposal',
  done: 'Done',
  'needs-you': 'Needs you',
  conflict: 'Conflict',
  change: 'Change',
  're-check': 'Re-check',
}

const KIND_CLASS: Partial<Record<ReviewKind, string>> = {
  done: 'dg-item--done',
  'needs-you': 'dg-item--needs',
  conflict: 'dg-item--conflict',
}

const BUTTON_CLASS: Record<NonNullable<ReviewAction['variant']>, string> = {
  primary: 'dg-btn dg-btn--primary',
  secondary: 'dg-btn',
  ghost: 'dg-btn dg-btn--ghost',
}

export function ReviewItem({ kind, scope, source, text, sub, actions, focused, children }: ReviewItemProps) {
  const meta = [KIND_LABEL[kind], scope, source].filter(Boolean).join(' · ')
  const className = ['dg', 'dg-item', KIND_CLASS[kind], focused ? 'is-focused' : ''].filter(Boolean).join(' ')

  return (
    <article className={className} aria-label={`${meta}. ${text}`}>
      <div className="dg-item__mark" aria-hidden="true" />
      <div className="dg-item__text">
        <div className="dg-item__meta">{meta}</div>
        {children ?? <div>{text}</div>}
        {sub ? <div className="dg-item__sub">{sub}</div> : null}
      </div>
      <div className="dg-item__actions">
        {actions.slice(0, MAX_ACTIONS).map((action) => (
          <button
            key={action.label}
            type="button"
            className={BUTTON_CLASS[action.variant ?? 'secondary']}
            onClick={action.onClick}
          >
            {action.label}
          </button>
        ))}
      </div>
    </article>
  )
}
