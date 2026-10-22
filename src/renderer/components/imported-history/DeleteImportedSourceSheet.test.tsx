// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createInstance } from 'i18next'
import { initReactI18next } from 'react-i18next'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import en from '@/i18n/locales/en/translation.json'
import { DeleteImportedSourceSheet } from './DeleteImportedSourceSheet'

beforeAll(async () => {
  await createInstance()
    .use(initReactI18next)
    .init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

function renderSheet(conversationCount: number) {
  const calls: string[] = []
  const onClose = vi.fn(() => calls.push('close'))
  const onConfirm = vi.fn(() => calls.push('confirm'))
  render(
    <DeleteImportedSourceSheet
      filename="chatgpt-export.zip"
      conversationCount={conversationCount}
      opened
      onClose={onClose}
      onConfirm={onConfirm}
    />
  )
  return { calls, onClose, onConfirm }
}

describe('DeleteImportedSourceSheet', () => {
  it('names the file, counts the conversations and focuses Cancel', () => {
    renderSheet(12)
    expect(screen.getByRole('dialog', { name: 'Delete “chatgpt-export.zip”?' })).toBeTruthy()
    expect(
      screen.getByText(
        "This removes 12 imported conversations from Dango and can't be undone. Chats you continued from them stay."
      )
    ).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    const buttons = screen.getAllByRole('button').map((b) => b.textContent)
    expect(buttons).toEqual(['Cancel', 'Delete import'])
    expect(screen.getByRole('button', { name: 'Delete import' }).className).toBe('dg-btn dg-btn--danger')
  })

  it('reads singular for one conversation', () => {
    renderSheet(1)
    expect(
      screen.getByText(
        "This removes 1 imported conversation from Dango and can't be undone. Chats you continued from them stay."
      )
    ).toBeTruthy()
  })

  it('Esc calls onClose only', () => {
    const { onClose, onConfirm } = renderSheet(12)
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('Cancel calls onClose only', () => {
    const { onClose, onConfirm } = renderSheet(12)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('"Delete import" calls onClose then onConfirm', () => {
    const { calls } = renderSheet(12)
    fireEvent.click(screen.getByRole('button', { name: 'Delete import' }))
    expect(calls).toEqual(['close', 'confirm'])
  })
})
