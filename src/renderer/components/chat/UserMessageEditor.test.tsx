/**
 * @vitest-environment jsdom
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

import { UserMessageEditor } from './UserMessageEditor'

afterEach(cleanup)

const setup = (initialText = 'Hello there') => {
  const onSend = vi.fn()
  const onCancel = vi.fn()
  render(<UserMessageEditor initialText={initialText} onSend={onSend} onCancel={onCancel} />)
  return { onSend, onCancel, field: screen.getByRole('textbox') as HTMLTextAreaElement }
}

describe('UserMessageEditor', () => {
  it('prefills the textarea with the message', () => {
    const { field } = setup()
    expect(field.value).toBe('Hello there')
  })

  it('disables Send for blank text', () => {
    const { field, onSend } = setup()
    fireEvent.change(field, { target: { value: '   ' } })
    const send = screen.getByRole('button', { name: 'Send' })
    expect((send as HTMLButtonElement).disabled).toBe(true)
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('sends the edited text with the Send button and with Cmd+Enter', () => {
    const { field, onSend } = setup()
    fireEvent.change(field, { target: { value: 'Edited' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSend).toHaveBeenLastCalledWith('Edited')
    fireEvent.keyDown(field, { key: 'Enter', metaKey: true })
    expect(onSend).toHaveBeenCalledTimes(2)
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(onSend).toHaveBeenCalledTimes(3)
  })

  it('plain Enter adds a line instead of sending', () => {
    const { field, onSend } = setup()
    fireEvent.keyDown(field, { key: 'Enter' })
    expect(onSend).not.toHaveBeenCalled()
  })

  it('Escape and Cancel call onCancel', () => {
    const { field, onCancel } = setup()
    fireEvent.keyDown(field, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onCancel).toHaveBeenCalledTimes(2)
  })
})
