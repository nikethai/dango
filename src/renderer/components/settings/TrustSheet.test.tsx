/**
 * @vitest-environment jsdom
 */

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ pushUndo: vi.fn(() => 'undo-1') }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts ? key.replace(/\{\{(\w+)\}\}/g, (_, k: string) => opts[k] ?? '') : key,
  }),
}))

vi.mock('@/packages/undo', () => ({ pushUndo: h.pushUndo }))

vi.mock('@/stores/settingsStore', async () => {
  const { createStore: create } = await import('zustand/vanilla')
  const { useStore } = await import('zustand')
  const settingsStore = create<{ trustLevel: unknown; setSettings: (v: { trustLevel: unknown }) => void }>((set) => ({
    trustLevel: 'auto',
    setSettings: (v) => set(v),
  }))
  return {
    settingsStore,
    useSettingsStore: <U,>(selector: (s: ReturnType<typeof settingsStore.getState>) => U) =>
      useStore(settingsStore, selector),
  }
})

import { settingsStore } from '@/stores/settingsStore'
import { TrustSheet } from './TrustSheet'
import { useTrustSheet } from './useTrustSheet'

const store = settingsStore as unknown as {
  getState: () => { trustLevel: unknown; setSettings: (v: { trustLevel: unknown }) => void }
  setState: (v: { trustLevel: unknown }) => void
}

beforeEach(() => {
  h.pushUndo.mockClear()
  store.setState({ trustLevel: 'auto' })
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

describe('TrustSheet', () => {
  it('preselects value, follows the radio and saves', () => {
    const onSave = vi.fn()
    render(<TrustSheet opened value="auto" onClose={() => {}} onSave={onSave} />)
    expect((screen.getByRole('radio', { name: /Auto/ }) as HTMLInputElement).checked).toBe(true)
    const primary = screen.getByRole('button', { name: 'Use Auto' })
    expect(document.activeElement).toBe(primary)
    fireEvent.click(screen.getByRole('radio', { name: /Ask first/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use Ask first' }))
    expect(onSave).toHaveBeenCalledWith('ask')
  })

  it('Esc closes without saving', () => {
    const onClose = vi.fn()
    const onSave = vi.fn()
    render(<TrustSheet opened value="auto" onClose={onClose} onSave={onSave} />)
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows the hint and the knowledge promise', () => {
    render(<TrustSheet opened value="auto" onClose={() => {}} onSave={() => {}} />)
    expect(document.querySelector('.dg-sheet__hint')?.textContent).toBe(
      'Always asks, whatever you choose: sending anything, deleting, editing files, changing a decision, saving knowledge. Applies to items that arrive from now on.'
    )
    expect(screen.getByText(/Knowledge always waits for you\./)).toBeTruthy()
  })
})

describe('useTrustSheet', () => {
  function Host() {
    const { open, sheet } = useTrustSheet()
    return (
      <>
        <button type="button" onClick={open}>
          opener
        </button>
        {sheet}
      </>
    )
  }

  it('saves a different level with an undo', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('opener'))
    fireEvent.click(screen.getByRole('radio', { name: /Ask first/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Use Ask first' }))
    expect(store.getState().trustLevel).toBe('ask')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(h.pushUndo).toHaveBeenCalledTimes(1)
    const arg = (h.pushUndo.mock.calls[0] as unknown as [{ message: string; undo: () => void; group: string }])[0]
    expect(arg.group).toBe('other')
    expect(arg.message).toContain('Ask first')
    act(() => arg.undo())
    expect(store.getState().trustLevel).toBe('auto')
  })

  it('saving the same level pushes nothing', () => {
    render(<Host />)
    fireEvent.click(screen.getByText('opener'))
    fireEvent.click(screen.getByRole('button', { name: 'Use Auto' }))
    expect(h.pushUndo).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('normalises a junk stored level to Auto', () => {
    store.setState({ trustLevel: 'sometimes' })
    render(<Host />)
    fireEvent.click(screen.getByText('opener'))
    expect((screen.getByRole('radio', { name: /Auto/ }) as HTMLInputElement).checked).toBe(true)
  })
})
