/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import type { Message, MessageContentParts, MessageToolCallPart } from '@shared/types'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { createInstance } from 'i18next'
import type { ReactNode } from 'react'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import { LEAVE_LIVE_MS, ThinkingGroupUI } from './ThinkingGroupUI'

// The real ThinkingLine: these tests are about its state surviving the live → finished change.
vi.mock('@/components/Markdown', () => ({
  default: ({ children }: { children: ReactNode }) => <div data-testid="markdown">{children}</div>,
}))
vi.mock('./ToolCallPartUI', () => ({ ToolCallPartUI: () => <div data-testid="tool-ui" /> }))

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
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

const tool = (id: string, state: MessageToolCallPart['state']): MessageToolCallPart => ({
  type: 'tool-call',
  toolCallId: id,
  toolName: 'web_search',
  state,
  args: { query: 'dango' },
})

type Props = { parts: MessageContentParts; generating: boolean; workActive: boolean; defaultOpen?: boolean }

function view(start: Props) {
  const el = (p: Props) => (
    <MantineProvider>
      <ThinkingGroupUI
        message={
          { id: 'm1', role: 'assistant', contentParts: p.parts, generating: p.generating, timestamp: 1 } as Message
        }
        parts={p.parts}
        isLastGroup={p.workActive}
        defaultOpen={p.defaultOpen ?? false}
        showMascot={false}
        onStop={() => {}}
      />
    </MantineProvider>
  )
  const utils = render(el(start))
  return { ...utils, update: (p: Props) => utils.rerender(el(p)) }
}

const thinkLine = (c: HTMLElement) => c.querySelector('.dg-think-line details') as HTMLDetailsElement | null
const toolBlock = (c: HTMLElement) => c.querySelector('details.dg-tool-block')
const reasoning = { type: 'reasoning' as const, text: 'Look it up.', duration: 2_000 }

describe('ThinkingGroupUI keeps its state across the turn', () => {
  it("the user's open choice survives live → finished", () => {
    const parts = [reasoning, tool('a', 'result')]
    const { container, update } = view({ parts, generating: true, workActive: true })
    const before = thinkLine(container)
    expect(before?.open).toBe(false)
    fireEvent.click(before?.querySelector('summary') as HTMLElement)
    expect(thinkLine(container)?.open).toBe(true)
    update({ parts, generating: false, workActive: false })
    expect(container.querySelector('.dg-think__title')?.textContent).toContain('Thought for 2 s')
    expect(thinkLine(container)).toBe(before)
    expect(thinkLine(container)?.open).toBe(true)
  })

  it('a default-open line the user closed stays closed when it finishes', () => {
    const parts = [reasoning]
    const { container, update } = view({ parts, generating: true, workActive: true, defaultOpen: true })
    expect(thinkLine(container)?.open).toBe(true)
    fireEvent.click(thinkLine(container)?.querySelector('summary') as HTMLElement)
    update({ parts, generating: false, workActive: false, defaultOpen: true })
    expect(thinkLine(container)?.open).toBe(false)
  })

  it('narration between two tool calls never shows the tool block', () => {
    const first = [reasoning, tool('a', 'result')]
    const { container, update } = view({ parts: first, generating: true, workActive: true })
    // Narration: work is briefly not active.
    update({ parts: first, generating: true, workActive: false })
    act(() => vi.advanceTimersByTime(LEAVE_LIVE_MS - 100))
    expect(toolBlock(container)).toBeNull()
    const second = [...first, tool('b', 'call')]
    update({ parts: second, generating: true, workActive: true })
    act(() => vi.advanceTimersByTime(LEAVE_LIVE_MS * 2))
    expect(toolBlock(container)).toBeNull()
    expect(container.querySelector('.dg-think__time')).not.toBeNull()
  })

  it('settles once work has been inactive for the debounce while generating', () => {
    const parts = [reasoning, tool('a', 'result')]
    const { container, update } = view({ parts, generating: true, workActive: true })
    update({ parts, generating: true, workActive: false })
    expect(toolBlock(container)).toBeNull()
    act(() => vi.advanceTimersByTime(LEAVE_LIVE_MS))
    expect(toolBlock(container)).not.toBeNull()
    expect(container.querySelector('.dg-think__time')).toBeNull()
  })

  it('settles immediately when generation ends', () => {
    const parts = [reasoning, tool('a', 'result')]
    const { container, update } = view({ parts, generating: true, workActive: true })
    update({ parts, generating: false, workActive: false })
    expect(toolBlock(container)).not.toBeNull()
  })
})
