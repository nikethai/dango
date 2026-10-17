/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import type { Scope } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDangoMantineTheme } from '@/theme/mantineTheme'
import { ScopePill } from './ScopePill'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => options?.[name] ?? ''),
  }),
}))

const scopes: Scope[] = [
  { id: 'a', name: 'Acme Co', kind: 'client', order: 0 },
  { id: 'd', name: 'Dango app', kind: 'project', order: 1 },
  { id: 'everywhere', name: 'Everywhere', kind: 'project', order: 2 },
]

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  vi.stubGlobal(
    'matchMedia',
    vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
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
})

function renderPill(value: string | undefined, onChange = vi.fn()) {
  render(
    <MantineProvider theme={createDangoMantineTheme()}>
      <ScopePill scopes={scopes} value={value} onChange={onChange} />
    </MantineProvider>
  )
  return onChange
}

describe('ScopePill', () => {
  it('reads "No scope" and is named "Scope: None" when there is no scope', () => {
    renderPill(undefined)
    const button = screen.getByRole('button', { name: 'Scope: None' })
    expect(button.textContent).toContain('No scope')
    expect(button.classList.contains('dg-scope')).toBe(true)
    expect(button.classList.contains('composer-scope-pill')).toBe(true)
  })

  it('shows the scope name when one is set', () => {
    renderPill('d')
    const button = screen.getByRole('button', { name: 'Scope: Dango app' })
    expect(button.textContent).toContain('Dango app')
  })

  it('never offers Everywhere', async () => {
    renderPill(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Scope: None' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((item) => item.textContent)).toEqual(['None', 'Acme Coclient', 'Dango app'])
    expect(screen.queryByRole('menuitem', { name: /Everywhere/ })).toBeNull()
  })

  it('marks client scopes with a "client" chip', async () => {
    renderPill(undefined)
    fireEvent.click(screen.getByRole('button', { name: 'Scope: None' }))
    const acme = await screen.findByRole('menuitem', { name: /Acme Co/ })
    const chip = acme.querySelector('.dg-chip')
    expect(chip?.textContent).toBe('client')
    const dango = screen.getByRole('menuitem', { name: /Dango app/ })
    expect(dango.querySelector('.dg-chip')).toBeNull()
  })

  it('calls onChange(undefined) for None and the id for a scope', async () => {
    const onChange = renderPill('a')
    fireEvent.click(screen.getByRole('button', { name: 'Scope: Acme Co' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'None' }))
    expect(onChange).toHaveBeenLastCalledWith(undefined)

    fireEvent.click(screen.getByRole('button', { name: 'Scope: Acme Co' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: /Dango app/ }))
    expect(onChange).toHaveBeenLastCalledWith('d')
  })
})
