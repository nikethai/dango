// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The real store and risk engine; only the prompt, toast and i18n are mocked.
const requestToolPermissionMock = vi.hoisted(() => vi.fn())
const addToastMock = vi.hoisted(() => vi.fn())

vi.mock('@/packages/tool-permission', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/packages/tool-permission')>()),
  requestToolPermission: requestToolPermissionMock,
}))
vi.mock('@/stores/toastActions', () => ({ add: addToastMock }))
vi.mock('i18next', () => ({
  t: (key: string, vars?: Record<string, unknown>) =>
    key.replace(/\{\{(\w+)\}\}/g, (_, name) => String(vars?.[name] ?? name)),
}))

import { ToolRiskTier } from '@shared/types/mcp'
import { getScopeGrant, getToolApproval, toolApprovalStore } from '@/stores/toolApprovalStore'
import { wrapToolsWithApproval } from './wrap-tools-approval'

type Exec = { execute: (a: unknown, c: unknown) => Promise<unknown> }
const KEY = 'tool-approval-store'

function failWrites() {
  return vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError')
  })
}

function persistedState() {
  return JSON.parse(localStorage.getItem(KEY) ?? '{"state":{}}').state
}

beforeEach(() => {
  requestToolPermissionMock.mockReset()
  requestToolPermissionMock.mockResolvedValue('always')
  addToastMock.mockReset()
  toolApprovalStore.setState({ scopeGrants: {}, auditLog: [], approvedTools: new Map() })
})

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
})

const tools = () => ({ browser_click: { description: 'click', execute: vi.fn(async () => ({ ok: true })) } }) as never

describe('a failed Always grant really asks again', () => {
  it('in a scope: the next call asks, and a later successful write does not save the grant', async () => {
    const wrapped = wrapToolsWithApproval('sess-1', tools(), { scopeId: 's1' })
    failWrites()
    await (wrapped.browser_click as Exec).execute({}, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(getScopeGrant('s1', 'browser_click')).toBeUndefined()

    vi.restoreAllMocks()
    requestToolPermissionMock.mockResolvedValue('once')
    await (wrapped.browser_click as Exec).execute({}, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(2)
    expect(persistedState().scopeGrants?.s1?.browser_click).toBeUndefined()
    await vi.waitFor(() => expect(addToastMock).toHaveBeenCalledTimes(1))
  })

  it('in a scope: an older grant is kept as it was', async () => {
    const older = { toolName: 'browser_click', riskTier: ToolRiskTier.LOW, grantedAt: 1 }
    toolApprovalStore.getState().addScopeGrant('s1', older)
    failWrites()
    await (wrapToolsWithApproval('sess-1', tools(), { scopeId: 's1' }).browser_click as Exec).execute({}, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(getScopeGrant('s1', 'browser_click')).toEqual(older)
  })

  it('in a session: the next call asks, and a later successful write does not save the approval', async () => {
    const wrapped = wrapToolsWithApproval('sess-1', tools())
    failWrites()
    await (wrapped.browser_click as Exec).execute({}, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(getToolApproval('sess-1', 'browser_click')).toBeUndefined()

    vi.restoreAllMocks()
    requestToolPermissionMock.mockResolvedValue('once')
    await (wrapped.browser_click as Exec).execute({}, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(2)
    expect(persistedState().approvedTools?.['sess-1:browser_click']).toBeUndefined()
  })

  it('audits a grant that was not saved as allowed once, in a scope or a session', async () => {
    failWrites()
    await (wrapToolsWithApproval('sess-1', tools(), { scopeId: 's1' }).browser_click as Exec).execute({}, {})
    await (wrapToolsWithApproval('sess-1', tools()).browser_click as Exec).execute({}, {})
    const entries = toolApprovalStore.getState().auditLog.filter((e) => e.toolName === 'browser_click')
    expect(entries.map((e) => [e.scope, e.decision])).toEqual([
      ['once', 'allow'],
      ['once', 'allow'],
    ])
  })

  it('audits a saved grant by where it was saved', async () => {
    await (wrapToolsWithApproval('sess-1', tools(), { scopeId: 's1' }).browser_click as Exec).execute({}, {})
    await (wrapToolsWithApproval('sess-2', tools()).browser_click as Exec).execute({}, {})
    const entries = toolApprovalStore.getState().auditLog.filter((e) => e.toolName === 'browser_click')
    expect(entries.map((e) => [e.scope, e.decision])).toEqual([
      ['scope', 'allow'],
      ['session', 'allow'],
    ])
  })
})

describe('a failed read-only command grant really asks again', () => {
  const NAME = 'mcp__shell__run_command'
  const shell = () =>
    ({ [NAME]: { description: 'Run a shell command', execute: vi.fn(async () => ({ ok: true })) } }) as never

  it('in a scope: the next read-only command asks, and a later successful write does not save the grant', async () => {
    const wrapped = wrapToolsWithApproval('sess-1', shell(), { scopeId: 's1' })
    failWrites()
    await (wrapped[NAME] as Exec).execute({ command: 'ls -la' }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(1)
    expect(getScopeGrant('s1', NAME)).toBeUndefined()

    vi.restoreAllMocks()
    requestToolPermissionMock.mockResolvedValue('once')
    await (wrapped[NAME] as Exec).execute({ command: 'git status' }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(2)
    expect(persistedState().scopeGrants?.s1?.[NAME]).toBeUndefined()
  })

  it('in a scope: an older read-only grant is kept as it was', async () => {
    const older = { toolName: NAME, riskTier: ToolRiskTier.MEDIUM, grantedAt: 1, readOnlyCommands: true }
    toolApprovalStore.getState().addScopeGrant('s2', older)
    failWrites()
    await (wrapToolsWithApproval('sess-1', shell(), { scopeId: 's1' })[NAME] as Exec).execute({ command: 'ls' }, {})
    expect(getScopeGrant('s1', NAME)).toBeUndefined()
    expect(getScopeGrant('s2', NAME)).toEqual(older)
  })

  it('in a session: the next read-only command asks', async () => {
    const wrapped = wrapToolsWithApproval('sess-1', shell())
    failWrites()
    await (wrapped[NAME] as Exec).execute({ command: 'ls -la' }, {})
    expect(getToolApproval('sess-1', NAME)).toBeUndefined()

    vi.restoreAllMocks()
    requestToolPermissionMock.mockResolvedValue('once')
    await (wrapped[NAME] as Exec).execute({ command: 'ls -la' }, {})
    expect(requestToolPermissionMock).toHaveBeenCalledTimes(2)
  })

  it('a saved read-only grant is persisted with its marker and survives a reload', async () => {
    await (wrapToolsWithApproval('sess-1', shell(), { scopeId: 's1' })[NAME] as Exec).execute({ command: 'ls' }, {})
    expect(persistedState().scopeGrants?.s1?.[NAME]).toEqual(expect.objectContaining({ readOnlyCommands: true }))
    const saved = localStorage.getItem(KEY) ?? ''
    toolApprovalStore.setState({ scopeGrants: {} })
    localStorage.setItem(KEY, saved)
    await toolApprovalStore.persist.rehydrate()
    expect(getScopeGrant('s1', NAME)).toEqual(expect.objectContaining({ readOnlyCommands: true }))
  })
})
