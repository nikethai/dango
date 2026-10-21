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

const state = vi.hoisted(() => ({ total: 5 }))
const clearConversationList = vi.hoisted(() => vi.fn(async (_keep: number) => {}))
const toastAdd = vi.hoisted(() => vi.fn())

vi.mock('@/stores/chatStore', () => ({
  useSessionList: () => ({
    sessionMetaList: Array.from({ length: state.total }, (_, i) => ({ id: `s${i}`, name: `Chat ${i}` })),
  }),
}))
vi.mock('@/stores/sessionActions', () => ({ clearConversationList }))
vi.mock('@/stores/toastActions', () => ({ add: toastAdd }))
vi.mock('@/packages/event', () => ({ trackingEvent: vi.fn() }))

import ClearSessionList from './ClearSessionList'

const ID = 'clear-session-list-test'

beforeEach(() => {
  NiceModal.register(ID, ClearSessionList)
  clearConversationList.mockClear()
  toastAdd.mockClear()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

function open(total: number) {
  state.total = total
  const opener = document.createElement('button')
  opener.textContent = 'Clean up'
  document.body.appendChild(opener)
  opener.focus()
  render(
    <NiceModal.Provider>
      <div />
    </NiceModal.Provider>
  )
  let result!: Promise<unknown>
  act(() => {
    result = NiceModal.show(ID)
  })
  return { opener, result }
}

describe('ClearSessionList', () => {
  it('is a modal sheet titled "Clean up chats"; first focus is Cancel, never the delete', async () => {
    open(5)
    const dialog = await screen.findByRole('dialog', { name: 'Clean up chats' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    expect(dialog.classList.contains('dg-sheet')).toBe(true)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('Keep your newest chats. Older ones will be permanently deleted.')).toBeTruthy()
    expect(screen.getByText('5 conversations total')).toBeTruthy()
  })

  it('Esc cancels: nothing is deleted, the sheet closes and focus returns to the opener', async () => {
    const { opener, result } = open(5)
    await screen.findByRole('dialog', { name: 'Clean up chats' })
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    await expect(result).resolves.toBeUndefined()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(clearConversationList).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(opener)
  })

  it('Cancel closes without deleting', async () => {
    open(5)
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(clearConversationList).not.toHaveBeenCalled()
  })

  it('small lists use chips; choosing None offers "Delete all" and deletes every chat', async () => {
    open(5)
    await screen.findByRole('dialog', { name: 'Clean up chats' })
    // Default keeps all but one.
    expect(screen.getByText('4 of 5')).toBeTruthy()
    expect(screen.getByText('1 older chats will be deleted')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Delete 1' })).toBeTruthy()

    const none = screen.getByRole('button', { name: 'None' })
    fireEvent.click(none)
    expect(none.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('Delete all 5 conversations')).toBeTruthy()
    expect(screen.getByText('This cannot be undone.')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Delete all' }))
    await waitFor(() => expect(clearConversationList).toHaveBeenCalledWith(0))
    await waitFor(() => expect(toastAdd).toHaveBeenCalledWith('All conversations deleted'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeping every chat disables the delete', async () => {
    open(5)
    await screen.findByRole('dialog', { name: 'Clean up chats' })
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByText('Select fewer chats to keep if you want to free space.')).toBeTruthy()
    const del = screen.getByRole('button', { name: 'Delete 0' }) as HTMLButtonElement
    expect(del.disabled).toBe(true)
    fireEvent.click(del)
    expect(clearConversationList).not.toHaveBeenCalled()
  })

  it('large lists use a slider labelled "Keep newest"', async () => {
    open(30)
    await screen.findByRole('dialog', { name: 'Clean up chats' })
    const slider = screen.getByRole('slider', { name: 'Keep newest' }) as HTMLInputElement
    expect(slider.value).toBe('18')
    fireEvent.change(slider, { target: { value: '10' } })
    expect(screen.getByText('Keeping 10 newest. This cannot be undone.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Delete 20' }))
    await waitFor(() => expect(clearConversationList).toHaveBeenCalledWith(10))
    await waitFor(() => expect(toastAdd).toHaveBeenCalledWith('Deleted 20 older conversations'))
  })

  it('a failed clean-up shows the error and keeps the sheet open', async () => {
    clearConversationList.mockRejectedValueOnce(new Error('Disk is full'))
    open(5)
    await screen.findByRole('dialog', { name: 'Clean up chats' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete 1' }))
    await waitFor(() => expect(toastAdd).toHaveBeenCalledWith('Disk is full'))
    expect(screen.getByRole('dialog', { name: 'Clean up chats' })).toBeTruthy()
  })

  it('with one chat there is nothing to clean up; Done has first focus', async () => {
    open(1)
    await screen.findByRole('dialog', { name: 'Clean up chats' })
    expect(screen.getByText('You only have one conversation — nothing to clean up.')).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('button', { name: /Delete/ })).toBeNull()
  })

  it('with no chats it says so', async () => {
    open(0)
    await screen.findByRole('dialog', { name: 'Clean up chats' })
    expect(screen.getByText('You have no conversations yet.')).toBeTruthy()
  })
})
