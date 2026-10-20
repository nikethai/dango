import { ToolRiskTier } from '@shared/types/mcp'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getToolApprovalMock = vi.hoisted(() => vi.fn())
const getScopeGrantMock = vi.hoisted(() => vi.fn())
const addAuditEntryMock = vi.hoisted(() => vi.fn())
const addApprovalMock = vi.hoisted(() => vi.fn())
const addScopeGrantMock = vi.hoisted(() => vi.fn())
const removeApprovalMock = vi.hoisted(() => vi.fn())
const requestToolPermissionMock = vi.hoisted(() => vi.fn())

vi.mock('@/stores/toolApprovalStore', () => ({
  getToolApproval: getToolApprovalMock,
  getScopeGrant: getScopeGrantMock,
  toolApprovalStore: {
    getState: () => ({
      addAuditEntry: addAuditEntryMock,
      addApproval: addApprovalMock,
      addScopeGrant: addScopeGrantMock,
      removeApproval: removeApprovalMock,
    }),
  },
}))

vi.mock('@/packages/tool-permission', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/tool-permission')>()),
  requestToolPermission: requestToolPermissionMock,
}))

vi.mock('../tools/risk-engine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../tools/risk-engine')>()),
  getToolRiskTier: (name: string, _description?: string, args?: unknown) => {
    const text = JSON.stringify(args ?? '')
    if (text.includes('-rf') || text.includes('.ssh')) return ToolRiskTier.CRITICAL
    if (name === 'run_command') return ToolRiskTier.HIGH
    if (name === 'read_text') return ToolRiskTier.LOW
    if (name === 'delete_file' || name === 'edit_file' || name === 'create_file') return ToolRiskTier.HIGH
    if (name === 'browser_click') return ToolRiskTier.HIGH
    if (name === 'wipe_disk_now') return ToolRiskTier.CRITICAL
    if (name === 'web_search') return ToolRiskTier.LOW
    return ToolRiskTier.MEDIUM
  },
}))

vi.mock('i18next', () => ({
  t: (s: string) => s,
}))

import { workspaceApprovalFingerprint, wrapToolsWithApproval } from './wrap-tools-approval'

type Exec = { execute: (a: unknown, c: unknown) => Promise<{ denied?: boolean; message?: string } | unknown> }

const REFUSAL =
  'The user chose "Not now" for this action. Do not retry it. Tell the user in one sentence what you did not do and why.'

