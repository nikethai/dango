/**
 * @vitest-environment jsdom
 */

import type { Scope, SessionMeta } from '@shared/types'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ActionMenuItemProps } from '../ActionMenu'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => options?.[name] ?? ''),
  }),
}))

const scopes: Scope[] = [
  { id: 'p1', name: 'Alpha', kind: 'project', order: 0 },
  { id: 'p2', name: 'Acme Co', kind: 'client', order: 1 },
  { id: 'everywhere', name: 'Everywhere', kind: 'project', order: 2 },
] as Scope[]
vi.mock('@/hooks/useScopes', () => ({ useScopes: () => ({ scopes }) }))

const actions = vi.hoisted(() => ({
  moveChatWithUndoOrToast: vi.fn(() => Promise.resolve(true)),
  deleteChatWithUndo: vi.fn(() => Promise.resolve({ name: 'Chat' })),
  archiveChatWithUndo: vi.fn(() => Promise.resolve({ name: 'Chat', archived: true })),
}))
vi.mock('@/stores/session/chat-menu-actions', () => actions)
const startNewChat = vi.hoisted(() => vi.fn())
vi.mock('@/lib/startNewChat', () => ({ startNewChat }))
vi.mock('@/stores/chatStore', () => ({
  updateSession: vi.fn(() => Promise.resolve()),
  getSession: vi.fn(() => Promise.resolve({ id: 's1', messages: [{ id: 'm1' }, { id: 'm2' }] })),
}))
const branchChatFromMessage = vi.hoisted(() => vi.fn(() => Promise.resolve('copy')))
vi.mock('@/stores/session/branch', () => ({ branchChatFromMessage }))
vi.mock('@/stores/sessionActions', () => ({ switchCurrentSession: vi.fn() }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('@/stores/atoms', () => ({ currentSessionIdAtom: {} }))
vi.mock('@ebay/nice-modal-react', () => ({ default: { show: vi.fn() } }))

import { useChatMenu } from './useChatMenu'

type Row = Extract<ActionMenuItemProps, { text: string }>
let latest: { items: ActionMenuItemProps[] } = { items: [] }

function Harness(props: { session: SessionMeta; selected: boolean; onRename?: () => void }) {
  const menu = useChatMenu(props.session, { selected: props.selected, onRename: props.onRename })
  latest = menu
  return <>{menu.sheet}</>
}

const row = (text: string) => latest.items.find((item): item is Row => !item.divider && item.text === text)
const session = { id: 's1', name: 'Chat', projectId: 'p1', folderId: 'p1' } as SessionMeta

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockClear()
  startNewChat.mockClear()
})
afterEach(cleanup)

describe('useChatMenu', () => {
  it('Branch branches the chat from its latest message', async () => {
    render(<Harness session={session} selected={false} onRename={vi.fn()} />)
    await act(async () => row('Branch')?.onClick?.({} as never))
    expect(branchChatFromMessage).toHaveBeenCalledWith('s1', 'm2')
  })

  it('Move to scope… opens a sheet: None first, then scopes without Everywhere, the current one marked', () => {
    render(<Harness session={session} selected={false} onRename={vi.fn()} />)
    act(() => row('Move to scope…')?.onClick?.({} as never))
    const dialog = screen.getByRole('dialog', { name: 'Move to scope' })
    const choices = Array.from(dialog.querySelectorAll('.dg-menu button')).map((b) => b.textContent)
    expect(choices).toEqual(['None', 'Alpha', 'Acme Coclient'])
    expect(screen.getByRole('button', { name: 'Alpha' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: 'None' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('choosing a scope moves the chat with undo and closes the sheet; None moves it out', () => {
    render(<Harness session={session} selected={false} onRename={vi.fn()} />)
    act(() => row('Move to scope…')?.onClick?.({} as never))
    fireEvent.click(screen.getByRole('button', { name: /Acme Co/ }))
    expect(actions.moveChatWithUndoOrToast).toHaveBeenCalledWith('s1', 'p2')
    expect(screen.queryByRole('dialog')).toBeNull()

    act(() => row('Move to scope…')?.onClick?.({} as never))
    fireEvent.click(screen.getByRole('button', { name: 'None' }))
    expect(actions.moveChatWithUndoOrToast).toHaveBeenLastCalledWith('s1', undefined)
  })

  it('deleting the open chat goes to a new chat; deleting another stays put', async () => {
    const { rerender } = render(<Harness session={session} selected onRename={vi.fn()} />)
    await act(async () => row('Delete chat')?.onClick?.({} as never))
    expect(actions.deleteChatWithUndo).toHaveBeenCalledWith('s1')
    expect(startNewChat).toHaveBeenCalledTimes(1)

    rerender(<Harness session={session} selected={false} onRename={vi.fn()} />)
    await act(async () => row('Delete chat')?.onClick?.({} as never))
    expect(startNewChat).toHaveBeenCalledTimes(1)
  })

  it('leaves out Rename when there is nothing to rename with', () => {
    render(<Harness session={session} selected />)
    expect(row('Rename')).toBeUndefined()
    expect(row('Pin')).toBeDefined()
  })
})
