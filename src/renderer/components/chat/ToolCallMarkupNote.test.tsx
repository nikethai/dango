/**
 * @vitest-environment jsdom
 */

import { createMessage, type Message } from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { ToolCallMarkupNote } from './ToolCallMarkupNote'

const COPY = 'The model wrote a tool request as text. Dango hid it and ran nothing.'
const answer = (text: string, extra: Partial<Message> = {}): Message => ({
  ...createMessage('assistant', text),
  ...extra,
})

afterEach(cleanup)

describe('ToolCallMarkupNote', () => {
  it('says once, quietly, that a tool request written as text was hidden', () => {
    const { container } = render(<ToolCallMarkupNote msg={answer('Sure.\n<tool_call>{"name":"Bash"}</tool_call>')} />)
    const line = screen.getByText(COPY)
    expect(line.className).toContain('dg-msg-note')
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull()
  })

  it('renders nothing for an ordinary answer, while generating, or for a user message', () => {
    expect(render(<ToolCallMarkupNote msg={answer('Hi')} />).container.textContent).toBe('')
    const live = answer('<tool_call>{"name":"Bash"}</tool_call>', { generating: true })
    expect(render(<ToolCallMarkupNote msg={live} />).container.textContent).toBe('')
    const user = createMessage('user', '<tool_call>{"name":"Bash"}</tool_call>')
    expect(render(<ToolCallMarkupNote msg={user} />).container.textContent).toBe('')
  })
})
