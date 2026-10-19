/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import EmptyThreadState from './EmptyThreadState'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Mirrors i18next: skipInterpolation leaves {{placeholders}} for the caller to fill.
    t: (key: string, options?: Record<string, unknown>) =>
      options?.skipInterpolation
        ? key
        : key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  }),
}))

afterEach(cleanup)

describe('EmptyThreadState', () => {
  it('shows three suggestion chips; a click hands its text to onPickStarter', () => {
    const onPickStarter = vi.fn()
    render(<EmptyThreadState onPickStarter={onPickStarter} scopeName="Atlas" scopeKind="project" />)
    const chips = document.querySelectorAll('button.dg-chip')
    expect(chips).toHaveLength(3)
    fireEvent.click(screen.getByRole('button', { name: 'Summarise what we know about Atlas' }))
    expect(onPickStarter).toHaveBeenCalledWith('Summarise what we know about Atlas')
  })

  it('shows the general starters without a scope', () => {
    const onPickStarter = vi.fn()
    render(<EmptyThreadState onPickStarter={onPickStarter} scopeKind={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'What needs me today?' }))
    expect(onPickStarter).toHaveBeenCalledWith('What needs me today?')
  })
})
