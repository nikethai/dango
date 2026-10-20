// @vitest-environment jsdom

import { ToolRiskTier } from '@shared/types/mcp'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getScopeGrant, toolApprovalStore } from './toolApprovalStore'

const KEY = 'tool-approval-store'
const grant = { toolName: 'browser_click', riskTier: ToolRiskTier.MEDIUM, grantedAt: 1 }

async function settle() {
  for (let i = 0; i < 5; i++) await Promise.resolve()
}

afterEach(() => {
  vi.restoreAllMocks()
  localStorage.clear()
  toolApprovalStore.setState({ scopeGrants: {} })
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
