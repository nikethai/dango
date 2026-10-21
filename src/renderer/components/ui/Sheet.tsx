import { type ReactNode, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { useSheetFocus } from './useSheetFocus'

export { useSheetFocus } from './useSheetFocus'

export type SheetProps = {
  opened: boolean
  onClose: () => void
  title: string
  children?: ReactNode
  actions?: ReactNode
  side?: 'bottom' | 'right'
  hint?: ReactNode
  /** Extra class on the sheet, after dg-sheet and the side class (e.g. the phone inspector's full height). */
  className?: string
}

function OpenSheet({ onClose, title, children, actions, side, hint, className }: Omit<SheetProps, 'opened'>) {
  const ref = useRef<HTMLElement>(null)
  const titleId = useId()
  useSheetFocus(ref, { onClose })
  return (
    <div className="dango-sheet-layer">
      <div className="dg-sheet-scrim" aria-hidden="true" onClick={onClose} />
      <section
        ref={ref}
        className={['dg-sheet', side === 'right' ? 'dango-sheet--right' : null, className].filter(Boolean).join(' ')}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
        {hint ? <span className="dg-sheet__hint">{hint}</span> : null}
        <div className="dg-sheet__actions">{actions}</div>
      </section>
    </div>
  )
}

export function Sheet({ opened, ...rest }: SheetProps) {
  if (!opened) return null
  return createPortal(<OpenSheet {...rest} />, document.body)
}
