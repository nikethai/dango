/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MigrationRow } from '@/packages/knowledge/migration'
import { applyMemoryMigration, loadMigrationRows, loadMigrationState } from '@/packages/knowledge/migration'
import * as toastActions from '@/stores/toastActions'
import { MemoryMigrationSheet } from './MemoryMigrationSheet'

const ROWS: MigrationRow[] = [
  { entryId: 'g1', group: { scope: 'global' }, text: 'Prefers metric units', kind: 'preference', choice: 'everywhere' },
  { entryId: 'g2', group: { scope: 'global' }, text: 'Lives in Hanoi', kind: 'fact', choice: 'everywhere' },
  {
    entryId: 'a1',
    group: { scope: 'agent', agentId: 'planner', agentName: 'Planner', promptEditable: true },
    text: 'Window seats',
    kind: 'fact',
    choice: 'agent-prompt',
  },
]

vi.mock('@/packages/knowledge/migration', () => ({
  loadMigrationState: vi.fn(async () => 'pending'),
  loadMigrationRows: vi.fn(async () => ROWS),
  applyMemoryMigration: vi.fn(async () => ({ everywhere: 2, prompts: 1, leftOut: 0 })),
}))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, string | number>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars?.[k] ?? '')),
}))

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
})

async function openSheet() {
  render(<MemoryMigrationSheet />)
  return await screen.findByRole('dialog', { name: 'Choose where your saved notes go' })
}

describe('MemoryMigrationSheet', () => {
  it('groups the rows by where they were saved', async () => {
    const dialog = await openSheet()
    const global = within(dialog).getByRole('group', { name: 'Saved for every chat' })
    expect(within(global).getByText('Prefers metric units')).toBeTruthy()
    expect(within(global).getByText('Lives in Hanoi')).toBeTruthy()
    expect(within(global).queryByRole('radio', { name: /prompt/ })).toBeNull()
    const planner = within(dialog).getByRole('group', { name: 'Saved for Planner' })
    expect(within(planner).getByText('Window seats')).toBeTruthy()
    expect(within(planner).getByRole('radio', { name: "Planner's prompt" }).getAttribute('aria-checked')).toBe('true')
    expect(within(dialog).getByRole('button', { name: 'Move 3 notes' })).toBeTruthy()
  })

  it('leaving one out changes the count', async () => {
    const dialog = await openSheet()
    const row = within(dialog).getByRole('radiogroup', { name: 'Lives in Hanoi' })
    fireEvent.click(within(row).getByRole('radio', { name: 'Leave out' }))
    const move = within(dialog).getByRole('button', { name: 'Move 2 notes' })
    fireEvent.click(move)
    await waitFor(() => expect(applyMemoryMigration).toHaveBeenCalledTimes(1))
    const rows = vi.mocked(applyMemoryMigration).mock.calls[0][0]
    expect(rows.map((r) => r.choice)).toEqual(['everywhere', 'leave-out', 'agent-prompt'])
    await waitFor(() =>
      expect(toastActions.add).toHaveBeenCalledWith('Moved 2 notes to Everywhere and 1 to agent prompts')
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('a non-editable agent has the prompt choice disabled, with the hint', async () => {
    vi.mocked(loadMigrationRows).mockResolvedValueOnce([
      {
        entryId: 'b1',
        group: { scope: 'agent', agentId: 'builtin:task-planner', agentName: 'Task Planner', promptEditable: false },
        text: 'Use checklists',
        kind: 'fact',
        choice: 'everywhere',
      },
    ])
    const dialog = await openSheet()
    const prompt = within(dialog).getByRole('radio', { name: "Task Planner's prompt" })
    expect((prompt as HTMLButtonElement).disabled).toBe(true)
    expect(within(dialog).getByText("Built-in agents can't take notes in their prompt.")).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Leave out' }))
    expect(within(dialog).getByRole('button', { name: 'Finish' })).toBeTruthy()
  })

  it('no toast when nothing moved', async () => {
    vi.mocked(applyMemoryMigration).mockResolvedValueOnce({ everywhere: 0, prompts: 0, leftOut: 3 })
    const dialog = await openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move 3 notes' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(toastActions.add).not.toHaveBeenCalled()
  })

  it('Later closes the sheet without moving anything', async () => {
    const dialog = await openSheet()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Later' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(applyMemoryMigration).not.toHaveBeenCalled()
  })

  it('stays closed when the move is done', async () => {
    vi.mocked(loadMigrationState).mockResolvedValueOnce('done')
    render(<MemoryMigrationSheet />)
    await waitFor(() => expect(loadMigrationState).toHaveBeenCalled())
    await Promise.resolve()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(loadMigrationRows).not.toHaveBeenCalled()
  })
})
