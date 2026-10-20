import { ToolRiskTier } from '@shared/types/mcp'
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

/**
 * "Always" for one tool in one scope. Applies only to calls with exactly this risk tier. `toolDescription` (optional,
 * absent on older grants) lets the scope list hide grants the gate ignores for tools that always ask.
 */
export type ScopeToolGrant = { toolName: string; riskTier: ToolRiskTier; grantedAt: number; toolDescription?: string }

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

const RISK_TIERS = new Set<unknown>(Object.values(ToolRiskTier))

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Keep only well-formed grants from a persisted payload; anything else is dropped. */
function sanitizeScopeGrants(raw: unknown): ScopeGrants {
  if (!isPlainObject(raw)) return {}
  const result: ScopeGrants = {}
  for (const [scopeId, tools] of Object.entries(raw)) {
    if (!isPlainObject(tools)) continue
    const kept: Record<string, ScopeToolGrant> = {}
    for (const [toolName, grant] of Object.entries(tools)) {
      if (!isPlainObject(grant) || typeof grant.toolName !== 'string' || !RISK_TIERS.has(grant.riskTier)) continue
      kept[toolName] = {
        toolName: grant.toolName,
        riskTier: grant.riskTier as ToolRiskTier,
        grantedAt: typeof grant.grantedAt === 'number' ? grant.grantedAt : 0,
        ...(typeof grant.toolDescription === 'string' ? { toolDescription: grant.toolDescription } : {}),
      }
    }
    if (Object.keys(kept).length > 0) result[scopeId] = kept
  }
  return result
}

const TOOL_APPROVAL_STORAGE_KEY = 'tool-approval-store'

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
      name: TOOL_APPROVAL_STORAGE_KEY,
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
        const scopeGrants = sanitizeScopeGrants(persisted?.scopeGrants)
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

/**
 * Each window (main, Quick Chat) keeps its own copy of this store. When another window writes `tool-approval-store`,
 * read it again so a revoked grant stops auto-approving here, and so this window's next write does not put the stale
 * grant back. The `storage` event never fires in the window that wrote, and rehydrating does not write (no migration
 * step), so windows do not echo each other. `key === null` means the whole localStorage was cleared.
 */
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('storage', (event) => {
    if (event.key === TOOL_APPROVAL_STORAGE_KEY || event.key === null) void toolApprovalStore.persist.rehydrate()
  })
}

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
