/**
 * @vitest-environment jsdom
 */

// A11Y1 rule 4 (slice 09 Task 6). Sheet.test.tsx covers the bottom sheet's role, first focus, Tab wrap, Esc, the
// #main fallback, inner Esc handlers and nested sheets. This file runs the same cases on side="right", adds the
// typing-sheet ([data-autofocus]) variants on the bottom sheet, and the optional className hook (R21).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Sheet, type SheetProps } from './Sheet'

const TITLE = 'Edit a file in Dango?'

function PermissionSheet(props: Partial<SheetProps> & { autofocusField?: boolean }) {
  const { autofocusField, ...rest } = props
  return (
    <Sheet
      opened
      onClose={() => {}}
      title={TITLE}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost">
            Not now
          </button>
          <button type="button" className="dg-btn">
            Always in this scope
          </button>
          <button type="button" className="dg-btn dg-btn--primary">
            Allow once
          </button>
        </>
      }
      {...rest}
    >
      <input aria-label="Reason" {...(autofocusField ? { 'data-autofocus': true } : {})} />
    </Sheet>
  )
}

function mountOpener() {
  const opener = document.createElement('button')
  opener.textContent = 'Open'
  document.body.appendChild(opener)
  opener.focus()
  return opener
}

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

const side = 'right' as const

describe('Sheet a11y: side="right"', () => {
  it('is a modal dialog named by its title', () => {
    render(<PermissionSheet side={side} />)
    const dialog = screen.getByRole('dialog', { name: TITLE })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.classList.contains('dango-sheet--right')).toBe(true)
  })

  it('first focus is the primary action', () => {
    render(<PermissionSheet side={side} />)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Allow once' }))
  })

  it('first focus is the [data-autofocus] field in a typing sheet', () => {
    render(<PermissionSheet side={side} autofocusField />)
    expect(document.activeElement).toBe(screen.getByLabelText('Reason'))
  })

  it('Tab from the last tabbable wraps to the first, Shift+Tab from the first to the last', () => {
    render(<PermissionSheet side={side} autofocusField />)
    const field = screen.getByLabelText('Reason')
    const last = screen.getByRole('button', { name: 'Allow once' })
    expect(document.activeElement).toBe(field)
    fireEvent.keyDown(field, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(field)
  })

  it('Esc calls onClose once and focus returns to the opener', () => {
    const onClose = vi.fn()
    const opener = mountOpener()
    const { rerender } = render(<PermissionSheet side={side} onClose={onClose} autofocusField />)
    expect(document.activeElement).toBe(screen.getByLabelText('Reason'))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<PermissionSheet side={side} onClose={onClose} autofocusField opened={false} />)
    expect(document.activeElement).toBe(opener)
  })

  it('opener gone before close: focus goes to #main, not body', () => {
    const main = document.createElement('main')
    main.id = 'main'
    main.tabIndex = -1
    document.body.appendChild(main)
    const opener = mountOpener()
    const { rerender } = render(<PermissionSheet side={side} />)
    opener.remove()
    rerender(<PermissionSheet side={side} opened={false} />)
    expect(document.activeElement).toBe(main)
    expect(document.activeElement).not.toBe(document.body)
  })

  it('an inner Esc handler that calls preventDefault keeps the sheet open', () => {
    const onClose = vi.fn()
    render(
      <Sheet opened onClose={onClose} title={TITLE} side={side}>
        <input
          aria-label="Model"
          onKeyDown={(e) => {
            if (e.key === 'Escape') e.preventDefault()
          }}
        />
      </Sheet>
    )
    fireEvent.keyDown(screen.getByLabelText('Model'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('two nested sheets: Esc closes only the inner one', () => {
    const outer = vi.fn()
    const inner = vi.fn()
    render(
      <>
        <PermissionSheet side={side} onClose={outer} />
        <Sheet opened onClose={inner} title="Inner" side={side}>
          <button type="button">Inner action</button>
        </Sheet>
      </>
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inner action' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(inner).toHaveBeenCalledTimes(1)
    expect(outer).not.toHaveBeenCalled()
  })
})

describe('Sheet a11y: bottom sheet with [data-autofocus]', () => {
  it('Tab wraps around the focused field', () => {
    render(<PermissionSheet autofocusField />)
    const field = screen.getByLabelText('Reason')
    const last = screen.getByRole('button', { name: 'Allow once' })
    expect(document.activeElement).toBe(field)
    fireEvent.keyDown(field, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(last)
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(document.activeElement).toBe(field)
  })

  it('Esc from the field closes once and focus returns to the opener', () => {
    const onClose = vi.fn()
    const opener = mountOpener()
    const { rerender } = render(<PermissionSheet onClose={onClose} autofocusField />)
    fireEvent.keyDown(screen.getByLabelText('Reason'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<PermissionSheet onClose={onClose} autofocusField opened={false} />)
    expect(document.activeElement).toBe(opener)
  })
})

describe('Sheet className (R21)', () => {
  it('adds an optional class beside dg-sheet and the side class', () => {
    const { rerender } = render(<PermissionSheet className="dango-sheet--full" />)
    let dialog = screen.getByRole('dialog', { name: TITLE })
    expect(Array.from(dialog.classList)).toEqual(['dg-sheet', 'dango-sheet--full'])
    rerender(<PermissionSheet side="right" className="dango-sheet--full" />)
    dialog = screen.getByRole('dialog', { name: TITLE })
    expect(Array.from(dialog.classList)).toEqual(['dg-sheet', 'dango-sheet--right', 'dango-sheet--full'])
  })

  it('without className the classes are unchanged', () => {
    render(<PermissionSheet />)
    expect(Array.from(screen.getByRole('dialog').classList)).toEqual(['dg-sheet'])
  })
})
