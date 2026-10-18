/**
 * @vitest-environment jsdom
 */

import type { MessageToolCallPart } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import { ToolBlock } from './ToolBlock'

vi.mock('./ToolCallPartUI', () => ({
  ToolCallPartUI: ({ part, defaultExpanded }: { part: MessageToolCallPart; defaultExpanded?: boolean }) => (
    <div data-testid={`tool-ui-${part.toolCallId}`} data-expanded={String(defaultExpanded)} />
  ),
}))

beforeAll(async () => {
  await createInstance()
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

afterEach(() => cleanup())

function call(id: string, toolName: string, args: unknown = {}, result?: unknown): MessageToolCallPart {
  return { type: 'tool-call', toolCallId: id, toolName, state: 'result', args, result }
}

const parts = [
  call('a', 'read_file', { path: 'docs/a.md' }, 'x'.repeat(4100)),
  call('b', 'read_file', { path: '<0>{{title}}</0> & b' }),
  call('c', 'web_search', { query: 'dango' }, { results: [{}] }),
]

describe('ToolBlock', () => {
  it('is a closed details titled with the summary', () => {
    const { container } = render(<ToolBlock parts={parts} />)
    const details = container.querySelector('details.dg-think') as HTMLDetailsElement
    expect(details).not.toBeNull()
    expect(details.open).toBe(false)
    expect(container.querySelector('.dg-think__title')?.textContent).toBe('Read 2 files · searched the web')
  })

  it('opening shows one mono row per call', () => {
    const { container } = render(<ToolBlock parts={parts} />)
    fireEvent.click(container.querySelector('summary') as HTMLElement)
    const rows = container.querySelectorAll('.dg-tool')
    expect(rows).toHaveLength(3)
    expect(Array.from(rows, (r) => r.querySelector('.dg-tool__verb')?.textContent)).toEqual(['read', 'read', 'search'])
    expect(rows[0].querySelector('.dg-tool__size')?.textContent).toBe('4.1k')
    expect(rows[2].querySelector('.dg-tool__size')?.textContent).toBe('1 hit')
    // Tool args are external text: rendered literally, never parsed by i18next.
    expect(rows[1].textContent).toContain('<0>{{title}}</0> & b')
  })

  it("clicking a row reveals that call's detail", () => {
    const { container } = render(<ToolBlock parts={parts} />)
    fireEvent.click(container.querySelector('summary') as HTMLElement)
    const row = container.querySelectorAll('button.dg-tool')[1] as HTMLButtonElement
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByTestId('tool-ui-b')).toBeNull()
    fireEvent.click(row)
    expect(row.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('tool-ui-b')).toBeTruthy()
    expect(screen.queryByTestId('tool-ui-a')).toBeNull()
    fireEvent.click(row)
    expect(screen.queryByTestId('tool-ui-b')).toBeNull()
  })

  it('a row names its detail region and shows the target as a title; the detail opens expanded', () => {
    const { container } = render(<ToolBlock parts={parts} />)
    fireEvent.click(container.querySelector('summary') as HTMLElement)
    const row = container.querySelectorAll('button.dg-tool')[0] as HTMLButtonElement
    expect(row.getAttribute('title')).toBe('docs/a.md')
    const controls = row.getAttribute('aria-controls')
    expect(controls).toBeTruthy()
    fireEvent.click(row)
    const region = document.getElementById(controls as string)
    expect(region?.contains(screen.getByTestId('tool-ui-a'))).toBe(true)
    expect(screen.getByTestId('tool-ui-a').dataset.expanded).toBe('true')
    const ids = Array.from(container.querySelectorAll('button.dg-tool'), (r) => r.getAttribute('aria-controls'))
    expect(new Set(ids).size).toBe(3)
  })

  it('marks a failed call on its row', () => {
    const failed: MessageToolCallPart = { ...call('f', 'read_file', { path: 'b.md' }), state: 'error' }
    const { container } = render(<ToolBlock parts={[failed]} />)
    fireEvent.click(container.querySelector('summary') as HTMLElement)
    expect(container.querySelector('.dg-tool .dg-tool__size')?.textContent).toBe('failed')
  })

  it('renders nothing when the summary is empty', () => {
    const { container } = render(<ToolBlock parts={[call('t', 'create_task'), call('m', 'memory_lookup')]} />)
    expect(container.innerHTML).toBe('')
  })
})
