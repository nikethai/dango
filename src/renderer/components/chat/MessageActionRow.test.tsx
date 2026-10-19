/**
 * @vitest-environment jsdom
 */

import type { Message } from '@shared/types'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(options?.[name] ?? '')),
  }),
}))

// The selector renders its target and exposes onSelect through a non-button control.
vi.mock('../ModelSelector', () => ({
  ModelSelector: (props: { children: ReactNode; onSelect?: (provider: string, model: string) => void }) => (
    <>
      {props.children}
      <span data-testid="pick-model" onClick={() => props.onSelect?.('claude', 'claude-opus')} />
    </>
  ),
}))
vi.mock('../ActionMenu', () => ({
  default: (props: { children: ReactNode }) => <>{props.children}</>,
}))

import { MessageActionRow } from './MessageActionRow'

const answer = (extra: Partial<Message> = {}): Message => ({
  id: 'a1',
  role: 'assistant',
  contentParts: [{ type: 'text', text: 'Hello' }],
  model: 'GPT-5',
  usage: { totalTokens: 1240 },
  durationMs: 8_200,
  ...extra,
})

function renderRow(msg: Message, overrides: Partial<Parameters<typeof MessageActionRow>[0]> = {}) {
  const props = {
    msg,
    onCopy: vi.fn(),
    onRedo: vi.fn(),
    onRedoWithModel: vi.fn(),
    onFeedback: vi.fn(),
    menu: [],
    ...overrides,
  }
  render(<MessageActionRow {...props} />)
  return props
}

const labels = () => screen.getAllByRole('button').map((b) => b.getAttribute('aria-label'))

afterEach(cleanup)

describe('MessageActionRow', () => {
  it('lists the answer actions in order', () => {
    renderRow(answer())
    expect(labels()).toEqual(['Copy', 'Redo', 'Redo with another model', 'Good answer', 'Bad answer', 'More'])
  })

  it('marks only the chosen rating as pressed', () => {
    renderRow(answer({ feedback: { rating: 'up', timestamp: 1 } }))
    expect(screen.getByRole('button', { name: 'Good answer' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'Bad answer' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('shows model · tokens · time', () => {
    renderRow(answer())
    expect(screen.getByText('GPT-5 · 1.2k tokens · 8 s')).toBeTruthy()
  })

  it('redoes with the model picked in the selector', () => {
    const props = renderRow(answer())
    fireEvent.click(screen.getByTestId('pick-model'))
    expect(props.onRedoWithModel).toHaveBeenCalledWith('claude', 'claude-opus')
  })

  it('wires Copy, Redo and the thumbs to their handlers', () => {
    const props = renderRow(answer())
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    fireEvent.click(screen.getByRole('button', { name: 'Redo' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bad answer' }))
    expect(props.onCopy).toHaveBeenCalledTimes(1)
    expect(props.onRedo).toHaveBeenCalledTimes(1)
    expect(props.onFeedback).toHaveBeenCalledWith('down')
  })

  it('never shows an emoji', () => {
    const { container } = render(
      <MessageActionRow
        msg={answer({ feedback: { rating: 'down', timestamp: 1 } })}
        onCopy={vi.fn()}
        onRedo={vi.fn()}
        onRedoWithModel={vi.fn()}
        onFeedback={vi.fn()}
        menu={[]}
      />
    )
    for (const el of Array.from(container.querySelectorAll('*'))) {
      expect(el.textContent ?? '').not.toMatch(/\p{Extended_Pictographic}/u)
    }
  })

  it('a user message gets Copy, Edit and More, without meta', () => {
    renderRow(
      { id: 'u1', role: 'user', contentParts: [{ type: 'text', text: 'Hi' }], model: 'GPT-5' },
      { onEdit: vi.fn() }
    )
    expect(labels()).toEqual(['Copy', 'Edit', 'More'])
    expect(screen.queryByText('GPT-5')).toBeNull()
  })
})
