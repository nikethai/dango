// @vitest-environment jsdom

import { EVERYWHERE_SCOPE_ID } from '@shared/types'
import { ToolRiskTier } from '@shared/types/mcp'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pushUndo } from '@/packages/undo'
import { add as addToast } from '@/stores/toastActions'
import { type ScopeToolGrant, toolApprovalStore } from '@/stores/toolApprovalStore'
import { ScopePermissions } from './ScopePermissions'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? name)),
  }),
}))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? name)),
}))
vi.mock('@/packages/undo', () => ({ pushUndo: vi.fn(() => 'undo-id') }))
vi.mock('@/stores/toastActions', () => ({ add: vi.fn() }))

const EMPTY = 'Nothing yet. When you choose Always in this scope, it shows here.'

const older: ScopeToolGrant = {
  toolName: 'browser_click',
  riskTier: ToolRiskTier.MEDIUM,
  grantedAt: new Date(2026, 0, 5).getTime(),
}
const newer: ScopeToolGrant = {
  toolName: 'read_calendar',
  riskTier: ToolRiskTier.LOW,
  grantedAt: new Date(2026, 3, 9).getTime(),
}

function grant(scopeId: string, g: ScopeToolGrant) {
  toolApprovalStore.getState().addScopeGrant(scopeId, g)
}

