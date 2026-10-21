/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  navigateToSettings: vi.fn(),
  navigate: vi.fn(),
  toast: vi.fn(),
  failAllow: false,
  names: {} as Record<string, string>,
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, string>) =>
      opts ? key.replace(/\{\{(\w+)\}\}/g, (_, k: string) => opts[k] ?? '') : key,
  }),
}))
vi.mock('i18next', () => ({ t: (key: string) => key }))
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn(() => 'undo-1') }))
vi.mock('@/modals/Settings', () => ({ navigateToSettings: h.navigateToSettings }))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => h.navigate }))
vi.mock('@/storage', async () => (await import('@/packages/knowledge/test-storage')).default)
vi.mock('@/stores/toastActions', () => ({ add: h.toast }))
vi.mock('@/packages/knowledge/proposals', async (orig) => {
  const real = await orig<typeof import('@/packages/knowledge/proposals')>()
  return {
    ...real,
    allowSuggestAgain: (id: string) => (h.failAllow ? Promise.reject(new Error('boom')) : real.allowSuggestAgain(id)),
  }
})
vi.mock('@/packages/knowledge/store', async (orig) => {
  const real = await orig<typeof import('@/packages/knowledge/store')>()
  return { ...real, startKnowledgeOver: vi.fn(real.startKnowledgeOver) }
})
vi.mock('@/packages/knowledge/scopes', () => ({
  refreshScopes: () => {
    h.names.acme = 'Acme'
    return Promise.resolve()
  },
  scopeName: (id: string) => (id === 'everywhere' ? 'Everywhere' : (h.names[id] ?? 'Unknown scope')),
}))

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

import { emptyKnowledgeState } from '@shared/types/knowledge'
import { _resetKnowledgeForTests, commitKnowledge, startKnowledgeOver } from '@/packages/knowledge/store'
import { getRaw, putRaw, putRawText, resetTestStorage } from '@/packages/knowledge/test-storage'
import { settingsStore } from '@/stores/settingsStore'
import { DontSuggestList } from './DontSuggestList'
import { MemoryPrivacyPage } from './MemoryPrivacyPage'

const store = settingsStore as unknown as { setState: (v: { trustLevel: unknown }) => void }

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
  onchange: null,
})) as unknown as typeof window.matchMedia

function renderPage() {
  return render(
    <MantineProvider>
      <MemoryPrivacyPage />
    </MantineProvider>
  )
}

beforeEach(() => {
  h.navigateToSettings.mockClear()
  h.navigate.mockClear()
  h.toast.mockClear()
  h.failAllow = false
  h.names = {}
  store.setState({ trustLevel: 'auto' })
  resetTestStorage()
  _resetKnowledgeForTests()
  vi.mocked(startKnowledgeOver).mockClear()
})

afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

async function seed() {
  await commitKnowledge((d) => {
    d.dontSuggest.push({
      id: 'd1',
      scopeId: 'acme',
      text: 'Prefers short emails',
      textKey: 'prefers short emails',
      addedAt: 5,
    })
  })
}

