/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ settings: {} as Record<string, unknown>, setSettings: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children }: { children?: unknown }) => children ?? null,
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: unknown) => unknown) => sel({ ...h.settings, setSettings: h.setSettings }),
}))
vi.mock('@/components/ModelSelector', () => ({ default: () => null }))

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

afterEach(() => {
  cleanup()
  h.setSettings.mockClear()
})

const wrap = (node: React.ReactNode) => render(<MantineProvider>{node}</MantineProvider>)

describe('default models page', () => {
  it('shows the default for a junk stored cost limit and saves a change', async () => {
    h.settings = { costWarningUsd: 'junk' }
    const { RouteComponent } = await import('./default-models')
    wrap(<RouteComponent />)
    const field = screen.getByLabelText('Cost limit in US dollars') as HTMLInputElement
    expect(field.value).toBe('$0.5')
    fireEvent.change(field, { target: { value: '2' } })
    fireEvent.blur(field)
    expect(h.setSettings).toHaveBeenCalledWith({ costWarningUsd: 2 })
  })
})

describe('chat settings page', () => {
  it('shows auto for a junk stored showThinking and saves a change', async () => {
    h.settings = { showThinking: 'junk' }
    const { RouteComponent } = await import('./chat')
    wrap(<RouteComponent />)
    expect((screen.getByLabelText('Auto') as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByLabelText('Closed'))
    expect(h.setSettings).toHaveBeenCalledWith({ showThinking: 'closed' })
  })

  it('has no Display section: the answer row shows model · tokens · time on its own', async () => {
    h.settings = {}
    const { RouteComponent } = await import('./chat')
    wrap(<RouteComponent />)
    expect(screen.queryByText('Display')).toBeNull()
    for (const label of [
      'show message word count',
      'show message token usage',
      'show model name',
      'show message timestamp',
      'show first token latency',
      'show token speed',
    ]) {
      expect(screen.queryByText(label)).toBeNull()
    }
  })
})
