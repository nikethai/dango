// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LayoutMode } from '@/hooks/useLayoutMode'

const layout = vi.hoisted(() => ({ mode: 'wide' as LayoutMode }))
vi.mock('@/hooks/useLayoutMode', () => ({ useLayoutMode: () => layout.mode }))

import { InspectorFrame } from './InspectorFrame'

function frame(props: { opened?: boolean; onClose?: () => void; docked?: (body: React.ReactNode) => React.ReactNode }) {
  return (
    <InspectorFrame
      opened={props.opened ?? true}
      onClose={props.onClose ?? (() => {})}
      title="Pricing table"
      docked={props.docked}
    >
      <button type="button">Preview</button>
    </InspectorFrame>
  )
}

afterEach(() => {
  cleanup()
  layout.mode = 'wide'
})

describe('InspectorFrame', () => {
  it('wide: a docked aside, no dialog, no scrim, no focus trap', () => {
    layout.mode = 'wide'
    render(frame({}))
    const aside = screen.getByRole('complementary', { name: 'Pricing table' })
    expect(aside.tagName).toBe('ASIDE')
    expect(aside.classList.contains('dango-inspector')).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.dg-sheet-scrim')).toBeNull()
    expect(document.activeElement).toBe(document.body)
  })

  it('wide: the caller may supply its own docked shell around the body', () => {
    layout.mode = 'wide'
    render(frame({ docked: (body) => <aside aria-label="Artifact">{body}</aside> }))
    expect(screen.getByRole('complementary', { name: 'Artifact' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('medium: a right sheet; Esc calls onClose once', () => {
    layout.mode = 'medium'
    const onClose = vi.fn()
    render(frame({ onClose }))
    const dialog = screen.getByRole('dialog', { name: 'Pricing table' })
    expect(dialog.classList.contains('dango-sheet--right')).toBe(true)
    expect(dialog.classList.contains('dango-inspector-sheet')).toBe(true)
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Preview' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('medium: the docked shell is not used in the sheet', () => {
    layout.mode = 'medium'
    render(frame({ docked: (body) => <aside aria-label="Artifact">{body}</aside> }))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Pricing table' })).toBeTruthy()
  })

  it('phone: a bottom sheet with the full-height class', () => {
    layout.mode = 'phone'
    render(frame({}))
    const dialog = screen.getByRole('dialog', { name: 'Pricing table' })
    expect(dialog.classList.contains('dango-sheet--right')).toBe(false)
    expect(dialog.classList.contains('dango-inspector-sheet')).toBe(true)
  })

  it('medium to wide while open: docked again, no scrim or dialog left behind', () => {
    layout.mode = 'medium'
    const { rerender } = render(frame({}))
    expect(document.querySelector('.dg-sheet-scrim')).toBeTruthy()
    layout.mode = 'wide'
    act(() => rerender(frame({})))
    expect(screen.getByRole('complementary', { name: 'Pricing table' })).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.querySelector('.dg-sheet-scrim')).toBeNull()
    expect(document.querySelector('.dango-sheet-layer')).toBeNull()
  })

  it('phone to medium to wide while open: one sheet at a time, then docked', () => {
    layout.mode = 'phone'
    const { rerender } = render(frame({}))
    layout.mode = 'medium'
    act(() => rerender(frame({})))
    expect(document.querySelectorAll('.dg-sheet-scrim')).toHaveLength(1)
    expect(screen.getByRole('dialog').classList.contains('dango-sheet--right')).toBe(true)
    layout.mode = 'wide'
    act(() => rerender(frame({})))
    expect(document.querySelectorAll('.dg-sheet-scrim')).toHaveLength(0)
    expect(screen.getByRole('complementary', { name: 'Pricing table' })).toBeTruthy()
  })

  it('wide to medium while open: the aside goes, the sheet comes', () => {
    layout.mode = 'wide'
    const { rerender } = render(frame({}))
    layout.mode = 'medium'
    act(() => rerender(frame({})))
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Pricing table' })).toBeTruthy()
  })

  it.each<LayoutMode>(['wide', 'medium', 'phone'])('%s: opened false renders nothing', (mode) => {
    layout.mode = mode
    const { container } = render(frame({ opened: false }))
    expect(container.innerHTML).toBe('')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(document.querySelector('.dg-sheet-scrim')).toBeNull()
  })
})
