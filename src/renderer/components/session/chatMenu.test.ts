import type { TFunction } from 'i18next'
import { describe, expect, it, vi } from 'vitest'
import type { ActionMenuItemProps } from '../ActionMenu'
import { buildChatMenuItems, type ChatMenuHandlers } from './chatMenu'

const t = ((key: string) => key) as unknown as TFunction

function handlers(): ChatMenuHandlers {
  return {
    onRename: vi.fn(),
    onTogglePin: vi.fn(),
    onMoveToScope: vi.fn(),
    onBranch: vi.fn(),
    onExport: vi.fn(),
    onToggleArchive: vi.fn(),
    onDelete: vi.fn(),
  }
}

type Row = Extract<ActionMenuItemProps, { text: string }>
const rows = (items: ActionMenuItemProps[]) => items.filter((item): item is Row => !item.divider)

describe('buildChatMenuItems', () => {
  it('lists the seven rows in order around one divider', () => {
    const items = buildChatMenuItems({ starred: false, archived: false }, handlers(), t)
    expect(rows(items).map((row) => row.text)).toEqual([
      'Rename',
      'Pin',
      'Move to scope…',
      'Branch',
      'Export',
      'Archive',
      'Delete chat',
    ])
    expect(items.filter((item) => item.divider)).toHaveLength(1)
    expect(items.findIndex((item) => item.divider)).toBe(5)
    expect(items.length).toBeLessThanOrEqual(8)
  })

  it('offers Unpin for a pinned chat and Unarchive for an archived one', () => {
    const texts = rows(buildChatMenuItems({ starred: true, archived: true }, handlers(), t)).map((row) => row.text)
    expect(texts).toContain('Unpin')
    expect(texts).toContain('Unarchive')
    expect(texts).not.toContain('Pin')
    expect(texts).not.toContain('Archive')
  })

  it('never asks for a double check (undo replaces it) and marks Delete chat as destructive', () => {
    const items = rows(buildChatMenuItems({ starred: false, archived: false }, handlers(), t))
    expect(items.some((row) => row.doubleCheck)).toBe(false)
    expect(items.find((row) => row.text === 'Delete chat')?.color).toBe('chatbox-error')
  })

  it("each row's onClick calls its handler", () => {
    const h = handlers()
    const items = rows(buildChatMenuItems({ starred: false, archived: false }, h, t))
    const expected: Array<keyof ChatMenuHandlers> = [
      'onRename',
      'onTogglePin',
      'onMoveToScope',
      'onBranch',
      'onExport',
      'onToggleArchive',
      'onDelete',
    ]
    items.forEach((row, index) => {
      row.onClick?.({} as never)
      // Only this row's handler fired now: every earlier one once, every later one not yet.
      expected.forEach((name, i) => {
        expect(h[name]).toHaveBeenCalledTimes(i <= index ? 1 : 0)
      })
    })
  })
})
