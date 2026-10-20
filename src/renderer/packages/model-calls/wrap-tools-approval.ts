import {
  fingerprintSensitiveToolArgs,
  isSensitiveToolName,
  redactSensitiveToolPayload,
} from '@shared/privacy/sensitive-tools'
import { ToolRiskTier } from '@shared/types/mcp'
import type { ToolSet } from 'ai'
import { alwaysAsks, canAlways, describeToolAction, requestToolPermission } from '@/packages/tool-permission'
import {
  getScopeGrant,
  getToolApproval,
  type ToolApprovalAuditEntry,
  toolApprovalStore,
} from '@/stores/toolApprovalStore'
import { getToolRiskTier } from '../tools/risk-engine'

const TOOL_EXECUTE_TIMEOUT_MS = 90_000

/** Sent to the model, not shown as UI copy. */
export const TOOL_REFUSAL_MESSAGE =
  'The user chose "Not now" for this action. Do not retry it. Tell the user in one sentence what you did not do and why.'

export function workspaceApprovalFingerprint(toolName: string, args: unknown): string | null {
  if (!isSensitiveToolName(toolName)) {
    return null
  }
  return fingerprintSensitiveToolArgs(toolName, args)
}

function createToolDeniedResult(toolName: string, riskTier: ToolRiskTier) {
  return {
    denied: true,
    toolName,
    riskTier,
    message: TOOL_REFUSAL_MESSAGE,
  }
}

/** The risk tier the user said "Always" for: the scope's grant when scoped, else this chat's session approval. */
function grantedRiskTier(sessionId: string, scopeId: string | undefined, toolName: string): ToolRiskTier | undefined {
  if (scopeId) return getScopeGrant(scopeId, toolName)?.riskTier
  const approval = getToolApproval(sessionId, toolName)
  return approval?.scope === 'session' ? approval.riskTier : undefined
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      }
    )
  })
}

/**
 * Shared approval gate. Per call: LOW tools that do not always ask run at once. Otherwise a grant with exactly the
 * same risk tier (the scope's grant when `scopeId` is set, else this chat's session approval) runs the call, unless the
 * tool always asks or the call is CRITICAL. Everything else asks through the permission sheet; the wait for an answer
 * is outside the execute timeout, and Stop (`abortSignal`) settles it as "Not now".
 */
export function wrapToolsWithApproval(
  sessionId: string | undefined,
  tools: ToolSet,
  opts: { scopeId?: string } = {}
): ToolSet {
  if (!sessionId) {
    return tools
  }
  const scopeId = opts.scopeId || undefined

  return Object.fromEntries(
    Object.entries(tools).map(([toolName, definition]) => {
      const riskTier = getToolRiskTier(toolName, definition?.description)
      const asksEveryTime = alwaysAsks(toolName)
      // R9: never Always, and never a grant, for tools that always ask or CRITICAL calls.
      const grantable = canAlways(toolName, riskTier) && riskTier !== ToolRiskTier.CRITICAL && !asksEveryTime

      return [
        toolName,
        {
          ...definition,
          execute: async (args: unknown, context) => {
            const fingerprint = workspaceApprovalFingerprint(toolName, args) ?? undefined
            const audit = (scope: ToolApprovalAuditEntry['scope'], decision: ToolApprovalAuditEntry['decision']) =>
              toolApprovalStore.getState().addAuditEntry({
                sessionId,
                toolName,
                riskTier,
                scope,
                decision,
                timestamp: Date.now(),
                args: redactSensitiveToolPayload(toolName, args),
                ...(fingerprint ? { argsFingerprint: fingerprint } : {}),
              })

            const grantedTier = grantable ? grantedRiskTier(sessionId, scopeId, toolName) : undefined

            if (riskTier === ToolRiskTier.LOW && !asksEveryTime) {
              audit('none', 'auto-approve')
            } else if (grantable && grantedTier === riskTier) {
              audit(scopeId ? 'scope' : 'session', 'auto-approve')
            } else {
              const choice = await requestToolPermission(
                {
                  sessionId,
                  scopeId,
                  toolName,
                  riskTier,
                  summary: describeToolAction(toolName, args, definition?.description),
                  allowAlways: grantable,
                },
                { signal: context?.abortSignal }
              )

              if (choice === 'deny') {
                audit('none', 'deny')
                return createToolDeniedResult(toolName, riskTier)
              }

              if (choice === 'always' && grantable) {
                const now = Date.now()
                if (scopeId) {
                  toolApprovalStore.getState().addScopeGrant(scopeId, { toolName, riskTier, grantedAt: now })
                  audit('scope', 'allow')
                } else {
                  toolApprovalStore.getState().addApproval(sessionId, {
                    toolName,
                    riskTier,
                    scope: 'session',
                    timestamp: now,
                  })
                  audit('session', 'allow')
                }
              } else {
                audit('once', 'allow')
              }
            }

            return await withTimeout(
              Promise.resolve(definition.execute?.(args, context)),
              TOOL_EXECUTE_TIMEOUT_MS,
              `Tool ${toolName}`
            )
          },
        },
      ]
    })
  ) as ToolSet
}
