/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { MantineProvider } from '@mantine/core'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import postcss, { type Rule } from 'postcss'
import type { ReactNode } from 'react'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import { THINKING_STATUS_FILL_MS, ThinkingLine, type ThinkingLineProps } from './ThinkingLine'

vi.mock('@/components/Markdown', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="markdown">{children}</div>,
}))

beforeAll(async () => {
  await createInstance()
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

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
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-18T10:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const base: ThinkingLineProps = { live: true, text: '', defaultOpen: true }

function line(props: Partial<ThinkingLineProps> = {}) {
  const all = { ...base, ...props }
  const view = render(
    <MantineProvider>
      <ThinkingLine {...all} />
    </MantineProvider>
  )
  return {
    ...view,
    rerenderLine: (next: Partial<ThinkingLineProps>) =>
      view.rerender(
        <MantineProvider>
          <ThinkingLine {...all} {...next} />
        </MantineProvider>
      ),
  }
}

const title = (container: HTMLElement) => container.querySelector('.dg-think__title')?.textContent ?? ''
const details = (container: HTMLElement) => container.querySelector('details') as HTMLDetailsElement

describe('ThinkingLine', () => {
  it('live line before any thought', () => {
    const onStop = vi.fn()
    const { container } = line({ startedAt: Date.now(), onStop })
    expect(title(container)).toBe('Thinking')
    expect(container.querySelector('svg.dg-mascot')?.getAttribute('data-state')).toBe('thinking')
    expect(container.querySelector('.dg-think__time')?.textContent).toBe('1 s')
    const wasOpen = details(container).open
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(onStop).toHaveBeenCalledTimes(1)
    expect(details(container).open).toBe(wasOpen)
  })

  it('still thinking at 8 s', () => {
    const { container } = line({ startedAt: Date.now(), onStop: vi.fn() })
    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    expect(title(container)).toContain('Still thinking')
    expect(screen.queryByText('Still working. Nothing is stuck; this model thinks before it writes.')).toBeNull()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Stop'])
    act(() => {
      vi.advanceTimersByTime(22_000)
    })
    expect(screen.getByText('Still working. Nothing is stuck; this model thinks before it writes.')).toBeTruthy()
    expect(screen.getAllByRole('button').map((b) => b.textContent)).toEqual(['Stop'])
  })

  it('rolling summary', () => {
    const { container, rerenderLine } = line({ startedAt: Date.now(), text: 'a\nchecking the brief' })
    expect(title(container)).toContain('Thinking · checking the brief…')
    rerenderLine({ text: '', toolHint: 'searched the web' })
    expect(title(container)).toContain('Thinking · searched the web…')
  })

  it('does not double the ellipsis when the summary already ends in one', () => {
    const { container } = line({ startedAt: Date.now(), text: 'x'.repeat(300) })
    const text = title(container)
    expect(text.endsWith('…')).toBe(true)
    expect(text.endsWith('……')).toBe(false)
  })

  it('announces at most every 5 s', () => {
    const { rerenderLine } = line({ startedAt: Date.now(), text: 'reading the spec' })
    const status = screen.getByRole('status')
    expect(status.className).toContain('sr-only')
    // Empty on mount so the live region exists before its first announcement.
    expect(status.textContent).toBe('')
    act(() => {
      vi.advanceTimersByTime(THINKING_STATUS_FILL_MS)
    })
    expect(status.textContent).toBe('reading the spec')
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    rerenderLine({ text: 'reading the spec\ncomparing the quotes' })
    act(() => {
      vi.advanceTimersByTime(2_000)
    })
    rerenderLine({ text: 'reading the spec\ncomparing the quotes\nchecking totals' })
    act(() => {
      vi.advanceTimersByTime(1_000 - THINKING_STATUS_FILL_MS)
    })
    expect(screen.getByRole('status').textContent).toBe('reading the spec')
    act(() => {
      vi.advanceTimersByTime(1_000 + THINKING_STATUS_FILL_MS)
    })
    expect(screen.getByRole('status').textContent).toBe('checking totals')
  })

  it('a plain wait is spoken: Thinking, then Still thinking', () => {
    line({ startedAt: Date.now(), onStop: vi.fn() })
    expect(screen.getByRole('status').textContent).toBe('')
    act(() => {
      vi.advanceTimersByTime(THINKING_STATUS_FILL_MS)
    })
    expect(screen.getByRole('status').textContent).toBe('Thinking')
    act(() => {
      vi.advanceTimersByTime(8_000)
    })
    expect(screen.getByRole('status').textContent).toBe('Still thinking')
  })

  it('renders model text literally in the title', () => {
    for (const text of ['x < 10 so check y > 3', '<0>x</0>', '{{title}}', 'a/b & "c"']) {
      const { container, unmount } = line({ startedAt: Date.now(), text })
      expect(title(container)).toBe(`Thinking · ${text}…`)
      expect(container.querySelectorAll('.dg-think__title strong')).toHaveLength(1)
      unmount()
    }
    const { container } = line({ startedAt: Date.now(), toolHint: '<0>x</0> {{summary}}' })
    expect(title(container)).toBe('Thinking · <0>x</0> {{summary}}…')
  })

  it('live timer keeps its first origin when startedAt moves', () => {
    const start = Date.now()
    const { container, rerenderLine } = line({ startedAt: start })
    act(() => {
      vi.advanceTimersByTime(12_000)
    })
    rerenderLine({ startedAt: Date.now() })
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(container.querySelector('.dg-think__time')?.textContent).toBe('13 s')
  })

  it('hides the reduced-motion mascot word inside the thinking line', () => {
    const css = postcss.parse(readFileSync(resolve(process.cwd(), 'src/renderer/static/dango-chat.css'), 'utf8'))
    let hidden = false
    css.walkRules((rule: Rule) => {
      if (rule.selectors.includes('.dg-think .dango-mascot__state')) {
        rule.walkDecls('display', (decl) => {
          if (decl.value === 'none') hidden = true
        })
      }
    })
    expect(hidden).toBe(true)
  })

  it('syncs a native toggle (find-in-page) into state', () => {
    const { container } = line({ live: false, durationMs: 2_000, text: 'found me', defaultOpen: false })
    const el = details(container)
    expect(screen.queryByTestId('markdown')).toBeNull()
    act(() => {
      el.open = true
      el.dispatchEvent(new Event('toggle'))
    })
    expect(screen.getByTestId('markdown').textContent).toBe('found me')
  })

  it('finished line', () => {
    for (const defaultOpen of [true, false]) {
      const { container, unmount } = line({ live: false, durationMs: 6_200, text: 'x', defaultOpen, onStop: vi.fn() })
      expect(container.querySelector('summary')?.textContent).toBe('Thought for 6 s')
      // The chevron follows the title text, not pushed to the far edge.
      expect(container.querySelector('.dg-think__title svg.dg-think__chevron')).not.toBeNull()
      expect(container.querySelector('svg.dg-mascot')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull()
      expect(details(container).open).toBe(defaultOpen)
      unmount()
    }
  })

  it('non-thinking model leaves no thought block', () => {
    const { container } = line({ live: false, text: '' })
    expect(container.querySelector('.dg-think')).toBeNull()
    expect(container.querySelector('details')).toBeNull()
    expect(screen.queryByText(/Thought/)).toBeNull()
  })

  it('user toggle survives new tokens', () => {
    const { container, rerenderLine } = line({ startedAt: Date.now(), text: 'first', defaultOpen: true })
    expect(details(container).open).toBe(true)
    fireEvent.click(container.querySelector('summary') as HTMLElement)
    expect(details(container).open).toBe(false)
    rerenderLine({ text: 'first\nsecond, longer thought' })
    expect(details(container).open).toBe(false)
    rerenderLine({ text: 'first\nsecond, longer thought\nthird', defaultOpen: false })
    rerenderLine({ text: 'first\nsecond, longer thought\nthird', defaultOpen: true })
    expect(details(container).open).toBe(false)
  })

  it('showMascot = false hides the mascot', () => {
    const { container } = line({ startedAt: Date.now(), showMascot: false })
    expect(container.querySelector('svg.dg-mascot')).toBeNull()
  })
})
