/**
 * @vitest-environment jsdom
 */

import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/platform', () => ({ default: { formFactor: 'desktop', type: 'web' } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  }),
}))

afterEach(async () => {
  cleanup()
  const { uiStore } = await import('@/stores/uiStore')
  uiStore.getState().setFileDragActive(false)
})

describe('ChatDropOverlay', () => {
  it('stays hidden until a file drag starts, then says Drop to attach', async () => {
    const { uiStore } = await import('@/stores/uiStore')
    const { ChatDropOverlay } = await import('./ChatDropOverlay')
    const { container } = render(<ChatDropOverlay />)
    const overlay = container.firstElementChild as HTMLElement
    expect(overlay.getAttribute('aria-hidden')).toBe('true')
    expect(overlay.classList.contains('is-active')).toBe(false)

    act(() => uiStore.getState().setFileDragActive(true))
    expect(overlay.getAttribute('aria-hidden')).toBe('false')
    expect(overlay.classList.contains('is-active')).toBe(true)
    expect(overlay.textContent).toContain('Drop to attach')
    expect(overlay.textContent).toContain('Images · video · PDFs · text · code')

    act(() => uiStore.getState().setFileDragActive(false))
    expect(overlay.getAttribute('aria-hidden')).toBe('true')
  })
})
