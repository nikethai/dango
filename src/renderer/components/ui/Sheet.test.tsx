/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Menu, MantineProvider, Popover, Select, Tooltip } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import postcss, { type AtRule, type Rule } from 'postcss'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'
import { Sheet, type SheetProps, useSheetFocus } from './Sheet'
import { useSheetFocus as useSheetFocusImpl } from './useSheetFocus'

const TITLE = 'Dango wants to edit 3 files'

function TestSheet(props: Partial<SheetProps> & { inputProps?: Record<string, unknown>; extra?: ReactNode }) {
  const { inputProps, extra, ...rest } = props
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
      <input aria-label="Note" {...inputProps} />
      {extra}
    </Sheet>
  )
}

beforeEach(() => {
  // jsdom lacks the layout APIs Mantine's popovers touch.
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

const sheetLayerZ = () => {
  const css = postcss.parse(readFileSync(resolve(process.cwd(), 'src/renderer/static/dango-foundations.css'), 'utf8'))
  let z = Number.NaN
  css.walkRules('.dango-sheet-layer', (rule: Rule) => {
    rule.walkDecls('z-index', (d) => {
      z = Number(d.value)
    })
  })
  return z
}

describe('Sheet', () => {
  it('renders a labelled modal dialog in body', () => {
    const { container } = render(<TestSheet />)
    const dialog = screen.getByRole('dialog', { name: TITLE })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.classList.contains('dg-sheet')).toBe(true)
    expect(container.contains(dialog)).toBe(false)
    let node: HTMLElement | null = dialog
    while (node && node !== document.body) node = node.parentElement
    expect(node).toBe(document.body)
    expect(dialog.parentElement?.classList.contains('dango-sheet-layer')).toBe(true)
  })

  it('renders nothing when closed, and adds side and hint variants', () => {
    const { rerender } = render(<TestSheet opened={false} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    rerender(<TestSheet side="right" hint="Esc closes" />)
    expect(screen.getByRole('dialog').classList.contains('dango-sheet--right')).toBe(true)
    expect(document.querySelector('.dg-sheet__hint')?.textContent).toBe('Esc closes')
  })

  it('first focus is the primary action', () => {
    const { unmount } = render(<TestSheet />)
    expect(document.activeElement).toBe(screen.getByText('Allow once'))
    unmount()
    render(<TestSheet inputProps={{ 'data-autofocus': true }} />)
    expect(document.activeElement).toBe(screen.getByLabelText('Note'))
  })

  it('tab stays inside', () => {
    render(<TestSheet />)
    const primary = screen.getByText('Allow once')
    const input = screen.getByLabelText('Note')
    expect(document.activeElement).toBe(primary)
    fireEvent.keyDown(primary, { key: 'Tab' })
    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(primary)
  })

  it('esc closes and returns focus', () => {
    const onClose = vi.fn()
    const windowSpy = vi.fn()
    window.addEventListener('keydown', windowSpy)
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { rerender } = render(<TestSheet onClose={onClose} />)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(windowSpy.mock.calls.filter(([e]) => (e as KeyboardEvent).key === 'Escape')).toHaveLength(0)
    rerender(<TestSheet onClose={onClose} opened={false} />)
    expect(document.activeElement).toBe(opener)
    window.removeEventListener('keydown', windowSpy)
  })

  it('opener gone falls back to #main', () => {
    const main = document.createElement('main')
    main.id = 'main'
    main.tabIndex = -1
    document.body.appendChild(main)
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { rerender } = render(<TestSheet />)
    opener.remove()
    rerender(<TestSheet opened={false} />)
    expect(document.activeElement).toBe(main)
  })

  it('opened with focus on the body (the docked inspector it replaced is gone), closing focuses #main (T7 M3)', () => {
    const main = document.createElement('main')
    main.id = 'main'
    main.tabIndex = -1
    document.body.appendChild(main)
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)
    const { rerender } = render(<TestSheet />)
    rerender(<TestSheet opened={false} />)
    expect(document.activeElement).toBe(main)
  })

  it('inner Esc handler wins', () => {
    const onClose = vi.fn()
    render(
      <TestSheet
        onClose={onClose}
        inputProps={{
          onKeyDown: (e: { key: string; preventDefault: () => void }) => {
            if (e.key === 'Escape') e.preventDefault()
          },
        }}
      />
    )
    fireEvent.keyDown(screen.getByLabelText('Note'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Esc in an expanded control inside the sheet does not close the sheet', () => {
    const onClose = vi.fn()
    render(<TestSheet onClose={onClose} inputProps={{ 'aria-expanded': 'true', role: 'combobox' }} />)
    fireEvent.keyDown(screen.getByLabelText('Note'), { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('Esc on an expanded disclosure without a popup still closes the sheet', () => {
    const onClose = vi.fn()
    render(<TestSheet onClose={onClose} inputProps={{ 'aria-expanded': 'true' }} />)
    fireEvent.keyDown(screen.getByLabelText('Note'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('Esc in an open Mantine Select closes only the dropdown', async () => {
    const onClose = vi.fn()
    render(
      <MantineProvider theme={createDangoMantineTheme()}>
        <TestSheet
          onClose={onClose}
          extra={<Select label="Model" data={['Alpha', 'Beta']} comboboxProps={{ withinPortal: false }} />}
        />
      </MantineProvider>
    )
    const select = screen.getByRole('textbox', { name: 'Model' })
    act(() => {
      select.focus()
    })
    fireEvent.click(select)
    expect(select.getAttribute('data-expanded')).toBe('true')
    fireEvent.keyDown(select, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
    await act(async () => {})
    expect(select.getAttribute('data-expanded')).toBeNull()
    fireEvent.keyDown(select, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('exports useSheetFocus from the Sheet module', () => {
    expect(useSheetFocus).toBe(useSheetFocusImpl)
  })

  it('only the top sheet reacts', () => {
    const first = vi.fn()
    const second = vi.fn()
    render(
      <>
        <Sheet opened onClose={first} title="First">
          <button type="button">a</button>
        </Sheet>
        <Sheet opened onClose={second} title="Second">
          <button type="button">b</button>
        </Sheet>
      </>
    )
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('scrim click closes', () => {
    const onClose = vi.fn()
    render(<TestSheet onClose={onClose} />)
    fireEvent.click(document.querySelector('.dg-sheet-scrim') as Element)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})

describe('popover layering over sheets', () => {
  it('the theme keeps popovers above the sheet layer and above Mantine modals and drawers', () => {
    const c = createDangoMantineTheme().components
    const z = (name: string) => Number((c?.[name]?.defaultProps as { zIndex?: number } | undefined)?.zIndex)
    const floor = Math.max(sheetLayerZ(), z('Modal'), z('Drawer'))
    for (const name of ['Popover', 'Combobox', 'Tooltip']) {
      expect({ name, above: z(name) > floor }).toEqual({ name, above: true })
    }
  })

  const zOf = (el: Element | null) => Number((el as HTMLElement | null)?.style.zIndex)

  it('every Mantine popover family renders above the sheet layer', () => {
    const layer = sheetLayerZ()
    expect(layer).toBe(400)
    render(
      <MantineProvider theme={createDangoMantineTheme()}>
        <Select label="Model" data={['Alpha']} dropdownOpened />
        <Popover opened>
          <Popover.Target>
            <button type="button">p</button>
          </Popover.Target>
          <Popover.Dropdown data-testid="popover">x</Popover.Dropdown>
        </Popover>
        <Menu opened>
          <Menu.Target>
            <button type="button">m</button>
          </Menu.Target>
          <Menu.Dropdown data-testid="menu">
            <Menu.Item>i</Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <Tooltip label="tip" opened>
          <button type="button">t</button>
        </Tooltip>
      </MantineProvider>
    )
    const dropdowns = {
      select: document.querySelector('.mantine-Select-dropdown'),
      popover: screen.getByTestId('popover'),
      menu: screen.getByTestId('menu'),
      tooltip: document.querySelector('.mantine-Tooltip-tooltip'),
    }
    for (const [name, el] of Object.entries(dropdowns)) {
      expect({ name, above: zOf(el) > layer }).toEqual({ name, above: true })
    }
  })
})

describe('dango-foundations.css', () => {
  const css = postcss.parse(readFileSync(resolve(process.cwd(), 'src/renderer/static/dango-foundations.css'), 'utf8'))

  it('layers the sheet, disables motion when reduced, uses tokens only', () => {
    let position = ''
    css.walkRules('.dango-sheet-layer', (rule: Rule) => {
      rule.walkDecls('position', (d) => {
        position = d.value
      })
    })
    expect(position).toBe('fixed')

    let reducedNone = false
    css.walkAtRules('media', (at: AtRule) => {
      if (!at.params.includes('prefers-reduced-motion: reduce')) return
      at.walkRules((rule: Rule) => {
        if (!rule.selector.includes('.dg-sheet')) return
        rule.walkDecls('animation', (d) => {
          if (d.value === 'none') reducedNone = true
        })
      })
    })
    expect(reducedNone).toBe(true)

    const bottom: Record<string, string> = {}
    css.walkRules('.dg-sheet:not(.dango-sheet--right)', (rule: Rule) => {
      rule.walkDecls((d) => {
        bottom[d.prop] = d.value
      })
    })
    expect(bottom).toEqual({ 'max-height': 'calc(100vh - var(--dango-space-6))', overflow: 'auto' })

    const hex: string[] = []
    css.walkDecls((d) => {
      if (/#[0-9a-fA-F]/.test(d.value)) hex.push(`${d.prop}: ${d.value}`)
    })
    expect(hex).toEqual([])
  })
})
