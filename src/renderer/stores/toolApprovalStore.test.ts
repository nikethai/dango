// @vitest-environment jsdom

import { ToolRiskTier } from '@shared/types/mcp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AUDIT_LOG_LIMIT, getScopeGrant, type ToolApprovalAuditEntry, toolApprovalStore } from './toolApprovalStore'

const KEY = 'tool-approval-store'
const grant = { toolName: 'browser_click', riskTier: ToolRiskTier.MEDIUM, grantedAt: 1 }
const entry: ToolApprovalAuditEntry = {
  sessionId: 'session-1',
  toolName: 'browser_click',
  riskTier: ToolRiskTier.MEDIUM,
  scope: 'once',
  decision: 'allow',
  timestamp: 0,
}

function failWrites() {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('full', 'QuotaExceededError')
  })
}

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  toolApprovalStore.setState({ scopeGrants: {}, auditLog: [], approvedTools: new Map() })
})

describe('toolApprovalStore audit log', () => {
  it('keeps the newest 500 audit entries', () => {
    for (let i = 0; i < 510; i++) toolApprovalStore.getState().addAuditEntry({ ...entry, timestamp: i })
    const log = toolApprovalStore.getState().auditLog
    expect(log).toHaveLength(500)
    expect(log[0].timestamp).toBe(10)
  })

  it('caps the persisted audit log too', () => {
    for (let i = 0; i < 510; i++) toolApprovalStore.getState().addAuditEntry({ ...entry, timestamp: i })
    const persisted = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    expect(persisted.state.auditLog).toHaveLength(AUDIT_LOG_LIMIT)
    expect(persisted.state.auditLog[AUDIT_LOG_LIMIT - 1].timestamp).toBe(509)
  })
})

describe('toolApprovalStore write failures', () => {
  it('a revoke that cannot be saved says so', () => {
    toolApprovalStore.getState().addScopeGrant('scope-1', grant)
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError')
    })
    expect(toolApprovalStore.getState().revokeScopeGrant('scope-1', 'browser_click')).toBe(false)
  })

  it('a failed revoke still stops the grant in this window', () => {
    toolApprovalStore.getState().addScopeGrant('scope-1', grant)
    failWrites()
    toolApprovalStore.getState().revokeScopeGrant('scope-1', 'browser_click')
    expect(getScopeGrant('scope-1', 'browser_click')).toBeUndefined()
  })

  it('grants and approvals that save return true', () => {
    expect(toolApprovalStore.getState().addScopeGrant('scope-1', grant)).toBe(true)
    expect(
      toolApprovalStore
        .getState()
        .addApproval('session-1', { toolName: 'x', riskTier: ToolRiskTier.MEDIUM, scope: 'session', timestamp: 1 })
    ).toBe(true)
    expect(toolApprovalStore.getState().revokeScopeGrant('scope-1', 'browser_click')).toBe(true)
  })

  it('grants and approvals that cannot be saved return false and still apply in memory', () => {
    failWrites()
    expect(toolApprovalStore.getState().addScopeGrant('scope-1', grant)).toBe(false)
    expect(getScopeGrant('scope-1', 'browser_click')).toEqual(grant)
    expect(
      toolApprovalStore
        .getState()
        .addApproval('session-1', { toolName: 'x', riskTier: ToolRiskTier.MEDIUM, scope: 'session', timestamp: 1 })
    ).toBe(false)
    expect(toolApprovalStore.getState().approvedTools.get('session-1:x')).toBeDefined()
  })

  it('an earlier failure does not mark a later successful write as failed', () => {
    failWrites()
    toolApprovalStore.getState().addAuditEntry(entry)
    vi.restoreAllMocks()
    expect(toolApprovalStore.getState().addScopeGrant('scope-1', grant)).toBe(true)
  })
})

describe('toolApprovalStore across windows', () => {
  it('a revoke written by another window reaches this one through the storage event', async () => {
    toolApprovalStore.getState().addScopeGrant('scope-1', grant)
    expect(getScopeGrant('scope-1', 'browser_click')).toEqual(grant)

    // Another window revoked the grant and persisted its state.
    localStorage.setItem(
      KEY,
      JSON.stringify({ state: { auditLog: [], approvedTools: {}, scopeGrants: { 'scope-1': {} } }, version: 0 })
    )
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    await settle()

    expect(getScopeGrant('scope-1', 'browser_click')).toBeUndefined()
  })

  it('a grant written by another window reaches this one', async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { auditLog: [], approvedTools: {}, scopeGrants: { 'scope-2': { x: { ...grant, toolName: 'x' } } } },
        version: 0,
      })
    )
    window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    await settle()
    expect(getScopeGrant('scope-2', 'x')?.riskTier).toBe(ToolRiskTier.MEDIUM)
  })

  it('ignores storage events for other keys and rehydrates on a full clear (key null)', () => {
    const rehydrate = vi.spyOn(toolApprovalStore.persist, 'rehydrate')
    window.dispatchEvent(new StorageEvent('storage', { key: 'settings' }))
    expect(rehydrate).not.toHaveBeenCalled()
    window.dispatchEvent(new StorageEvent('storage', { key: null }))
    expect(rehydrate).toHaveBeenCalledTimes(1)
  })

  it('rehydrating does not write back (no echo between windows)', async () => {
    const payload = JSON.stringify({ state: { auditLog: [], approvedTools: {}, scopeGrants: {} }, version: 0 })
    localStorage.setItem(KEY, payload)
    const setItem = vi.spyOn(Storage.prototype, 'setItem')
    await toolApprovalStore.persist.rehydrate()
    expect(setItem).not.toHaveBeenCalled()
  })
})
