/**
 * @vitest-environment jsdom
 */

import NiceModal from '@ebay/nice-modal-react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const interpolate = (key: string, opts?: Record<string, unknown>) =>
  key.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(opts?.[name] ?? ''))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: interpolate }),
}))

const setSettings = vi.hoisted(() => vi.fn())
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (select: (s: { setSettings: typeof setSettings }) => unknown) => select({ setSettings }),
}))

import ContextOverflowModal from './ContextOverflow'

const ID = 'context-overflow-test'
const TITLE = 'Context Window Nearly Full'

beforeEach(() => {
  NiceModal.register(ID, ContextOverflowModal)
  setSettings.mockClear()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

function open(props = { currentTokens: 92_000, thresholdTokens: 80_000, contextWindow: 100_000 }) {
  const opener = document.createElement('button')
  opener.textContent = 'Send'
  document.body.appendChild(opener)
  opener.focus()
  render(
    <NiceModal.Provider>
      <div />
    </NiceModal.Provider>
  )
  let result!: Promise<unknown>
  act(() => {
    result = NiceModal.show(ID, props)
  })
  return { opener, result }
}

describe('ContextOverflow', () => {
  it('is a modal sheet; first focus is the primary action, Compact', async () => {
    open()
    const dialog = await screen.findByRole('dialog', { name: TITLE })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.classList.contains('dg-sheet')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Compact' }))
    for (const name of ['Cancel', 'Continue Anyway', 'Truncate Context', 'Compact']) {
      expect(screen.getByRole('button', { name })).toBeTruthy()
    }
  })

  it('shows token usage and the compaction threshold', async () => {
    open()
    await screen.findByRole('dialog', { name: TITLE })
    expect(
      screen.getByText(
        "The conversation context is approaching the model's token limit. Choose how to handle this to continue chatting."
      )
    ).toBeTruthy()
    expect(screen.getByText('Token Usage')).toBeTruthy()
    expect(screen.getByText('92.0k / 100.0k (92%)')).toBeTruthy()
    expect(screen.getByText('Compaction threshold: 80.0k (80%)')).toBeTruthy()
    const meter = screen.getByRole('progressbar', { name: 'Token Usage' })
    expect(meter.getAttribute('aria-valuenow')).toBe('92')
  })

  it('Esc resolves "continue" (the send is not blocked), saves nothing, and returns focus', async () => {
    const { opener, result } = open()
    await screen.findByRole('dialog', { name: TITLE })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember my choice and apply automatically next time' }))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    await expect(result).resolves.toBe('continue')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(setSettings).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(opener)
  })

  it('Cancel resolves "continue"', async () => {
    const { result } = open()
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await expect(result).resolves.toBe('continue')
  })

  it('Compact resolves "compact" without saving unless remembered', async () => {
    const { result } = open()
    fireEvent.click(await screen.findByRole('button', { name: 'Compact' }))
    await expect(result).resolves.toBe('compact')
    expect(setSettings).not.toHaveBeenCalled()
  })

  it('remember + Compact saves auto-compact', async () => {
    const { result } = open()
    await screen.findByRole('dialog', { name: TITLE })
    const remember = screen.getByRole('checkbox', {
      name: 'Remember my choice and apply automatically next time',
    }) as HTMLInputElement
    fireEvent.click(remember)
    expect(remember.checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Compact' }))
    await expect(result).resolves.toBe('compact')
    expect(setSettings).toHaveBeenCalledWith({ contextOverflowBehavior: 'auto-compact' })
  })

  it('remember + Truncate Context saves truncate', async () => {
    const { result } = open()
    await screen.findByRole('dialog', { name: TITLE })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember my choice and apply automatically next time' }))
    fireEvent.click(screen.getByRole('button', { name: 'Truncate Context' }))
    await expect(result).resolves.toBe('truncate')
    expect(setSettings).toHaveBeenCalledWith({ contextOverflowBehavior: 'truncate' })
  })

  it('remember + Continue Anyway saves nothing', async () => {
    const { result } = open()
    await screen.findByRole('dialog', { name: TITLE })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Remember my choice and apply automatically next time' }))
    fireEvent.click(screen.getByRole('button', { name: 'Continue Anyway' }))
    await expect(result).resolves.toBe('continue')
    expect(setSettings).not.toHaveBeenCalled()
  })
})
