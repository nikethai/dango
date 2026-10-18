/**
 * @vitest-environment jsdom
 */

import type { Scope, SessionMeta } from '@shared/types'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScopePageView, type ScopePageViewProps } from './ScopePage'

const startNewChat = vi.fn()
vi.mock('@/lib/startNewChat', () => ({ startNewChat: (...args: unknown[]) => startNewChat(...args) }))
vi.mock('@/components/layout/Page', () => ({
  default: ({ title, children }: { title: string; children: ReactNode }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars?.[name] ?? '')),
  }),
}))

vi.mock('@/components/knowledge/KnowledgeTab', () => ({
  KnowledgeTab: ({ scopeId }: { scopeId: string }) => <div data-testid="knowledge-tab">{scopeId}</div>,
}))

afterEach(() => {
  cleanup()
  startNewChat.mockReset()
})

const scope = { id: 's1', name: 'Acme Co', kind: 'client' } as Scope
const chat = { id: 'c1', name: 'Pricing call', updatedAt: Date.now() - 60_000 } as SessionMeta

function view(props: Partial<ScopePageViewProps> = {}) {
  const base: ScopePageViewProps = {
    scope,
    chats: [],
    knowledgeCount: 0,
    tab: 'overview',
    folderBound: false,
    onTabChange: vi.fn(),
    onNewChat: vi.fn(),
    onOpenChat: vi.fn(),
    settings: null,
    files: null,
  }
  const merged = { ...base, ...props }
  render(<ScopePageView {...merged} />)
  return merged
}

describe('ScopePageView', () => {
  it('tabs in order', () => {
    const props = view()
    const names = () => screen.getAllByRole('tab').map((tab) => tab.textContent)
    expect(names()).toEqual(['Overview', 'Knowledge', 'Sources', 'Chats', 'Settings'])
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }))
    expect(props.onTabChange).toHaveBeenCalledWith('chats')
    cleanup()
    view({ folderBound: true })
    expect(names()).toEqual(['Overview', 'Knowledge', 'Sources', 'Files', 'Chats', 'Settings'])
  })

  it('empty scope shows EM1', () => {
    const props = view()
    expect(screen.getByText('Nothing known about Acme Co yet')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Start a chat' }))
    expect(props.onNewChat).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add a source' }))
    expect(props.onTabChange).toHaveBeenCalledWith('sources')
    cleanup()
    view({ chats: [chat] })
    expect(screen.getByText('Recent chats')).toBeTruthy()
    expect(screen.getByText('Pricing call')).toBeTruthy()
    expect(screen.queryByText('Nothing known about Acme Co yet')).toBeNull()
    expect(screen.getByText('No knowledge yet')).toBeTruthy()
  })

  it('the knowledge tab mounts the Knowledge tab for the scope', () => {
    view({ tab: 'knowledge' })
    expect(screen.getByTestId('knowledge-tab').textContent).toBe('s1')
  })

  it('placeholders name what will appear', () => {
    view({ tab: 'sources' })
    expect(
      screen.getByText(
        'Folders, Gmail, Asana and documents connected to Acme Co will appear here. Dango reads only the sources you connect.'
      )
    ).toBeTruthy()
  })

  it('files tab without a bound folder falls back to overview', () => {
    view({ tab: 'files', files: <div>Files body</div> })
    expect(screen.queryByText('Files body')).toBeNull()
    expect(screen.getByText('Nothing known about Acme Co yet')).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'Overview' }).getAttribute('aria-selected')).toBe('true')
  })

  it('scope name uses the title-2 type style', () => {
    view({ chats: [chat] })
    expect(screen.getByRole('heading', { level: 2, name: 'Acme Co' }).className).toContain('dg-type-title-2')
  })

  it('client chip', () => {
    view()
    const chip = screen.getByText('client')
    expect(chip.className).toContain('dg-chip')
  })

  it('chats tab lists chats and opens one', () => {
    const props = view({ tab: 'chats', chats: [chat] })
    fireEvent.click(screen.getByText('Pricing call'))
    expect(props.onOpenChat).toHaveBeenCalledWith('c1')
    cleanup()
    view({ tab: 'chats' })
    expect(screen.getByText('No chats in Acme Co yet.')).toBeTruthy()
    expect(within(document.body).getAllByRole('button', { name: 'New chat' }).length).toBeGreaterThan(0)
  })

  it('unknown scope', () => {
    view({ scope: undefined })
    expect(screen.getByText('This scope no longer exists.')).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Start a new chat' }))
    expect(startNewChat).toHaveBeenCalledWith({})
  })
})
