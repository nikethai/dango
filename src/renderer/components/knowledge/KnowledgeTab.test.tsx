/**
 * @vitest-environment jsdom
 */
import type { KnowledgeItem } from '@shared/types/knowledge'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addKnowledge, KnowledgeConflictError } from '@/packages/knowledge/approve'
import { editKnowledge, moveKnowledge, removeKnowledge } from '@/packages/knowledge/lifecycle'
import { _resetKnowledgeForTests, commitKnowledge } from '@/packages/knowledge/store'
import { makeItem, resetTestStorage } from '@/packages/knowledge/test-storage'
import * as toastActions from '@/stores/toastActions'
import { EverywhereKnowledge } from './EverywhereKnowledge'
import { KnowledgeTab } from './KnowledgeTab'

vi.mock('@/storage', async () => (await import('@/packages/knowledge/test-storage')).default)
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn(), undoEntry: vi.fn(), DEFAULT_UNDO_MS: 5000 }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, string | number>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars?.[k] ?? '')),
  }),
}))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, string | number>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars?.[k] ?? '')),
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, params, children }: { to: string; params: { sessionId: string }; children: ReactNode }) => (
    <a href={to.replace('$sessionId', params.sessionId)}>{children}</a>
  ),
}))
vi.mock('@/hooks/useScopes', () => ({
  useScopes: () => ({
    scopes: [
      { id: 'acme', name: 'Acme Co' },
      { id: 'beta', name: 'Beta Ltd' },
    ],
  }),
  readScopes: async () => [],
}))
vi.mock('@/packages/knowledge/scopes', () => ({
  refreshScopes: async () => undefined,
  watchScopes: () => () => undefined,
  scopeExists: () => true,
  getScopeReads: () => ({ facts: true, documents: false }),
  scopeName: (id: string) => (id === 'everywhere' ? 'Everywhere' : id === 'acme' ? 'Acme Co' : 'Beta Ltd'),
}))
vi.mock('@/packages/knowledge/lifecycle', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/knowledge/lifecycle')>()),
  editKnowledge: vi.fn(async () => undefined),
  moveKnowledge: vi.fn(async () => undefined),
  removeKnowledge: vi.fn(async () => undefined),
}))
vi.mock('@/packages/knowledge/approve', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/knowledge/approve')>()),
  addKnowledge: vi.fn(async () => undefined),
}))

async function seed(...items: Array<Partial<KnowledgeItem>>) {
  const made = await Promise.all(items.map((i) => makeItem(i)))
  await commitKnowledge((d) => {
    d.items.push(...made)
  })
}

beforeEach(() => {
  resetTestStorage()
  _resetKnowledgeForTests()
  vi.clearAllMocks()
})
afterEach(cleanup)

