/**
 * @vitest-environment jsdom
 */

import { createMessage, type Message } from '@shared/types'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { LocalOnlyToolsNote } from './LocalOnlyToolsNote'

const COPY = 'Web and outside tools are off because this chat holds device-only mail.'
const answer = (extra: Partial<Message> = {}): Message => ({ ...createMessage('assistant', 'Hi'), ...extra })

afterEach(cleanup)

describe('LocalOnlyToolsNote', () => {
  it('says once, quietly, that web and outside tools were off', () => {
    const { container } = render(<LocalOnlyToolsNote msg={answer({ localOnlyToolsOff: true })} />)
    const line = screen.getByText(COPY)
    expect(line.className).toContain('dg-msg-note')
    expect(line.className).toContain('dg-type-caption')
    expect(container.querySelector('[aria-live], [role="status"], [role="alert"]')).toBeNull()
  })

  it('renders nothing without the flag, while generating, or for a user message', () => {
    const { container: plain } = render(<LocalOnlyToolsNote msg={answer()} />)
    expect(plain.textContent).toBe('')
    const { container: live } = render(
      <LocalOnlyToolsNote msg={answer({ localOnlyToolsOff: true, generating: true })} />
    )
    expect(live.textContent).toBe('')
    const { container: user } = render(
      <LocalOnlyToolsNote msg={{ ...createMessage('user', 'Hi'), localOnlyToolsOff: true }} />
    )
    expect(user.textContent).toBe('')
  })
})