describe('wrapToolsWithApproval shipped wrapper', () => {
  beforeEach(() => {
    getToolApprovalMock.mockReset()
    getScopeGrantMock.mockReset()
    addAuditEntryMock.mockReset()
    addApprovalMock.mockReset()
    addScopeGrantMock.mockReset()
    removeApprovalMock.mockReset()
    requestToolPermissionMock.mockReset()
  })

  it('never session-auto-approves delete_file even with a session HIGH approval', async () => {
    getToolApprovalMock.mockReturnValue({
      toolName: 'delete_file',
      riskTier: ToolRiskTier.HIGH,
      scope: 'session',
      timestamp: 1,
      argsFingerprint: workspaceApprovalFingerprint('delete_file', { path: 'a.txt' }),
    })
    const execute = vi.fn(async () => ({ ok: true }))
    const wrapped = wrapToolsWithApproval('sess-1', {
      delete_file: { description: 'delete a file', execute },
    } as never)
    requestToolPermissionMock.mockResolvedValue('deny')
    const result = (await (wrapped.delete_file as Exec).execute({ path: 'a.txt', expected_revision: 'r' }, {})) as {
      denied?: boolean
    }
    expect(execute).not.toHaveBeenCalled()
    expect(result.denied).toBe(true)
    expect(requestToolPermissionMock).toHaveBeenCalled()
  })

  it('a sensitive tool asks again when its args change', async () => {
    getToolApprovalMock.mockReturnValue(undefined)
    const execute = vi.fn(async () => ({ ok: true }))
    const wrapped = wrapToolsWithApproval('sess-1', {
      edit_file: { description: 'edit a file', execute },
    } as never)
    requestToolPermissionMock.mockResolvedValue('once')
    const args = { path: 'a.txt', old_string: 'a', new_string: 'b', expected_revision: 'r1' }
    await (wrapped.edit_file as Exec).execute(args, {})
    await (wrapped.edit_file as Exec).execute({ ...args, new_string: 'c' }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(2)
    expect(execute).toHaveBeenCalledTimes(2)
    expect(addApprovalMock).not.toHaveBeenCalled()
    expect(addScopeGrantMock).not.toHaveBeenCalled()
    expect(addAuditEntryMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ argsFingerprint: workspaceApprovalFingerprint('edit_file', args) })
    )
  })

  it('stores metadata-only audit args without file content', async () => {
    getToolApprovalMock.mockReturnValue(undefined)
    const execute = vi.fn(async () => ({ ok: true }))
    const wrapped = wrapToolsWithApproval('sess-1', {
      create_file: { description: 'create a file', execute },
    } as never)
    requestToolPermissionMock.mockResolvedValue('once')
    const sentinel = 'SECRET_SENTINEL_BYTES_9f3a'
    await (wrapped.create_file as Exec).execute({ path: 'a.txt', content: sentinel }, {})
    const auditArgs = addAuditEntryMock.mock.calls[0]?.[0]?.args
    expect(JSON.stringify(auditArgs)).not.toContain(sentinel)
    expect(auditArgs.redacted).toBe(true)
    expect(JSON.stringify(requestToolPermissionMock.mock.calls[0]?.[0]?.summary)).not.toContain(sentinel)
  })

  it('auto-approves LOW tools without a request', async () => {
    getToolApprovalMock.mockReturnValue(undefined)
    const execute = vi.fn(async () => ({ hits: [] }))
    const wrapped = wrapToolsWithApproval('sess-1', {
      web_search: { description: 'search the web', execute },
    } as never)
    await (wrapped.web_search as Exec).execute({ q: 'x' }, {})
    expect(requestToolPermissionMock).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalled()
  })

  it('scope grant auto-approves in the same scope', async () => {
    getScopeGrantMock.mockImplementation((scopeId: string, toolName: string) =>
      scopeId === 's1' && toolName === 'browser_click'
        ? { toolName: 'browser_click', riskTier: ToolRiskTier.HIGH, grantedAt: 1 }
        : undefined
    )
    requestToolPermissionMock.mockResolvedValue('once')
    const execute = vi.fn(async () => ({ ok: true }))
    const tools = { browser_click: { description: 'click', execute } } as never

    await (wrapToolsWithApproval('sess-1', tools, { scopeId: 's1' }).browser_click as Exec).execute({ x: 1 }, {})
    expect(requestToolPermissionMock).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)
    expect(addAuditEntryMock).toHaveBeenCalledWith(
      expect.objectContaining({ decision: 'auto-approve', scope: 'scope' })
    )

    await (wrapToolsWithApproval('sess-1', tools, { scopeId: 's2' }).browser_click as Exec).execute({ x: 1 }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ sessionId: 'sess-1', scopeId: 's2', toolName: 'browser_click', allowAlways: true })
    )
  })

  it('grant does not cover a riskier tier', async () => {
    getScopeGrantMock.mockReturnValue({ toolName: 'browser_click', riskTier: ToolRiskTier.MEDIUM, grantedAt: 1 })
    requestToolPermissionMock.mockResolvedValue('once')
    const execute = vi.fn(async () => ({ ok: true }))
    const wrapped = wrapToolsWithApproval('sess-1', { browser_click: { description: 'click', execute } } as never, {
      scopeId: 's1',
    })
    await (wrapped.browser_click as Exec).execute({}, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ riskTier: ToolRiskTier.HIGH })
    )
  })

  it('a session approval does not cover a riskier tier either', async () => {
    getToolApprovalMock.mockReturnValue({
      toolName: 'browser_click',
      riskTier: ToolRiskTier.MEDIUM,
      scope: 'session',
      timestamp: 1,
    })
    requestToolPermissionMock.mockResolvedValue('once')
    const execute = vi.fn(async () => ({ ok: true }))
    const wrapped = wrapToolsWithApproval('sess-1', { browser_click: { description: 'click', execute } } as never)
    await (wrapped.browser_click as Exec).execute({}, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
  })

  it('always in a scope stores a scope grant', async () => {
    requestToolPermissionMock.mockResolvedValue('always')
    const execute = vi.fn(async () => ({ ok: true }))
    const tools = { browser_click: { description: 'click', execute } } as never

    await (wrapToolsWithApproval('sess-1', tools, { scopeId: 's1' }).browser_click as Exec).execute({}, {})
    expect(addScopeGrantMock).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({ toolName: 'browser_click', riskTier: ToolRiskTier.HIGH })
    )
    expect(addApprovalMock).not.toHaveBeenCalled()

    addScopeGrantMock.mockClear()
    await (wrapToolsWithApproval('sess-1', tools).browser_click as Exec).execute({}, {})
    expect(addApprovalMock).toHaveBeenCalledWith(
      'sess-1',
      expect.objectContaining({ toolName: 'browser_click', riskTier: ToolRiskTier.HIGH, scope: 'session' })
    )
    expect(addScopeGrantMock).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(2)
  })

  it('delete never offers always', async () => {
    getScopeGrantMock.mockReturnValue({ toolName: 'delete_file', riskTier: ToolRiskTier.HIGH, grantedAt: 1 })
    requestToolPermissionMock.mockResolvedValue('always')
    const execute = vi.fn(async () => ({ ok: true }))
    const wrapped = wrapToolsWithApproval('sess-1', { delete_file: { description: 'delete', execute } } as never, {
      scopeId: 's1',
    })
    await (wrapped.delete_file as Exec).execute({ path: 'a.txt' }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ allowAlways: false }))
    // Even if 'always' came back, nothing is stored for a tool that always asks.
    expect(addScopeGrantMock).not.toHaveBeenCalled()
    expect(addApprovalMock).not.toHaveBeenCalled()
  })

  it('never auto-approves a CRITICAL call even with a matching grant', async () => {
    getScopeGrantMock.mockReturnValue({ toolName: 'wipe_disk_now', riskTier: ToolRiskTier.CRITICAL, grantedAt: 1 })
    getToolApprovalMock.mockReturnValue({
      toolName: 'wipe_disk_now',
      riskTier: ToolRiskTier.CRITICAL,
      scope: 'session',
      timestamp: 1,
    })
    requestToolPermissionMock.mockResolvedValue('deny')
    const execute = vi.fn(async () => ({ ok: true }))
    const tools = { wipe_disk_now: { description: 'x', execute } } as never
    await (wrapToolsWithApproval('sess-1', tools).wipe_disk_now as Exec).execute({}, {})
    const wrapped = wrapToolsWithApproval('sess-1', tools, { scopeId: 's1' })
    await (wrapped.wipe_disk_now as Exec).execute({}, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(2)
    expect(requestToolPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ allowAlways: false, riskTier: ToolRiskTier.CRITICAL }),
      expect.anything()
    )
    expect(execute).not.toHaveBeenCalled()
  })

  it('passes the abort signal so Stop settles the request', async () => {
    requestToolPermissionMock.mockResolvedValue('deny')
    const controller = new AbortController()
    const wrapped = wrapToolsWithApproval('sess-1', {
      browser_click: { description: 'click', execute: vi.fn() },
    } as never)
    await (wrapped.browser_click as Exec).execute({}, { abortSignal: controller.signal })
    expect(requestToolPermissionMock.mock.calls[0]?.[1]).toEqual({ signal: controller.signal })
  })

  it('refusal is a sentence', async () => {
    requestToolPermissionMock.mockResolvedValue('deny')
    const execute = vi.fn(async () => ({ ok: true }))
    const wrapped = wrapToolsWithApproval('sess-1', { browser_click: { description: 'click', execute } } as never)
    const result = await (wrapped.browser_click as Exec).execute({}, {})
    expect(result).toEqual({ denied: true, toolName: 'browser_click', riskTier: ToolRiskTier.HIGH, message: REFUSAL })
    expect(execute).not.toHaveBeenCalled()
    expect(addAuditEntryMock).toHaveBeenCalledWith(expect.objectContaining({ decision: 'deny', scope: 'none' }))
  })

  it('grant does not cover a call whose args raise the tier', async () => {
    getScopeGrantMock.mockReturnValue({ toolName: 'browser_click', riskTier: ToolRiskTier.HIGH, grantedAt: 1 })
    requestToolPermissionMock.mockResolvedValue('always')
    const execute = vi.fn(async () => ({ ok: true }))
    const wrapped = wrapToolsWithApproval('sess-1', { browser_click: { description: 'click', execute } } as never, {
      scopeId: 's1',
    })

    await (wrapped.browser_click as Exec).execute({ selector: '#ok' }, {})
    expect(requestToolPermissionMock).not.toHaveBeenCalled()
    expect(execute).toHaveBeenCalledTimes(1)

    requestToolPermissionMock.mockResolvedValue('deny')
    const denied = await (wrapped.browser_click as Exec).execute({ selector: '-rf' }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ toolName: 'browser_click', riskTier: ToolRiskTier.CRITICAL, allowAlways: false })
    )
    expect(denied).toEqual(expect.objectContaining({ denied: true, riskTier: ToolRiskTier.CRITICAL }))
    expect(execute).toHaveBeenCalledTimes(1)

    requestToolPermissionMock.mockResolvedValue('always')
    await (wrapped.browser_click as Exec).execute({ selector: '-rf' }, {})
    expect(execute).toHaveBeenCalledTimes(2)
    // 'always' on a CRITICAL call is only once: nothing is stored.
    expect(addScopeGrantMock).not.toHaveBeenCalled()
  })

  it.each([
    ['run_command', 'run'],
    ['terminal_exec', 'Terminal tools'],
    ['mcp_tool', 'Run a shell command'],
    ['run_local_code', 'Runs local code'],
  ])('%s always asks: no Always, existing grants ignored, Always answers store nothing', async (name, description) => {
    getScopeGrantMock.mockImplementation((_scopeId: string, toolName: string) => ({
      toolName,
      riskTier: name === 'run_command' ? ToolRiskTier.HIGH : ToolRiskTier.MEDIUM,
      grantedAt: 1,
    }))
    getToolApprovalMock.mockImplementation((_sessionId: string, toolName: string) => ({
      toolName,
      riskTier: name === 'run_command' ? ToolRiskTier.HIGH : ToolRiskTier.MEDIUM,
      scope: 'session',
      timestamp: 1,
    }))
    requestToolPermissionMock.mockResolvedValue('always')
    const execute = vi.fn(async () => ({ ok: true }))
    for (const opts of [{ scopeId: 's1' }, {}]) {
      requestToolPermissionMock.mockClear()
      const wrapped = wrapToolsWithApproval('sess-1', { [name]: { description, execute } } as never, opts)
      await (wrapped[name] as Exec).execute({ command: 'npm install' }, {})
      expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
      expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(
        expect.objectContaining({ toolName: name, allowAlways: false, toolDescription: description })
      )
    }
    expect(execute).toHaveBeenCalledTimes(2)
    expect(addScopeGrantMock).not.toHaveBeenCalled()
    expect(addApprovalMock).not.toHaveBeenCalled()
  })

  it('a read-only look-alike (list_commands) keeps Always', async () => {
    requestToolPermissionMock.mockResolvedValue('always')
    const execute = vi.fn(async () => ({ ok: true }))
    const wrapped = wrapToolsWithApproval(
      'sess-1',
      { list_commands: { description: 'Lists the slash commands this server offers.', execute } } as never,
      { scopeId: 's1' }
    )
    await (wrapped.list_commands as Exec).execute({}, {})
    expect(requestToolPermissionMock.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ allowAlways: true }))
    expect(addScopeGrantMock).toHaveBeenCalledTimes(1)
    expect(addScopeGrantMock).toHaveBeenCalledWith(
      's1',
      expect.objectContaining({
        toolName: 'list_commands',
        toolDescription: 'Lists the slash commands this server offers.',
      })
    )
  })

  it('a LOW-by-name tool with a dangerous path arg is not auto-approved', async () => {
    requestToolPermissionMock.mockResolvedValue('deny')
    const execute = vi.fn(async () => ({ text: '' }))
    const wrapped = wrapToolsWithApproval('sess-1', { read_text: { description: 'read', execute } } as never)
    await (wrapped.read_text as Exec).execute({ path: 'notes.txt' }, {})
    expect(requestToolPermissionMock).not.toHaveBeenCalled()
    await (wrapped.read_text as Exec).execute({ path: '~/.ssh/id_rsa' }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledWith(
      expect.objectContaining({ riskTier: ToolRiskTier.CRITICAL, allowAlways: false }),
      expect.anything()
    )
    expect(execute).toHaveBeenCalledTimes(1)
  })

  it('Stop is not audited as a refusal and returns a stopped result', async () => {
    const controller = new AbortController()
    requestToolPermissionMock.mockImplementation(() => {
      controller.abort()
      return Promise.resolve('deny')
    })
    const execute = vi.fn(async () => ({ ok: true }))
    const wrapped = wrapToolsWithApproval('sess-1', { browser_click: { description: 'click', execute } } as never)
    const result = (await (wrapped.browser_click as Exec).execute({}, { abortSignal: controller.signal })) as {
      denied?: boolean
      stopped?: boolean
      message?: string
    }
    expect(execute).not.toHaveBeenCalled()
    expect(result.stopped).toBe(true)
    expect(result.message).not.toBe(REFUSAL)
    expect(addAuditEntryMock).not.toHaveBeenCalledWith(expect.objectContaining({ decision: 'deny' }))
  })
})

