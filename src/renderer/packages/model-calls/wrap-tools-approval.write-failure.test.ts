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
})
