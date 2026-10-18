/**
 * @vitest-environment jsdom
 */

import { cleanup, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { _resetKnowledgeForTests } from '@/packages/knowledge/store'
import { resetTestStorage } from '@/packages/knowledge/test-storage'
import { EverywherePage } from './EverywherePage'

vi.mock('@/components/layout/Page', () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/storage', async () => (await import('@/packages/knowledge/test-storage')).default)
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn(), undoEntry: vi.fn(), DEFAULT_UNDO_MS: 5000 }))
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ scopes: [] }), readScopes: async () => [] }))
vi.mock('@/packages/knowledge/scopes', () => ({
  refreshScopes: async () => undefined,
  watchScopes: () => () => undefined,
  scopeExists: () => true,
  getScopeReads: () => ({ facts: true, documents: false }),
  scopeName: (id: string) => id,
}))

afterEach(cleanup)

beforeEach(() => {
  resetTestStorage()
  _resetKnowledgeForTests()
})

describe('EverywherePage', () => {
  it('renders the title and the precedence line', () => {
    render(<EverywherePage />)
    expect(screen.getByRole('heading', { level: 2, name: 'Everywhere' })).toBeTruthy()
    expect(screen.getByText("Read by every scope. A scope's own knowledge wins inside that scope.")).toBeTruthy()
  })

  it('uses the type scale: title-2 for the heading, headline for sections', () => {
    render(<EverywherePage />)
    expect(screen.getByRole('heading', { level: 2, name: 'Everywhere' }).className).toContain('dg-type-title-2')
    for (const h of screen.getAllByRole('heading', { level: 3 })) expect(h.className).toContain('dg-type-headline')
  })

  it('renders the three sections in order', async () => {
    const { container } = render(<EverywherePage />)
    await screen.findByText('Never send email')
    const sections = Array.from(container.querySelectorAll('[data-section]'))
    expect(sections.map((s) => s.getAttribute('data-section'))).toEqual(['preferences', 'facts', 'documents'])
    expect(within(sections[1] as HTMLElement).getByText('Facts you apply to all scopes will appear here.')).toBeTruthy()
    expect(
      within(sections[2] as HTMLElement).getByText(
        'Documents connected to Everywhere will appear here. Client scopes read them only when you turn that on.'
      )
    ).toBeTruthy()
  })

  it('shows the fixed built-in preference without actions', async () => {
    render(<EverywherePage />)
    const row = (await screen.findByText('Never send email')).closest('li') as HTMLElement
    expect(within(row).getByText('Built in')).toBeTruthy()
    expect(within(row).queryAllByRole('button')).toHaveLength(0)
  })

  it('has no chat, delete or tab controls', () => {
    render(<EverywherePage />)
    expect(screen.queryByRole('button', { name: 'New chat' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete scope' })).toBeNull()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})
