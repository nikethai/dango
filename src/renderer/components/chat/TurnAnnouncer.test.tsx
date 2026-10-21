/**
 * @vitest-environment jsdom
 */

import type { Message } from '@shared/types'
import { act, cleanup, render } from '@testing-library/react'
import i18next from 'i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import { TurnAnnouncer } from './TurnAnnouncer'

beforeAll(async () => {
  await i18next.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-10-21T10:00:00Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function live(text: string): Message {
  return {
    id: 'a1',
    role: 'assistant',
    generating: true,
    timestamp: Date.now(),
    contentParts: [{ type: 'reasoning', text, startTime: Date.now() }],
  }
}

const region = (container: HTMLElement) => container.querySelector('[role="status"]') as HTMLElement

describe('TurnAnnouncer', () => {
  it('is one polite, atomic, visually hidden region that exists empty first', () => {
    const { container } = render(<TurnAnnouncer message={live('reading')} />)
    const el = region(container)
    expect(el.getAttribute('aria-live')).toBe('polite')
    expect(el.getAttribute('aria-atomic')).toBe('true')
    expect(el.className).toContain('sr-only')
    expect(el.textContent).toBe('')
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(el.textContent).toBe('Thinking, 1 second, reading')
  })

  it('Stop while thinking: says "Stopped before answering." once and the 5 s ticks stop', () => {
    const m = live('weighing the options')
    const { container, rerender } = render(<TurnAnnouncer message={m} />)
    const el = region(container)
    // Every change the region makes, sampled at each 1 s tick.
    const seen: string[] = []
    const advance = (ms: number) => {
      for (let i = 0; i < ms / 1_000; i++) {
        act(() => {
          vi.advanceTimersByTime(1_000)
        })
        if (el.textContent && el.textContent !== seen.at(-1)) seen.push(el.textContent)
      }
    }
    advance(6_000)
    rerender(<TurnAnnouncer message={{ ...m, generating: false }} />)
    advance(30_000)
    expect(seen.filter((s) => s === 'Stopped before answering.')).toHaveLength(1)
    expect(seen.at(-1)).toBe('Stopped before answering.')
    expect(seen.filter((s) => s.startsWith('Thinking'))).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('says nothing for a turn that had already finished when the chat opened', () => {
    const old: Message = { id: 'a0', role: 'assistant', contentParts: [{ type: 'text', text: 'An old answer' }] }
    const { container } = render(<TurnAnnouncer message={old} />)
    act(() => {
      vi.advanceTimersByTime(10_000)
    })
    expect(region(container).textContent).toBe('')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('follows the same message when it generates again (Continue on a stopped plan)', () => {
    const old: Message = { id: 'a0', role: 'assistant', contentParts: [{ type: 'text', text: 'Plan stopped' }] }
    const { container, rerender } = render(<TurnAnnouncer message={old} />)
    rerender(<TurnAnnouncer message={{ ...old, generating: true, timestamp: Date.now() }} />)
    act(() => {
      vi.advanceTimersByTime(1_000)
    })
    expect(region(container).textContent).toBe('Writing the answer, 1 second')
  })
})
