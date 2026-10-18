import { isEverywhere, type ScopeKind } from '@shared/types/scope'
import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { QuickMenu } from './QuickMenu'

export type QuickScope = { id: string; name: string; kind?: ScopeKind }

export type QuickScopePillProps = {
  scopes: QuickScope[]
  value: string | null
  onChange: (scopeId: string | null) => void
  /** Controlled open state, so the panel can close the menu on Esc. Uncontrolled when absent. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Quick Chat's scope pill. Same contract as the composer's `ScopePill` (pill text "No scope", "None" first,
 * Everywhere never offered, client chip, same keys), but its menu opens downward inside the panel, because the
 * Mantine dropdown opens upward in a portal and would be clipped by the frameless quick window.
 */
export function QuickScopePill({ scopes, value, onChange, open, onOpenChange }: QuickScopePillProps) {
  const { t } = useTranslation()
  const [ownOpen, setOwnOpen] = useState(false)
  const isOpen = open ?? ownOpen
  const setOpen = (next: boolean) => {
    if (open === undefined) setOwnOpen(next)
    onOpenChange?.(next)
  }
  const triggerRef = useRef<HTMLButtonElement>(null)
  const triggerId = useId()
  const options = scopes.filter((scope) => !isEverywhere(scope.id))
  const current = value ? options.find((scope) => scope.id === value) : undefined

  return (
    <span style={{ position: 'relative', display: 'inline-flex', flexShrink: 0 }}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="dg-scope"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={current ? t('Scope: {{name}}', { name: current.name }) : t('Scope: None')}
        onClick={() => setOpen(!isOpen)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !isOpen) {
            event.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span className="min-w-0 truncate">{current ? current.name : t('No scope')}</span>
      </button>
      {isOpen ? (
        <QuickMenu
          anchorRef={triggerRef}
          labelledBy={triggerId}
          onClose={() => setOpen(false)}
          items={[
            { key: 'none', label: t('None'), current: !current, onSelect: () => onChange(null) },
            ...options.map((scope) => ({
              key: scope.id,
              label: scope.name,
              current: scope.id === current?.id,
              right: scope.kind === 'client' ? <span className="dg-chip">{t('client')}</span> : undefined,
              onSelect: () => onChange(scope.id),
            })),
          ]}
        />
      ) : null}
    </span>
  )
}
