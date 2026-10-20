import { type RefObject, useEffect, useRef } from 'react'

const TABBABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(', ')

// A popup control that is open handles its own Esc (Mantine closes a Select or Menu without preventDefault).
// ARIA marks it with aria-expanded on a combobox or popup trigger, Mantine with data-mantine-stop-propagation.
// A plain disclosure (an expanded accordion) has no popup, so Esc there still closes the sheet.
const OPEN_CONTROL = [
  '[role="combobox"][aria-expanded="true"]',
  '[aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"]',
  '[data-mantine-stop-propagation="true"]',
].join(', ')

// Open sheets, oldest first. Only the last one reacts to keys.
const openSheets: HTMLElement[] = []

/** True while any sheet (including the search overlay) is mounted. */
export function hasOpenSheet(): boolean {
  return openSheets.length > 0
}

/** The sheet that currently takes keys, if any. */
export function topSheet(): HTMLElement | undefined {
  return openSheets[openSheets.length - 1]
}

const tabbableIn = (el: HTMLElement) => Array.from(el.querySelectorAll<HTMLElement>(TABBABLE))

/** Focus handling for a mounted modal sheet: first focus, Tab wrap, Esc, and focus return. */
export function useSheetFocus(ref: RefObject<HTMLElement | null>, opts: { onClose: () => void }): void {
  const onCloseRef = useRef(opts.onClose)
  onCloseRef.current = opts.onClose

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const opener = document.activeElement as HTMLElement | null
    openSheets.push(el)

    const first =
      el.querySelector<HTMLElement>('[data-autofocus]') ??
      el.querySelector<HTMLElement>('.dg-btn--primary') ??
      tabbableIn(el)[0]
    if (first) {
      first.focus()
    } else {
      el.tabIndex = -1
      el.focus()
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (openSheets[openSheets.length - 1] !== el) return
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return
        if (event.target instanceof Element && event.target.closest(OPEN_CONTROL)) return
        event.preventDefault()
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const items = tabbableIn(el)
      if (items.length === 0) {
        event.preventDefault()
        el.focus()
        return
      }
      const firstItem = items[0]
      const lastItem = items[items.length - 1]
      const active = document.activeElement
      if (!active || !el.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? lastItem : firstItem).focus()
      } else if (event.shiftKey && (active === firstItem || active === el)) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && active === lastItem) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)

    return () => {
      document.removeEventListener('keydown', onKeyDown)
      const index = openSheets.lastIndexOf(el)
      if (index !== -1) openSheets.splice(index, 1)
      if (opener?.isConnected) {
        opener.focus()
      } else {
        document.getElementById('main')?.focus()
      }
    }
  }, [ref])
}
