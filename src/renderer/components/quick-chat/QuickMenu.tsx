import { type KeyboardEvent, type ReactNode, type RefObject, useEffect, useRef } from 'react'

export type QuickMenuItem = {
  key: string
  label: ReactNode
  /** Accessible name when the label holds more than text. */
  ariaLabel?: string
  right?: ReactNode
  current?: boolean
  onSelect: () => void
}

type QuickMenuProps = {
  items: QuickMenuItem[]
  /** The trigger: focus returns here when an item is chosen. */
  anchorRef: RefObject<HTMLElement | null>
  labelledBy?: string
  onClose: () => void
}

/**
 * A `.dg-menu` that renders in place (inside the Quick Chat panel, never in a portal) so the frameless window can
 * grow to fit it. Arrow keys, Home and End move between items; Tab or a pointer-down outside closes it. Esc is the
 * panel's job (one Esc is one step).
 */
export function QuickMenu({ items, anchorRef, labelledBy, onClose }: QuickMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Focus the current (or first) item once, when the menu opens.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on open only
  useEffect(() => {
    const buttons = menuItems(menuRef.current)
    const current = items.findIndex((item) => item.current)
    buttons[Math.max(current, 0)]?.focus()
  }, [])

  useEffect(() => {
    const onPointerDown = (event: Event) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuRef.current?.contains(target) || anchorRef.current?.contains(target)) return
      onCloseRef.current()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [anchorRef])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const buttons = menuItems(menuRef.current)
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % buttons.length
    else if (event.key === 'ArrowUp')
      next = index < 0 ? buttons.length - 1 : (index - 1 + buttons.length) % buttons.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = buttons.length - 1
    else if (event.key === 'Tab') {
      onClose()
      return
    }
    if (next === null) return
    event.preventDefault()
    buttons[next]?.focus()
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-labelledby={labelledBy}
      className="dg-menu"
      onKeyDown={onKeyDown}
      style={{ position: 'absolute', top: 'calc(100% + var(--dango-space-1))', left: 0, zIndex: 10 }}
    >
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          role="menuitem"
          tabIndex={-1}
          aria-label={item.ariaLabel}
          className={item.current ? 'is-current' : undefined}
          onClick={() => {
            item.onSelect()
            onClose()
            anchorRef.current?.focus()
          }}
        >
          <span>{item.label}</span>
          {item.right}
        </button>
      ))}
    </div>
  )
}

function menuItems(menu: HTMLElement | null): HTMLButtonElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')) : []
}
