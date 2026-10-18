/**
 * @vitest-environment jsdom
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { MantineProvider } from '@mantine/core'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ navigateToSettings: vi.fn(), navigate: vi.fn() }))

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
vi.mock('@/packages/knowledge/scopes', () => ({
  refreshScopes: async () => undefined,
  scopeName: (id: string) => (id === 'everywhere' ? 'Everywhere' : id === 'acme' ? 'Acme' : 'Unknown scope'),
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

import { _resetKnowledgeForTests, commitKnowledge } from '@/packages/knowledge/store'
import { resetTestStorage } from '@/packages/knowledge/test-storage'
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
  store.setState({ trustLevel: 'auto' })
  resetTestStorage()
  _resetKnowledgeForTests()
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
