// @vitest-environment jsdom

import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchGroup, SearchHit } from '@/packages/search'
import { attachPrefill } from '@/packages/search/attach'

const h = vi.hoisted(() => ({
  useSearch: vi.fn(),
  startNewChat: vi.fn(),
  showModal: vi.fn(),
  state: {
    groups: { chats: [], knowledge: [], sources: [] } as Record<string, unknown[]>,
    loading: false,
    stale: false,
  },
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('@/packages/search', async () => {
  const { attachPrefill } = await import('@/packages/search/attach')
  return { attachPrefill, useSearch: h.useSearch }
})
vi.mock('@/hooks/useScopes', () => ({
  useScopes: () => ({
    scopes: [
      { id: 'acme', name: 'Acme' },
      { id: 'home', name: 'Home' },
    ],
  }),
}))
vi.mock('@/lib/startNewChat', () => ({ startNewChat: h.startNewChat }))
vi.mock('@ebay/nice-modal-react', () => ({ default: { show: h.showModal } }))
vi.mock('@/platform', () => ({ default: {}, platformCapabilities: { supportsImportedArchives: true } }))
vi.mock('@/packages/navigator', () => ({ getOS: () => 'Mac' }))
vi.mock('@/stores/uiStore', async () => {
  const { create } = await import('zustand')
  const useUIStore = create<{ openSearchDialog: boolean; setOpenSearchDialog: (open: boolean) => void }>((set) => ({
    openSearchDialog: false,
    setOpenSearchDialog: (openSearchDialog) => set({ openSearchDialog }),
  }))
  return { useUIStore }
})

import { Sheet } from '@/components/ui/Sheet'
import { useUIStore as useMockedUIStore } from '@/stores/uiStore'
import { SearchOverlay } from './SearchOverlay'

// The mocked store above (a plain zustand store with only the search flag).
const useUIStore = useMockedUIStore as unknown as {
  getState(): { openSearchDialog: boolean; setOpenSearchDialog: (open: boolean) => void }
}

function hit(id: string, group: SearchGroup, over: Partial<SearchHit> = {}): SearchHit {
  return {
    id,
    group,
    title: `Title ${id}`,
    excerpt: `Excerpt ${id}`,
    sourceLabel: `Label ${id}`,
    open: vi.fn(),
    ...over,
  }
}

function setResults(
  groups: Partial<Record<SearchGroup, SearchHit[]>>,
  over: { loading?: boolean; stale?: boolean } = {}
) {
  h.state = {
    groups: { chats: [], knowledge: [], sources: [], ...groups },
    loading: over.loading ?? false,
    stale: over.stale ?? false,
  }
}

const open = () => act(() => useUIStore.getState().setOpenSearchDialog(true))
const isOpen = () => useUIStore.getState().openSearchDialog
const input = () => screen.getByRole('textbox', { name: 'Search chats, knowledge and sources' }) as HTMLInputElement
const type = (text: string) => fireEvent.change(input(), { target: { value: text } })

beforeEach(() => {
  h.useSearch.mockReset()
  h.useSearch.mockImplementation(() => h.state)
  h.startNewChat.mockReset()
  h.showModal.mockReset()
  setResults({})
  act(() => useUIStore.getState().setOpenSearchDialog(false))
})

afterEach(() => {
  cleanup()
  act(() => useUIStore.getState().setOpenSearchDialog(false))
  document.body.innerHTML = ''
})

describe('SearchOverlay', () => {
  it('renders nothing while closed and leaves #root without aria-hidden (TASK-15)', () => {
    const root = document.createElement('div')
    root.id = 'root'
    document.body.appendChild(root)
    render(<SearchOverlay />, { container: root })
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(root.innerHTML).toBe('')
    expect(root.getAttribute('aria-hidden')).toBeNull()
    expect(document.querySelector('.dg-search-layer')).toBeNull()
    open()
    expect(root.getAttribute('aria-hidden')).toBeNull()
  })

  it('opening focuses the input; groups render in order Chats, Knowledge, Sources; an empty group is hidden', () => {
    setResults({ chats: [hit('c1', 'chats')], knowledge: [hit('k1', 'knowledge')], sources: [hit('s1', 'sources')] })
    render(<SearchOverlay />)
    open()
    expect(screen.getByRole('dialog', { name: 'Search' }).getAttribute('aria-modal')).toBe('true')
    expect(document.activeElement).toBe(input())
    type('plan')
    const listbox = screen.getByRole('listbox')
    const text = listbox.textContent ?? ''
    expect(text.indexOf('Chats')).toBeLessThan(text.indexOf('Knowledge'))
    expect(text.indexOf('Knowledge')).toBeLessThan(text.indexOf('Sources'))
    expect(screen.getAllByRole('option')).toHaveLength(3)
    expect(screen.getByText('Title k1')).toBeTruthy()
    expect(screen.getByText('Excerpt k1')).toBeTruthy()
    expect(screen.getByText('Label k1')).toBeTruthy()
    expect(input().getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[0].id)

    cleanup()
    setResults({ chats: [hit('c1', 'chats')], sources: [hit('s1', 'sources')] })
    act(() => useUIStore.getState().setOpenSearchDialog(false))
    render(<SearchOverlay />)
    open()
    type('plan')
    expect(screen.getByText('Chats')).toBeTruthy()
    expect(screen.queryByText('Knowledge')).toBeNull()
    expect(screen.getByText('Sources')).toBeTruthy()
  })

  it('chips: "All" is pressed; clicking "Acme" searches ["acme"] and presses it', () => {
    render(<SearchOverlay />)
    open()
    const all = screen.getByRole('button', { name: 'All' })
    const acme = screen.getByRole('button', { name: 'Acme' })
    expect(all.getAttribute('aria-pressed')).toBe('true')
    expect(acme.getAttribute('aria-pressed')).toBe('false')
    const chips = Array.from(document.querySelectorAll('.dg-chip')).map((el) => el.textContent)
    expect(chips).toEqual(['All', 'Acme', 'Home'])
    expect(h.useSearch).toHaveBeenLastCalledWith('', 'all')
    fireEvent.click(acme)
    expect(h.useSearch).toHaveBeenLastCalledWith('', ['acme'])
    expect(acme.getAttribute('aria-pressed')).toBe('true')
    expect(all.getAttribute('aria-pressed')).toBe('false')
  })

  it('↵ opens: ArrowDown then Enter opens the second hit and closes the overlay', () => {
    const first = hit('c1', 'chats')
    const second = hit('k1', 'knowledge')
    let openWasClosed: boolean | null = null
    second.open = vi.fn(() => {
      openWasClosed = !isOpen()
    })
    setResults({ chats: [first], knowledge: [second] })
    render(<SearchOverlay />)
    open()
    type('plan')
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input().getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id)
    fireEvent.keyDown(input(), { key: 'Enter' })
    expect(second.open).toHaveBeenCalledTimes(1)
    expect(first.open).not.toHaveBeenCalled()
    expect(openWasClosed).toBe(true)
    expect(isOpen()).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('↓/↑ wrap across the flat list', () => {
    setResults({ chats: [hit('c1', 'chats')], sources: [hit('s1', 'sources')] })
    render(<SearchOverlay />)
    open()
    type('plan')
    const ids = screen.getAllByRole('option').map((el) => el.id)
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    expect(input().getAttribute('aria-activedescendant')).toBe(ids[1])
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    expect(input().getAttribute('aria-activedescendant')).toBe(ids[0])
  })

  it('↵ and ⌘↵ do nothing while the results are stale', () => {
    const first = hit('c1', 'chats')
    setResults({ chats: [first] }, { stale: true, loading: true })
    render(<SearchOverlay />)
    open()
    type('plan')
    fireEvent.keyDown(input(), { key: 'Enter' })
    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true })
    expect(first.open).not.toHaveBeenCalled()
    expect(h.startNewChat).not.toHaveBeenCalled()
    expect(isOpen()).toBe(true)
  })

  it('⌘↵ attaches: a knowledge hit in scope acme starts a chat in acme with the hit quoted', () => {
    const k = hit('k1', 'knowledge', { scopeId: 'acme' })
    setResults({ knowledge: [k] })
    render(<SearchOverlay />)
    open()
    type('plan')
    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true })
    expect(h.startNewChat).toHaveBeenCalledWith({ scopeId: 'acme', prefill: attachPrefill(k) })
    expect(k.open).not.toHaveBeenCalled()
    expect(isOpen()).toBe(false)
  })

  it('⌘↵ on an Everywhere hit (or one without a scope) starts a chat with no scope', () => {
    const everywhere = hit('k1', 'knowledge', { scopeId: 'everywhere' })
    const unscoped = hit('c1', 'chats')
    setResults({ knowledge: [everywhere] })
    render(<SearchOverlay />)
    open()
    type('plan')
    fireEvent.keyDown(input(), { key: 'Enter', ctrlKey: true })
    expect(h.startNewChat).toHaveBeenLastCalledWith({ scopeId: undefined, prefill: attachPrefill(everywhere) })

    setResults({ chats: [unscoped] })
    open()
    type('plan')
    fireEvent.keyDown(input(), { key: 'Enter', metaKey: true })
    expect(h.startNewChat).toHaveBeenLastCalledWith({ scopeId: undefined, prefill: attachPrefill(unscoped) })
  })

  it('Esc closes and focus returns to the opener button', () => {
    render(
      <>
        <button type="button" onClick={() => useUIStore.getState().setOpenSearchDialog(true)}>
          Opener
        </button>
        <SearchOverlay />
      </>
    )
    const opener = screen.getByRole('button', { name: 'Opener' })
    opener.focus()
    act(() => opener.click())
    expect(document.activeElement).toBe(input())
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(isOpen()).toBe(false)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(opener)
  })

  it('clicking the scrim closes', () => {
    render(<SearchOverlay />)
    open()
    fireEvent.click(document.querySelector('.dg-search-layer__scrim') as HTMLElement)
    expect(isOpen()).toBe(false)
  })

  it('Esc with a permission sheet open over the overlay closes only the sheet', () => {
    const onSheetClose = vi.fn()
    const { rerender } = render(
      <>
        <SearchOverlay />
        <Sheet opened={false} onClose={onSheetClose} title="Edit docs/a.md" />
      </>
    )
    open()
    rerender(
      <>
        <SearchOverlay />
        <Sheet opened onClose={onSheetClose} title="Edit docs/a.md" />
      </>
    )
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(onSheetClose).toHaveBeenCalledTimes(1)
    expect(isOpen()).toBe(true)
    expect(screen.getByRole('dialog', { name: 'Search' })).toBeTruthy()
  })

  it('nothing found shows the query', () => {
    render(<SearchOverlay />)
    open()
    type('zzz')
    expect(screen.getByText('Nothing found for “zzz”')).toBeTruthy()
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('foot shows the key hints and the import link, which opens the archive import', () => {
    render(<SearchOverlay />)
    open()
    const foot = document.querySelector('.dg-qc__foot') as HTMLElement
    expect(foot.textContent).toContain('⌘↵')
    expect(foot.textContent).toContain('New chat with it')
    expect(foot.textContent).toContain('Esc')
    fireEvent.click(screen.getByRole('button', { name: 'Import ChatGPT archive' }))
    expect(isOpen()).toBe(false)
    expect(h.showModal).toHaveBeenCalledWith('import-chatgpt-archive')
  })
})

describe('source scan', () => {
  const renderer = resolve(__dirname, '../..')

  it('__root.tsx mounts SearchOverlay outside Quick Chat and no longer uses SearchDialog', () => {
    const root = readFileSync(resolve(renderer, 'routes/__root.tsx'), 'utf8')
    expect(root).not.toContain('SearchDialog')
    expect(root).toContain('{isQuickRoute ? null : <SearchOverlay />}')
    expect(root).toMatch(/\n\s*<ToolPermissionHost \/>/)
  })

  it('no file under components/search contains the sheet class', () => {
    const dir = resolve(renderer, 'components/search')
    const sheetClass = ['dg', 'sheet'].join('-')
    for (const name of readdirSync(dir)) {
      expect(readFileSync(resolve(dir, name), 'utf8'), name).not.toContain(sheetClass)
    }
  })
})
