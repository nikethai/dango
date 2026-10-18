import type { KeyboardEvent, KeyboardEventHandler, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { hasReviewOpener, openReviewEntry, reviewStore } from '@/packages/review'
import { isEditableTarget } from '@/utils/isEditableTarget'
import { displayKind } from './feedSelectors'

export type ReviewKeysOptions = {
  rowsRef: RefObject<Map<string, HTMLElement>>
  ids: string[]
  focusedId: string | null
  setFocusedId(id: string | null): void
  dismissFallback(id: string): void
}

const warn = (error: unknown) => console.warn('[review] open failed', error)

/** The row's first enabled button whose visible text is `label`; renderers translate, so `label` is translated too. */
function findButton(row: HTMLElement, label: string): HTMLButtonElement | undefined {
  return Array.from(row.querySelectorAll('button')).find((b) => !b.disabled && b.textContent?.trim() === label)
}

function findPrimary(row: HTMLElement): HTMLButtonElement | undefined {
  return Array.from(row.querySelectorAll<HTMLButtonElement>('button.dg-btn--primary')).find((b) => !b.disabled)
}

/**
 * Keys for the focused Review row. They press the row's own buttons, so a slice that owns a row
 * keeps its own logic and undo record. ⌘Z is 1b's global hotkey.
 */
export function useReviewKeys(o: ReviewKeysOptions): { onKeyDown: KeyboardEventHandler<HTMLElement> } {
  const { t } = useTranslation()

  const move = (from: string, step: 1 | -1) => {
    const index = o.ids.indexOf(from)
    if (index === -1) return
    const next = o.ids[Math.min(o.ids.length - 1, Math.max(0, index + step))]
    o.setFocusedId(next)
    o.rowsRef.current?.get(next)?.focus()
  }

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return
    const target = event.target as Element
    if (isEditableTarget(target)) return
    // Only keys from inside the row's own DOM: React also bubbles keys from portals (a sheet) to the row.
    const row = typeof target.closest === 'function' ? target.closest<HTMLElement>('[data-entry-id]') : null
    const id = row?.dataset.entryId
    if (!row || !id || o.rowsRef.current?.get(id) !== row || !row.contains(target)) return

    if (id !== o.focusedId) o.setFocusedId(id)

    const key = event.key.length === 1 ? event.key.toLowerCase() : event.key
    const entry = () => reviewStore.getState().entries.find((e) => e.id === id)
    const click = (button: HTMLButtonElement | undefined) => {
      if (!button) return false
      button.click()
      return true
    }
    const open = () => {
      const e = entry()
      if (!e || !hasReviewOpener(e)) return false
      void openReviewEntry(e).catch(warn)
      return true
    }

    switch (key) {
      case 'ArrowDown':
      case 'j':
        move(id, 1)
        break
      case 'ArrowUp':
      case 'k':
        move(id, -1)
        break
      case 'a':
        click(findButton(row, t('Approve')) ?? findPrimary(row))
        break
      case 'e':
        if (!click(findButton(row, t('Edit')))) open()
        break
      case 'x':
        if (!click(findButton(row, t('Dismiss')))) o.dismissFallback(id)
        break
      case 'Enter': {
        // A focused button inside the row handles its own Enter natively.
        if (target !== row) return
        const e = entry()
        const keep = e && displayKind(e) === 'conflict' ? findButton(row, t('Keep this')) : undefined
        if (keep) keep.focus()
        else if (!click(findButton(row, t('Open')))) open()
        break
      }
      default:
        return
    }
    event.preventDefault()
  }

  return { onKeyDown }
}
