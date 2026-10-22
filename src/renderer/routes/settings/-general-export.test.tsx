/**
 * @vitest-environment jsdom
 */

import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ exportTextFile: vi.fn(), getAll: vi.fn() }))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
  Trans: ({ children }: { children?: unknown }) => children ?? null,
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (opts: unknown) => opts,
  Link: ({ children }: { children?: unknown }) => children ?? null,
}))
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: (sel: (s: unknown) => unknown) =>
    sel({ language: 'en', extension: { notifications: {} }, setSettings: vi.fn() }),
}))
vi.mock('@/platform', () => ({
  default: {
    type: 'web',
    exporter: { exportTextFile: h.exportTextFile },
    getSystemNotificationPermission: async () => 'unsupported',
  },
  platformCapabilities: {},
}))
vi.mock('@/storage', async () => {
  const { StorageKey } = await vi.importActual<typeof import('@/storage/StoreStorage')>('@/storage/StoreStorage')
  return { default: { getAll: h.getAll }, StorageKey }
})
vi.mock('@/stores/chatStore', () => ({ recoverSessionList: vi.fn() }))
vi.mock('@/stores/historyTransfer', () => ({ exportHistoryTransferFile: vi.fn(), importHistoryTransferFile: vi.fn() }))
vi.mock('@/stores/roomPack', () => ({ importRoomPack: vi.fn() }))
vi.mock('@/stores/migration', () => ({ migrateOnData: vi.fn() }))

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
}

afterEach(() => {
  cleanup()
  h.exportTextFile.mockReset()
})

const recall = {
  id: 'a',
  role: 'assistant',
  contentParts: [
    {
      type: 'tool-call',
      state: 'result',
      toolCallId: 'c',
      toolName: 'client_recall',
      args: {},
      result: { localOnly: true },
    },
  ],
}
h.getAll.mockImplementation(async () => ({
  settings: { language: 'en', providers: {} },
  'chat-sessions-list': [
    { id: 'plain', name: 'Plain' },
    { id: 'recall', name: 'Recall' },
  ],
  'session:plain': { id: 'plain', name: 'Plain', messages: [] },
  'session:recall': { id: 'recall', name: 'Recall', messages: [recall] },
  'review-entries': [{ id: 'r1' }],
  'imported-history': { archives: [] },
  'integration-secret:gmail-1': { accessToken: 'tok-gmail', refreshToken: 'ref-gmail' },
  'history-sync-state': { lastSyncedAt: 5 },
}))

async function exported(): Promise<Record<string, unknown>> {
  fireEvent.click(screen.getByText('Export Selected Data'))
  await waitFor(() => expect(h.exportTextFile).toHaveBeenCalledTimes(1))
  return JSON.parse(h.exportTextFile.mock.calls[0][1])
}

describe('Settings > General export', () => {
  it('leaves out chats that quote device-only mail unless the box is ticked', async () => {
    const { RouteComponent } = await import('./general')
    render(
      <MantineProvider>
        <RouteComponent />
      </MantineProvider>
    )
    fireEvent.click(screen.getByText('Data & backup'))
    const box = screen.getByLabelText('Include chats that quote device-only mail') as HTMLInputElement
    expect(box.checked).toBe(false)

    let data = await exported()
    expect(Object.keys(data)).not.toContain('session:recall')
    expect(Object.keys(data)).not.toContain('review-entries')
    expect(Object.keys(data)).toContain('imported-history')
    expect((data['chat-sessions-list'] as { id: string }[]).map((s) => s.id)).toEqual(['plain'])

    h.exportTextFile.mockReset()
    fireEvent.click(box)
    data = await exported()
    expect(Object.keys(data)).toContain('session:recall')
    expect((data['chat-sessions-list'] as { id: string }[]).map((s) => s.id)).toEqual(['plain', 'recall'])
    expect(Object.keys(data)).not.toContain('review-entries')

    fireEvent.click(screen.getByLabelText('Chat History'))
    expect(box.disabled).toBe(true)
  })

  it('leaves out account tokens and sync state with API Keys unticked or ticked', async () => {
    const { RouteComponent } = await import('./general')
    render(
      <MantineProvider>
        <RouteComponent />
      </MantineProvider>
    )
    fireEvent.click(screen.getByText('Data & backup'))
    const apiKeys = screen.getByLabelText('API Keys') as HTMLInputElement
    expect(apiKeys.checked).toBe(false)
    for (const tick of [false, true]) {
      if (tick) fireEvent.click(apiKeys)
      expect(apiKeys.checked).toBe(tick)
      h.exportTextFile.mockReset()
      const data = await exported()
      expect(Object.keys(data)).not.toContain('integration-secret:gmail-1')
      expect(Object.keys(data)).not.toContain('history-sync-state')
      expect(JSON.stringify(data)).not.toContain('tok-gmail')
    }
  })
})