describe('KnowledgeTab', () => {
  it('searching narrows the list', async () => {
    await seed(
      { id: 'k1', scopeId: 'acme', text: 'Acme pays net 30', updatedAt: 3 },
      { id: 'k2', scopeId: 'acme', text: 'Launch is 6 Nov', updatedAt: 2 }
    )
    render(<KnowledgeTab scopeId="acme" />)
    await screen.findByText('Acme pays net 30')
    expect(screen.getByText('Launch is 6 Nov')).toBeTruthy()
    fireEvent.change(screen.getByPlaceholderText('Search knowledge'), { target: { value: 'acme' } })
    expect(screen.getByText('Acme pays net 30')).toBeTruthy()
    expect(screen.queryByText('Launch is 6 Nov')).toBeNull()
  })

  it('Superseded shows a removed item and hides approved ones', async () => {
    await seed(
      { id: 'k1', scopeId: 'acme', text: 'Launch is 6 Nov', status: 'removed' },
      { id: 'k2', scopeId: 'acme', text: 'Launch is 4 Nov' }
    )
    render(<KnowledgeTab scopeId="acme" />)
    await screen.findByText('Launch is 4 Nov')
    fireEvent.click(screen.getByRole('button', { name: 'Superseded' }))
    expect(screen.getByText('Launch is 6 Nov')).toBeTruthy()
    expect(screen.queryByText('Launch is 4 Nov')).toBeNull()
    const row = screen.getByText('Launch is 6 Nov').closest('li') as HTMLElement
    expect(within(row).queryAllByRole('button', { name: /Edit|Remove|Move to/ })).toHaveLength(0)
  })

  it('a superseded item shows what replaced it, with no actions', async () => {
    await seed(
      { id: 'k1', scopeId: 'acme', text: 'Launch is 6 Nov', status: 'superseded', supersededBy: 'k2' },
      { id: 'k2', scopeId: 'acme', text: 'Launch is 4 Nov' }
    )
    render(<KnowledgeTab scopeId="acme" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Superseded' }))
    expect(screen.getByText('Replaced by "Launch is 4 Nov"')).toBeTruthy()
    const row = screen.getByText('Launch is 6 Nov').closest('li') as HTMLElement
    expect(within(row).queryAllByRole('button', { name: /Edit|Remove|Move to/ })).toHaveLength(0)
  })

  it('Save with unchanged text skips editKnowledge, and reopening resets the draft', async () => {
    await seed({ id: 'k1', scopeId: 'acme', text: 'Launch is 6 Nov' })
    render(<KnowledgeTab scopeId="acme" />)
    await screen.findByText('Launch is 6 Nov')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit' }), { target: { value: 'scratch' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect((screen.getByRole('textbox', { name: 'Edit' }) as HTMLTextAreaElement).value).toBe('Launch is 6 Nov')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Edit' })).toBeNull())
    expect(editKnowledge).not.toHaveBeenCalled()
  })

  it('a duplicate toasts Already saved; any other failure toasts and logs', async () => {
    render(<KnowledgeTab scopeId="acme" />)
    const submit = async () => {
      fireEvent.click(await screen.findByRole('button', { name: 'Add knowledge' }))
      fireEvent.change(screen.getByRole('textbox', { name: 'Knowledge' }), { target: { value: 'Launch is 4 Nov' } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    }
    vi.mocked(addKnowledge).mockRejectedValueOnce(new Error('duplicate'))
    await submit()
    await waitFor(() => expect(toastActions.add).toHaveBeenCalledWith('Already saved'))
    cleanup()
    render(<KnowledgeTab scopeId="acme" />)
    vi.mocked(addKnowledge).mockRejectedValueOnce(new Error('boom'))
    await submit()
    await waitFor(() => expect(toastActions.add).toHaveBeenCalledWith("Couldn't save that. Try again."))
  })

  it('ignores a second click while an action is pending', async () => {
    await seed({ id: 'k1', scopeId: 'acme', text: 'Launch is 6 Nov' })
    let release: () => void = () => undefined
    vi.mocked(removeKnowledge).mockImplementationOnce(
      () =>
        new Promise<void>((r) => {
          release = r
        })
    )
    render(<KnowledgeTab scopeId="acme" />)
    await screen.findByText('Launch is 6 Nov')
    const button = screen.getByRole('button', { name: 'Remove' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(removeKnowledge).toHaveBeenCalledTimes(1)
    await act(async () => release())
  })

  it('after Remove, focus moves to the next row, or the search field when none is left', async () => {
    await seed(
      { id: 'k1', scopeId: 'acme', text: 'First', updatedAt: 3 },
      { id: 'k2', scopeId: 'acme', text: 'Second', updatedAt: 2 }
    )
    vi.mocked(removeKnowledge).mockImplementation(async (id) => {
      await commitKnowledge((d) => {
        const i = d.items.find((x) => x.id === id)
        if (i) i.status = 'removed'
      })
    })
    render(<KnowledgeTab scopeId="acme" />)
    await screen.findByText('First')
    const first = screen.getByText('First').closest('li') as HTMLElement
    fireEvent.click(within(first).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(screen.queryByText('First')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Second')))
    const second = screen.getByText('Second').closest('li') as HTMLElement
    fireEvent.click(within(second).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByPlaceholderText('Search knowledge')))
  })

  it('the Move menu focuses its first item and closes on Escape', async () => {
    await seed({ id: 'k1', scopeId: 'acme', text: 'Launch is 6 Nov' })
    render(<KnowledgeTab scopeId="acme" />)
    await screen.findByText('Launch is 6 Nov')
    fireEvent.click(screen.getByRole('button', { name: 'Move to…' }))
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('menuitem', { name: 'Everywhere' })))
    fireEvent.keyDown(document.activeElement as Element, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Move to…' }))
    expect(screen.getByRole('menu')).toBeTruthy()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('the add form focuses its textarea', async () => {
    render(<KnowledgeTab scopeId="acme" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add knowledge' }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Knowledge' }))
  })

  it('Edit then Save calls editKnowledge', async () => {
    await seed({ id: 'k1', scopeId: 'acme', text: 'Launch is 6 Nov' })
    render(<KnowledgeTab scopeId="acme" />)
    await screen.findByText('Launch is 6 Nov')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit' }), { target: { value: 'Launch is 4 Nov' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(editKnowledge).toHaveBeenCalledWith('k1', 'Launch is 4 Nov'))
  })

  it('Move to lists Everywhere and other scopes, not the current one', async () => {
    await seed({ id: 'k1', scopeId: 'acme', text: 'Launch is 6 Nov' })
    render(<KnowledgeTab scopeId="acme" />)
    await screen.findByText('Launch is 6 Nov')
    fireEvent.click(screen.getByRole('button', { name: 'Move to…' }))
    const menu = screen.getByRole('menu')
    expect(within(menu).getByRole('menuitem', { name: 'Everywhere' })).toBeTruthy()
    expect(within(menu).getByRole('menuitem', { name: 'Beta Ltd' })).toBeTruthy()
    expect(within(menu).queryByRole('menuitem', { name: 'Acme Co' })).toBeNull()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Beta Ltd' }))
    await waitFor(() => expect(moveKnowledge).toHaveBeenCalledWith('k1', 'beta'))
  })

  it('Remove calls removeKnowledge', async () => {
    await seed({ id: 'k1', scopeId: 'acme', text: 'Launch is 6 Nov' })
    render(<KnowledgeTab scopeId="acme" />)
    await screen.findByText('Launch is 6 Nov')
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(removeKnowledge).toHaveBeenCalledWith('k1'))
  })

  it('detail lists chat uses as links, sources and history', async () => {
    await seed({
      id: 'k1',
      scopeId: 'acme',
      text: 'Launch is 6 Nov',
      condition: 'the client agrees',
      sources: [
        { id: 's1', kind: 'chat', label: 'Planning call' },
        { id: 's2', kind: 'file', label: 'plan.pdf', removed: true },
      ],
      history: [{ at: Date.UTC(2026, 9, 1), by: 'user', action: 'edited', note: 'Launch is 5 Nov' }],
    })
    await commitKnowledge((d) => {
      d.uses.push({ itemId: 'k1', scopeId: 'acme', ref: { type: 'chat', id: 's1', label: 'Pricing call' }, at: 5 })
    })
    render(<KnowledgeTab scopeId="acme" />)
    fireEvent.click(await screen.findByText('Launch is 6 Nov'))
    const link = screen.getByRole('link', { name: 'Pricing call' })
    expect(link.getAttribute('href')).toBe('/session/s1')
    expect(screen.getByText('plan.pdf (source removed)')).toBeTruthy()
    expect(screen.getByText(/^.* · You · edited/)).toBeTruthy()
    expect(screen.getByText('When the client agrees')).toBeTruthy()
    expect(screen.getByText('Acme Co')).toBeTruthy()
  })

  it('Add knowledge saves through addKnowledge; a conflict toasts', async () => {
    render(<KnowledgeTab scopeId="acme" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add knowledge' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Knowledge' }), { target: { value: 'Launch is 4 Nov' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(addKnowledge).toHaveBeenCalledWith({ scopeId: 'acme', kind: 'fact', text: 'Launch is 4 Nov' })
    )
    cleanup()

    vi.mocked(addKnowledge).mockRejectedValueOnce(
      new KnowledgeConflictError(
        { id: 'c', scopeId: 'acme', proposalId: 'p', itemIds: ['k1'], state: 'open', createdAt: 1 },
        'Launch is 6 Nov'
      )
    )
    render(<KnowledgeTab scopeId="acme" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add knowledge' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Knowledge' }), { target: { value: 'Launch is 4 Nov' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(toastActions.add).toHaveBeenCalledWith('Waiting in Review: it contradicts "Launch is 6 Nov"')
    )
  })
})

describe('EverywhereKnowledge', () => {
  it('preferences render the built-in row with Built in and no actions', async () => {
    render(<EverywhereKnowledge section="preferences" />)
    const row = (await screen.findByText('Never send email')).closest('li') as HTMLElement
    expect(within(row).getByText('Built in')).toBeTruthy()
    expect(within(row).queryByRole('button', { name: 'Remove' })).toBeNull()
    expect(within(row).queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('preferences have no Move to; facts do', async () => {
    await seed(
      { id: 'k1', scopeId: 'everywhere', kind: 'preference', text: 'Write short replies' },
      { id: 'k2', scopeId: 'everywhere', kind: 'fact', text: 'We are in Hanoi' }
    )
    render(<EverywhereKnowledge section="preferences" />)
    const pref = (await screen.findByText('Write short replies')).closest('li') as HTMLElement
    expect(within(pref).getByRole('button', { name: 'Edit' })).toBeTruthy()
    expect(within(pref).queryByRole('button', { name: 'Move to…' })).toBeNull()
    expect(screen.queryByText('We are in Hanoi')).toBeNull()
    cleanup()
    render(<EverywhereKnowledge section="facts" />)
    const fact = (await screen.findByText('We are in Hanoi')).closest('li') as HTMLElement
    expect(within(fact).getByRole('button', { name: 'Move to…' })).toBeTruthy()
    fireEvent.click(within(fact).getByRole('button', { name: 'Move to…' }))
    expect(screen.queryByRole('menuitem', { name: 'Everywhere' })).toBeNull()
    expect(screen.getByRole('menuitem', { name: 'Acme Co' })).toBeTruthy()
  })

  it('facts show the empty copy when there are none', async () => {
    render(<EverywhereKnowledge section="facts" />)
    expect(await screen.findByText('Facts you apply to all scopes will appear here.')).toBeTruthy()
  })
})
