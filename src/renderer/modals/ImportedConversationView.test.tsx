// @vitest-environment jsdom

import NiceModal from '@ebay/nice-modal-react'
import { MantineProvider } from '@mantine/core'
import type { ImportedConversation, ImportedSource } from '@shared/imported-history'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  deleteSource: vi.fn(),
  release: undefined as undefined | (() => void),
  small: false,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts?.[k] ?? '')),
  }),
}))
vi.mock('@/hooks/useScreenChange', () => ({ useIsSmallScreen: () => h.small }))
vi.mock('@/packages/imported-history', () => ({
  buildHandoffPreview: () => ({
    provider: 'p',
    modelId: 'm',
    estimatedTokens: 1,
    disclosure: '',
    omittedCount: 0,
    omittedReasons: [],
  }),
  continueImportedConversation: vi.fn(),
  deleteImportedSourceAndReconcile: h.deleteSource,
}))
vi.mock('@/stores/chatStore', () => ({
  listSessionsMeta: vi.fn(async () => []),
  getSession: vi.fn(),
  updateSessionWithMessages: vi.fn(),
}))
vi.mock('@/stores/lastUsedModelStore', () => ({ lastUsedModelStore: { getState: () => ({ chat: undefined }) } }))
vi.mock('@/stores/sessionActions', () => ({ switchCurrentSession: vi.fn() }))

import ImportedConversationView from './ImportedConversationView'

const ID = 'imported-conversation-test'

const conversation = (n: number): ImportedConversation => ({
  id: `c${n}`,
  providerConversationId: `p${n}`,
  title: `Conversation ${n}`,
  messages: [{ id: `m${n}`, role: 'user', text: 'hello', skippedAttachmentCount: 0 }],
})

const source: ImportedSource = {
  id: 'src-1',
  importerId: 'chatgpt-conversations',
  formatVersion: 'mapping-v1',
  originalFilename: 'chatgpt-export.zip',
  checksum: 'x',
  status: 'published',
  importedCount: 3,
  skippedCount: 0,
  failedCount: 0,
  conversations: [conversation(1), conversation(2), conversation(3)],
  skipReasons: [],
  failedReasons: [],
  createdAt: 0,
}

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({
      matches: false,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
  )
  NiceModal.register(ID, ImportedConversationView)
  h.small = false
  h.deleteSource.mockReset()
  h.deleteSource.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        h.release = resolve
      })
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

function open() {
  const main = document.createElement('div')
  main.id = 'main'
  main.tabIndex = -1
  document.body.appendChild(main)
  const opener = document.createElement('button')
  opener.textContent = 'Conversation 1'
  document.body.appendChild(opener)
  opener.focus()
  render(
    <MantineProvider>
      <NiceModal.Provider>
        <div />
      </NiceModal.Provider>
    </MantineProvider>
  )
  act(() => {
    void NiceModal.show(ID, { source, conversation: source.conversations[0] })
  })
  return { opener, main }
}

const deleteSourceButton = () => screen.getByRole('button', { name: 'Delete imported source' })
const confirmSheet = () => screen.queryByRole('dialog', { name: 'Delete “chatgpt-export.zip”?' })

describe('ImportedConversationView delete', () => {
  it('asks first: the viewer hides, the sheet takes focus on Cancel, and nothing is deleted yet', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete imported source' }))
    expect(confirmSheet()).toBeTruthy()
    expect(h.deleteSource).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    // Mantine's focus return (10 ms) must not pull focus away from Cancel.
    await new Promise((r) => setTimeout(r, 50))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete imported source' })).toBeNull())
  })

  it('Cancel brings the viewer back with focus on "Delete imported source"', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete imported source' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(confirmSheet()).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(deleteSourceButton()))
    expect(h.deleteSource).not.toHaveBeenCalled()
  })

  it('Esc cancels without deleting', async () => {
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete imported source' }))
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    expect(confirmSheet()).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(deleteSourceButton()))
    expect(h.deleteSource).not.toHaveBeenCalled()
  })

  it('"Delete import" deletes once, even on a double click, and the viewer stays closed', async () => {
    const { opener } = open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete imported source' }))
    const confirm = screen.getByRole('button', { name: 'Delete import' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(h.deleteSource).toHaveBeenCalledTimes(1)
    expect(h.deleteSource.mock.calls[0][0]).toBe('src-1')
    expect(confirmSheet()).toBeNull()
    // The delete is still running: the viewer has closed and does not come back meanwhile.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete imported source' })).toBeNull())
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByRole('button', { name: 'Delete imported source' })).toBeNull()
    await act(async () => {
      h.release?.()
      await Promise.resolve()
    })
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Delete imported source' })).toBeNull())
    expect(h.deleteSource).toHaveBeenCalledTimes(1)
    expect(document.activeElement).toBe(opener)
  })

  it('after the delete, focus goes to the main region when the opener is gone', async () => {
    const { opener, main } = open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete imported source' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete import' }))
    opener.remove()
    await act(async () => {
      h.release?.()
      await Promise.resolve()
    })
    await waitFor(() => expect(document.activeElement).toBe(main))
  })

  it('a failed delete brings the viewer back so the user can try again', async () => {
    h.deleteSource.mockImplementation(() => Promise.reject(new Error('boom')))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete imported source' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete import' }))
    await waitFor(() => expect(document.activeElement).toBe(deleteSourceButton()))
    fireEvent.click(deleteSourceButton())
    fireEvent.click(screen.getByRole('button', { name: 'Delete import' }))
    await waitFor(() => expect(h.deleteSource).toHaveBeenCalledTimes(2))
    error.mockRestore()
  })

  it('on a phone the drawer hands focus to the sheet and keeps it on Cancel', async () => {
    h.small = true
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Delete imported source' }))
    expect(confirmSheet()).toBeTruthy()
    await new Promise((r) => setTimeout(r, 600))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Delete imported source' })).toBeTruthy())
    expect(h.deleteSource).not.toHaveBeenCalled()
  })
})