beforeEach(() => {
  toolApprovalStore.setState({ scopeGrants: {} })
  vi.mocked(pushUndo).mockClear()
  vi.mocked(addToast).mockClear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ScopePermissions', () => {
  it('lists two grants as two rows, newest first', () => {
    grant('scope-1', older)
    grant('scope-1', newer)
    render(<ScopePermissions scopeId="scope-1" />)
    expect(screen.getByRole('heading', { name: 'Allowed without asking' })).toBeTruthy()
    expect(
      screen.getByText('Dango does these in this scope without asking. Sending and deleting always ask.')
    ).toBeTruthy()
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('Read calendar')
    expect(rows[1].textContent).toContain('Browser click')
    expect(rows[0].textContent).toContain(`Since ${new Date(newer.grantedAt).toLocaleDateString()}`)
    expect(screen.getAllByRole('button', { name: 'Stop allowing' })).toHaveLength(2)
    expect(screen.queryByText(EMPTY)).toBeNull()
  })

  it('does not list grants for tools that always ask, such as command tools', () => {
    grant('scope-1', older)
    grant('scope-1', { toolName: 'run_command', riskTier: ToolRiskTier.HIGH, grantedAt: 1 })
    render(<ScopePermissions scopeId="scope-1" />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Browser click')
  })

  it('hides a grant whose stored description says the tool runs commands', () => {
    grant('scope-1', older)
    grant('scope-1', {
      toolName: 'mcp_tool',
      riskTier: ToolRiskTier.MEDIUM,
      grantedAt: 2,
      toolDescription: 'Run a shell command',
    })
    render(<ScopePermissions scopeId="scope-1" />)
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
  })

  it('lists a read-only command grant for a shell tool, marked read-only commands only', () => {
    grant('scope-1', {
      toolName: 'mcp__shell__run_command',
      riskTier: ToolRiskTier.MEDIUM,
      grantedAt: 3,
      toolDescription: 'Run a shell command',
      readOnlyCommands: true,
    })
    render(<ScopePermissions scopeId="scope-1" />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(1)
    expect(rows[0].textContent).toContain('Only commands that just look')
  })

  it('does not list a read-only marked grant for a tool the gate would not honour it for', () => {
    grant('scope-1', {
      toolName: 'mcp__code__run_python',
      riskTier: ToolRiskTier.MEDIUM,
      grantedAt: 3,
      toolDescription: 'Run Python code',
      readOnlyCommands: true,
    })
    render(<ScopePermissions scopeId="scope-1" />)
    expect(screen.getByText(EMPTY)).toBeTruthy()
  })

  it('shows the empty copy when only command-tool grants remain', () => {
    grant('scope-1', { toolName: 'terminal_exec', riskTier: ToolRiskTier.MEDIUM, grantedAt: 1 })
    render(<ScopePermissions scopeId="scope-1" />)
    expect(screen.getByText(EMPTY)).toBeTruthy()
  })

  it('shows the empty copy when the scope has no grants', () => {
    grant('other-scope', older)
    render(<ScopePermissions scopeId="scope-1" />)
    expect(screen.getByText(EMPTY)).toBeTruthy()
    expect(screen.queryAllByRole('listitem')).toHaveLength(0)
  })

  it('Stop allowing removes the row and offers undo; undo restores it', async () => {
    grant('scope-1', older)
    grant('scope-1', newer)
    render(<ScopePermissions scopeId="scope-1" />)
    const rows = screen.getAllByRole('listitem')
    const button = rows[1].querySelector('button') as HTMLButtonElement
    expect(button.className).toContain('dg-btn')
    expect(button.className).toContain('dg-btn--ghost')
    fireEvent.click(button)

    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.queryByText('Browser click')).toBeNull()
    expect(toolApprovalStore.getState().scopeGrants['scope-1']?.browser_click).toBeUndefined()
    expect(pushUndo).toHaveBeenCalledTimes(1)
    const input = vi.mocked(pushUndo).mock.calls[0][0]
    expect(input.message).toBe('Dango will ask before “Browser click” again.')
    expect(input.group).toBe('other')

    await act(async () => {
      await input.undo()
    })
    const restored = screen.getAllByRole('listitem')
    expect(restored).toHaveLength(2)
    expect(restored[1].textContent).toContain('Browser click')
    expect(toolApprovalStore.getState().scopeGrants['scope-1']?.browser_click).toEqual(older)
  })

  it('a revoke that cannot be saved shows a toast and offers no undo', () => {
    grant('scope-1', older)
    render(<ScopePermissions scopeId="scope-1" />)
    vi.spyOn(toolApprovalStore.getState(), 'revokeScopeGrant').mockReturnValue(false)
    fireEvent.click(screen.getByRole('button', { name: 'Stop allowing' }))
    expect(addToast).toHaveBeenCalledWith(
      "Couldn't save this change. “Browser click” may be allowed again after Dango restarts. Free up some disk space and try again."
    )
    expect(pushUndo).not.toHaveBeenCalled()
  })

  it('a revoke that saves shows no error toast', () => {
    grant('scope-1', older)
    render(<ScopePermissions scopeId="scope-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop allowing' }))
    expect(addToast).not.toHaveBeenCalled()
  })

  it('undo keeps a grant the user made again meanwhile', async () => {
    grant('scope-1', older)
    render(<ScopePermissions scopeId="scope-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Stop allowing' }))
    const again = { ...older, riskTier: ToolRiskTier.HIGH, grantedAt: older.grantedAt + 1000 }
    act(() => grant('scope-1', again))
    const input = vi.mocked(pushUndo).mock.calls[0][0]
    await act(async () => {
      await input.undo()
    })
    expect(toolApprovalStore.getState().scopeGrants['scope-1']?.browser_click).toEqual(again)
  })

  it('renders the section for Everywhere like any scope', () => {
    grant(EVERYWHERE_SCOPE_ID, newer)
    render(<ScopePermissions scopeId={EVERYWHERE_SCOPE_ID} />)
    expect(screen.getByRole('heading', { name: 'Allowed without asking' })).toBeTruthy()
    expect(screen.getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('Read calendar')).toBeTruthy()
  })

  it('renders a tool name as plain text, never as markup', () => {
    grant('scope-1', { ...newer, toolName: '<b>evil</b>' })
    const { container } = render(<ScopePermissions scopeId="scope-1" />)
    expect(container.querySelector('b')).toBeNull()
    expect(screen.getByText('<b>evil</b>')).toBeTruthy()
  })

  it('omits the date caption for a grant with no recorded time', () => {
    grant('scope-1', { ...older, grantedAt: 0 })
    render(<ScopePermissions scopeId="scope-1" />)
    expect(screen.getByRole('listitem').textContent).not.toContain('Since')
  })
})