describe('DontSuggestList', () => {
  it('shows the empty state', () => {
    render(<DontSuggestList items={[]} onRestore={() => {}} />)
    expect(screen.getByText('Nothing here yet.')).toBeTruthy()
    expect(
      screen.getByText(
        "When you choose “Don't suggest this again” on a proposal, it is listed here so you can turn it back on."
      )
    ).toBeTruthy()
  })

  it('lists an item and restores it by id', () => {
    const onRestore = vi.fn()
    render(
      <DontSuggestList items={[{ id: 'x1', text: 'Likes tea', scopeLabel: 'Acme', at: 0 }]} onRestore={onRestore} />
    )
    expect(screen.getByText('Likes tea')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest again' }))
    expect(onRestore).toHaveBeenCalledWith('x1')
  })
})

describe('MemoryPrivacyPage', () => {
  it('empty list shows Nothing here yet.', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Nothing here yet.')).toBeTruthy())
  })

  it('lists a seeded entry with its scope name, and Suggest again removes it', async () => {
    await seed()
    renderPage()
    await waitFor(() => expect(screen.getByText('Prefers short emails')).toBeTruthy())
    expect(screen.getByText(/Acme/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Suggest again' }))
    await waitFor(() => expect(screen.getByText('Nothing here yet.')).toBeTruthy())
    expect(screen.queryByText('Prefers short emails')).toBeNull()
  })

  it('a failed Suggest again toasts and keeps the row', async () => {
    await seed()
    h.failAllow = true
    renderPage()
    await waitFor(() => expect(screen.getByText('Prefers short emails')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Suggest again' }))
    await waitFor(() => expect(h.toast).toHaveBeenCalledWith("Couldn't turn this back on. Try again."))
    expect(screen.getByText('Prefers short emails')).toBeTruthy()
  })

  it('shows the scope name once scopes have refreshed', async () => {
    await seed()
    renderPage()
    await waitFor(() => expect(screen.getByText(/Acme/)).toBeTruthy())
    expect(screen.queryByText(/Unknown scope/)).toBeNull()
  })

  it('shows the sections in order and the Trust row reads Auto', () => {
    renderPage()
    expect(Array.from(document.querySelectorAll('.settings-section-label')).map((e) => e.textContent)).toEqual([
      'Trust',
      "Don't suggest again",
      'Everywhere',
      'Export',
    ])
    expect(screen.getByText(/^Auto · Dango does safe things first/)).toBeTruthy()
  })

  it('Change opens the Trust sheet', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getByRole('dialog', { name: 'Trust' })).toBeTruthy()
  })

  it('reads a stored legacy trust level as Auto and the sheet has Auto checked', () => {
    store.setState({ trustLevel: 'sometimes' })
    renderPage()
    expect(screen.getByText(/^Auto · Dango does safe things first/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect((screen.getByRole('radio', { name: /Auto/ }) as HTMLInputElement).checked).toBe(true)
  })

  it('Ask first describes approval', () => {
    store.setState({ trustLevel: 'ask' })
    renderPage()
    expect(screen.getByText(/^Ask first · Everything waits for your approval\./)).toBeTruthy()
  })

  it('Open Everywhere navigates to the Everywhere scope', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Open Everywhere' }))
    expect(h.navigate).toHaveBeenCalledWith({
      to: '/scope/$scopeId',
      params: { scopeId: 'everywhere' },
      search: { tab: 'overview' },
    })
  })

  it('the Export row says knowledge stays on this device', () => {
    renderPage()
    expect(screen.getByText('Back up chats and settings to a file. Knowledge stays on this device.')).toBeTruthy()
  })

  it('a readable knowledge store shows no Knowledge section', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Nothing here yet.')).toBeTruthy())
    expect(screen.queryByText("Knowledge can't be read")).toBeNull()
    expect(screen.queryByRole('button', { name: 'Start over…' })).toBeNull()
  })

  describe('unreadable knowledge', () => {
    beforeEach(() => {
      putRaw('knowledge', null)
      putRawText('knowledge', '{"items": [')
    })

    it('shows the row, and Start over… opens the sheet with focus on Cancel', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText("Knowledge can't be read")).toBeTruthy())
      expect(
        screen.getByText(
          "Dango can't read your saved knowledge, so nothing new can be saved. Starting over deletes it."
        )
      ).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'Start over…' }))
      const dialog = screen.getByRole('dialog', { name: 'Start over with empty knowledge?' })
      expect(dialog.textContent).toContain(
        "Your saved facts, preferences and proposals are deleted. This can't be undone."
      )
      const buttons = Array.from(dialog.querySelectorAll('button'))
      expect(buttons.map((b) => b.textContent)).toEqual(['Cancel', 'Delete and start over'])
      expect(document.activeElement).toBe(buttons[0])
      expect(buttons[1].className).toBe('dg-btn dg-btn--danger')
    })

    it('Esc and Cancel close the sheet without starting over', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText("Knowledge can't be read")).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Start over…' }))
      fireEvent.keyDown(document, { key: 'Escape' })
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      fireEvent.click(screen.getByRole('button', { name: 'Start over…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
      expect(startKnowledgeOver).not.toHaveBeenCalled()
      expect(getRaw('knowledge')).toBeNull()
    })

    it('Delete and start over calls startKnowledgeOver and the row goes away', async () => {
      renderPage()
      await waitFor(() => expect(screen.getByText("Knowledge can't be read")).toBeTruthy())
      fireEvent.click(screen.getByRole('button', { name: 'Start over…' }))
      fireEvent.click(screen.getByRole('button', { name: 'Delete and start over' }))
      await waitFor(() => expect(screen.queryByText("Knowledge can't be read")).toBeNull())
      expect(startKnowledgeOver).toHaveBeenCalledTimes(1)
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(getRaw('knowledge')).toEqual(emptyKnowledgeState())
    })
  })

  it('Open backup goes to General', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'Open backup' }))
    expect(h.navigateToSettings).toHaveBeenCalledWith('/general')
  })
})

describe('MemoryAdvancedPanel', () => {
  it('no longer carries the two dead memory switches', () => {
    const src = readFileSync(join(__dirname, '../memory/MemoryAdvancedPanel.tsx'), 'utf8')
    expect(src).not.toContain('autoSaveFallbackPin')
    expect(src).not.toContain('showMemoryUpdatedToast')
  })
})
