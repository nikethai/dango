/**
 * @vitest-environment jsdom
 */

import type { Message, MessageContentParts, MessageToolCallPart } from '@shared/types'
import { cleanup, render } from '@testing-library/react'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ThinkingLineProps } from '@/components/chat/ThinkingLine'
import en from '@/i18n/locales/en/translation.json'
import { ThinkingGroupUI } from './ThinkingGroupUI'

const lineProps: ThinkingLineProps[] = []

vi.mock('@/components/chat/ThinkingLine', () => ({
  ThinkingLine: (props: ThinkingLineProps) => {
    lineProps.push(props)
    return (
      <div
        data-testid="thinking-line"
        data-live={String(props.live)}
        data-hint={props.toolHint ?? ''}
        data-duration={props.durationMs ?? ''}
      />
    )
  },
}))

vi.mock('./ToolCallPartUI', () => ({ ToolCallPartUI: () => <div data-testid="tool-ui" /> }))

beforeAll(async () => {
  await createInstance()
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

afterEach(() => {
  cleanup()
  lineProps.length = 0
})

const search = (state: MessageToolCallPart['state']): MessageToolCallPart => ({
  type: 'tool-call',
  toolCallId: 'w1',
  toolName: 'web_search',
  state,
  args: { query: 'dango' },
})

function message(contentParts: MessageContentParts, generating: boolean): Message {
  return { id: 'm1', role: 'assistant', contentParts, generating, timestamp: 1_000 } as Message
}

function group(props: { parts: MessageContentParts; generating: boolean; isLastGroup: boolean; answer?: string }) {
  const contentParts: MessageContentParts = props.answer
    ? [...props.parts, { type: 'text', text: props.answer }]
    : props.parts
  return render(
    <ThinkingGroupUI
      message={message(contentParts, props.generating)}
      parts={props.parts}
      isLastGroup={props.isLastGroup}
      defaultOpen={false}
      showMascot={false}
      onStop={() => {}}
    />
  )
}

describe('ThinkingGroupUI', () => {
  it('while work is active, only the live line renders, hinted by the running tool', () => {
    const { container, getAllByTestId } = group({
      parts: [{ type: 'reasoning', text: '' }, search('call')],
      generating: true,
      isLastGroup: true,
    })
    const lines = getAllByTestId('thinking-line')
    expect(lines).toHaveLength(1)
    expect(lines[0].dataset.live).toBe('true')
    expect(lines[0].dataset.hint).toBe('searched the web')
    expect(container.querySelector('details')).toBeNull()
    expect(lineProps.at(-1)).toMatchObject({ showMascot: false, defaultOpen: false })
    expect(typeof lineProps.at(-1)?.onStop).toBe('function')
  })

  it('once settled, a "Thought for" line then the tool block', () => {
    const { container, getAllByTestId } = group({
      parts: [{ type: 'reasoning', text: 'Look it up.', duration: 4_000 }, search('result')],
      generating: false,
      isLastGroup: false,
      answer: 'Done.',
    })
    const line = getAllByTestId('thinking-line')
    expect(line).toHaveLength(1)
    expect(line[0].dataset.live).toBe('false')
    expect(line[0].dataset.duration).toBe('4000')
    const block = container.querySelector('details.dg-think')
    expect(block?.querySelector('.dg-think__title')?.textContent).toBe('Searched the web')
    expect(line[0].compareDocumentPosition(block as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('settled without reasoning shows only the tool block', () => {
    const { container, queryByTestId } = group({ parts: [search('result')], generating: false, isLastGroup: false })
    expect(queryByTestId('thinking-line')).toBeNull()
    expect(container.querySelector('details.dg-think')).not.toBeNull()
  })

  it('generating with an answer token, no reasoning, no tools: renders nothing', () => {
    const { container } = group({ parts: [], generating: true, isLastGroup: false, answer: 'Hi' })
    expect(container.innerHTML).toBe('')
  })
})