describe('toolApprovalStore merge', () => {
  it('hydrates scopeGrants to {} from a payload without it; revokeScopeGrant removes only that tool', async () => {
    const actual = await vi.importActual<typeof import('@/stores/toolApprovalStore')>('@/stores/toolApprovalStore')
    const { toolApprovalStore } = actual
    const options = toolApprovalStore.persist.getOptions()
    const oldPayload = {
      auditLog: [],
      approvedTools: {
        'sess-1:browser_click': {
          toolName: 'browser_click',
          riskTier: ToolRiskTier.HIGH,
          scope: 'session',
          timestamp: 1,
        },
      },
    }
    const merged = options.merge?.(oldPayload, toolApprovalStore.getState()) as ReturnType<
      typeof toolApprovalStore.getState
    >
    expect(merged.scopeGrants).toEqual({})
    expect(merged.approvedTools.get('sess-1:browser_click')?.scope).toBe('session')

    const state = toolApprovalStore.getState()
    state.addScopeGrant('s1', { toolName: 'browser_click', riskTier: ToolRiskTier.HIGH, grantedAt: 1 })
    state.addScopeGrant('s1', { toolName: 'browser_type', riskTier: ToolRiskTier.MEDIUM, grantedAt: 2 })
    state.addScopeGrant('s2', { toolName: 'browser_click', riskTier: ToolRiskTier.HIGH, grantedAt: 3 })
    toolApprovalStore.getState().revokeScopeGrant('s1', 'browser_click')
    expect(actual.getScopeGrant('s1', 'browser_click')).toBeUndefined()
    expect(actual.getScopeGrant('s1', 'browser_type')?.riskTier).toBe(ToolRiskTier.MEDIUM)
    expect(actual.getScopeGrant('s2', 'browser_click')?.riskTier).toBe(ToolRiskTier.HIGH)

    const persisted = options.partialize?.(toolApprovalStore.getState()) as { scopeGrants?: unknown }
    expect(persisted.scopeGrants).toEqual(toolApprovalStore.getState().scopeGrants)
    const roundTrip = options.merge?.(
      JSON.parse(JSON.stringify(persisted)),
      toolApprovalStore.getState()
    ) as ReturnType<typeof toolApprovalStore.getState>
    expect(roundTrip.scopeGrants.s1.browser_type.grantedAt).toBe(2)
  })

  it('drops malformed scopeGrants entries on merge', async () => {
    const { toolApprovalStore } =
      await vi.importActual<typeof import('@/stores/toolApprovalStore')>('@/stores/toolApprovalStore')
    const merge = toolApprovalStore.persist.getOptions().merge
    const state = toolApprovalStore.getState()
    const asArray = merge?.({ scopeGrants: [1, 2] }, state) as ReturnType<typeof toolApprovalStore.getState>
    expect(asArray.scopeGrants).toEqual({})
    const junk = merge?.(
      {
        scopeGrants: {
          s1: {
            ok: { toolName: 'ok', riskTier: ToolRiskTier.HIGH, grantedAt: 5 },
            noName: { riskTier: ToolRiskTier.HIGH, grantedAt: 1 },
            badTier: { toolName: 'badTier', riskTier: 7, grantedAt: 1 },
            str: 'x',
          },
          s2: 'nope',
          s3: [],
        },
      },
      state
    ) as ReturnType<typeof toolApprovalStore.getState>
    expect(junk.scopeGrants).toEqual({ s1: { ok: { toolName: 'ok', riskTier: ToolRiskTier.HIGH, grantedAt: 5 } } })
  })
})
