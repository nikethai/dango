import type { ToolRiskTier } from '@shared/types/mcp'
import { useMemo } from 'react'
import { createStore, useStore } from 'zustand'
import { combine, persist } from 'zustand/middleware'
import { safeStorage } from './safeStorage'

export type ToolApprovalScope = 'once' | 'session' | 'scope'
export type ToolApprovalAuditDecision = 'allow' | 'deny' | 'auto-approve'

export type ToolApprovalRecord = {
  toolName: string
  riskTier: ToolRiskTier
  scope: ToolApprovalScope
  timestamp: number
  /** Concrete invocation fingerprint; required for workspace mutations. */
  argsFingerprint?: string
}

/** "Always" for one tool in one scope. Applies only to calls with exactly this risk tier. */
export type ScopeToolGrant = { toolName: string; riskTier: ToolRiskTier; grantedAt: number }

/** scopeId → toolName → grant. */
export type ScopeGrants = Record<string, Record<string, ScopeToolGrant>>

export type ToolApprovalAuditEntry = {
  sessionId: string
  toolName: string
  riskTier: ToolRiskTier
  scope: ToolApprovalScope | 'none'
  decision: ToolApprovalAuditDecision
  timestamp: number
  args?: unknown
  /** Concrete invocation fingerprint of a workspace mutation (audit only; never used to approve). */
  argsFingerprint?: string
}

type ToolApprovalState = {
  approvedTools: Map<string, ToolApprovalRecord>
  auditLog: ToolApprovalAuditEntry[]
  scopeGrants: ScopeGrants
  addApproval: (sessionId: string, approval: ToolApprovalRecord) => void
  removeApproval: (sessionId: string, toolName: string) => void
  clearSessionApprovals: (sessionId: string) => void
  addAuditEntry: (entry: ToolApprovalAuditEntry) => void
  addScopeGrant: (scopeId: string, grant: ScopeToolGrant) => void
  revokeScopeGrant: (scopeId: string, toolName: string) => void
}

function getApprovalKey(sessionId: string, toolName: string) {
  return `${sessionId}:${toolName}`
}

function serializeMap(map: Map<string, ToolApprovalRecord>): Record<string, ToolApprovalRecord> {
  const obj: Record<string, ToolApprovalRecord> = {}
  map.forEach((value, key) => {
    obj[key] = value
  })
  return obj
}

function deserializeMap(obj: Record<string, ToolApprovalRecord>): Map<string, ToolApprovalRecord> {
  return new Map(Object.entries(obj))
}

export const toolApprovalStore = createStore<ToolApprovalState>()(
  persist(
    combine(
      {
        approvedTools: new Map<string, ToolApprovalRecord>(),
        auditLog: [] as ToolApprovalAuditEntry[],
        scopeGrants: {} as ScopeGrants,
      },
      (set, _get) => ({
        addApproval: (sessionId: string, approval: ToolApprovalRecord) =>
          set((state) => {
            const approvedTools = new Map(state.approvedTools)
            approvedTools.set(getApprovalKey(sessionId, approval.toolName), approval)
            return { approvedTools }
          }),
        removeApproval: (sessionId: string, toolName: string) =>
          set((state) => {
            const approvedTools = new Map(state.approvedTools)
            approvedTools.delete(getApprovalKey(sessionId, toolName))
            return { approvedTools }
          }),
        clearSessionApprovals: (sessionId: string) =>
          set((state) => {
            const approvedTools = new Map(state.approvedTools)
            for (const key of approvedTools.keys()) {
              if (key.startsWith(`${sessionId}:`)) {
                approvedTools.delete(key)
              }
            }
            return { approvedTools }
          }),
        addAuditEntry: (entry: ToolApprovalAuditEntry) =>
          set((state) => ({
            auditLog: [...state.auditLog, entry],
          })),
        addScopeGrant: (scopeId: string, grant: ScopeToolGrant) =>
          set((state) => ({
            scopeGrants: {
              ...state.scopeGrants,
              [scopeId]: { ...state.scopeGrants[scopeId], [grant.toolName]: grant },
            },
          })),
        revokeScopeGrant: (scopeId: string, toolName: string) =>
          set((state) => {
            const current = state.scopeGrants[scopeId]
            if (!current?.[toolName]) return {}
            const { [toolName]: _removed, ...rest } = current
            return { scopeGrants: { ...state.scopeGrants, [scopeId]: rest } }
          }),
      })
    ),
    {
      name: 'tool-approval-store',
      version: 0,
      partialize: (state) => ({
        auditLog: state.auditLog,
        approvedTools: serializeMap(state.approvedTools),
        scopeGrants: state.scopeGrants,
      }),
      merge: (persistedState: unknown, currentState) => {
        // Payloads written before scope grants existed have no `scopeGrants`; they load as {} (no migration step).
        const persisted = persistedState as
          | { approvedTools?: Record<string, ToolApprovalRecord>; scopeGrants?: ScopeGrants }
          | undefined
        const scopeGrants =
          persisted?.scopeGrants && typeof persisted.scopeGrants === 'object' ? persisted.scopeGrants : {}
        return {
          ...currentState,
          ...(persisted?.approvedTools ? { approvedTools: deserializeMap(persisted.approvedTools) } : {}),
          scopeGrants,
        }
      },
      storage: safeStorage,
    }
  )
)

export function getToolApproval(sessionId: string, toolName: string) {
  return toolApprovalStore.getState().approvedTools.get(getApprovalKey(sessionId, toolName))
}

export function useToolApprovalStore<U>(selector: (state: ToolApprovalState) => U) {
  return useStore(toolApprovalStore, selector)
}

export function getScopeGrant(scopeId: string, toolName: string): ScopeToolGrant | undefined {
  return toolApprovalStore.getState().scopeGrants[scopeId]?.[toolName]
}

/** The scope's grants, newest first. */
export function useScopeGrants(scopeId: string): ScopeToolGrant[] {
  const grants = useStore(toolApprovalStore, (state) => state.scopeGrants[scopeId])
  return useMemo(() => Object.values(grants ?? {}).sort((a, b) => b.grantedAt - a.grantedAt), [grants])
}
