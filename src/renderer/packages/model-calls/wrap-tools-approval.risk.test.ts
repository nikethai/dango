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

  it('a HIGH scope grant runs an ordinary command without asking', async () => {
    const { execute, tool } = wrapped()
    await tool.execute({ command: 'npm run format' }, {})
    expect(requestToolPermissionMock).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
  })

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
})
