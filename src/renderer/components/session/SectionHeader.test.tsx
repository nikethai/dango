// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SectionHeader } from './SectionHeader'

beforeEach(() => {
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
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('SectionHeader (sidebar Scopes / Recents, A11Y1, Task 12 walk)', () => {
  it('its trailing buttons are siblings of the toggle, not buttons inside a button', () => {
    const onToggle = vi.fn()
    const onAdd = vi.fn()
    const { container } = render(
      <MantineProvider>
        <SectionHeader
          label="Scopes"
          open
          onToggle={onToggle}
          trailing={
            <button type="button" aria-label="New scope" onClick={onAdd}>
              +
            </button>
          }
        />
      </MantineProvider>
    )
    expect(container.querySelectorAll('button button')).toHaveLength(0)
    const toggle = screen.getByRole('button', { name: 'Scopes' })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(screen.getByRole('button', { name: 'New scope' }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onToggle).not.toHaveBeenCalled()
    fireEvent.click(toggle)
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})
