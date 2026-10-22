import {
  fingerprintSensitiveToolArgs,
  isSensitiveToolName,
  redactSensitiveToolPayload,
} from '@shared/privacy/sensitive-tools'
import { ToolRiskTier } from '@shared/types/mcp'
import type { ToolSet } from 'ai'
import { t } from 'i18next'
import {
  alwaysAsks,
  canAlways,
  describeToolAction,
  offersReadOnlyCommandGrant,
  requestToolPermission,
  toolLabel,
} from '@/packages/tool-permission'
import {
  getScopeGrant,
  getToolApproval,
  type ToolApprovalAuditEntry,
  toolApprovalStore,
} from '@/stores/toolApprovalStore'
import { getToolRiskTier, isReadOnlyCommand, readOnlyProseIsPlain, secretPathIn } from '../tools/risk-engine'

const TOOL_EXECUTE_TIMEOUT_MS = 90_000

/** The Always choice applies to this call, but it was not saved; tell the user it will ask again. */
function notifyAlwaysNotSaved(toolName: string) {
  const message = t("Couldn't save “Always” for {{label}}. Dango will ask again next time.", {
    label: toolLabel(toolName),
  })
  // Dynamic import: toastActions pulls in the UI store, which this module's callers may not load.
  void import('@/stores/toastActions').then(({ add }) => add(message)).catch(() => undefined)
}

/** Sent to the model, not shown as UI copy. */
export const TOOL_REFUSAL_MESSAGE =
  'The user chose "Not now" for this action. Do not retry it. Tell the user in one sentence what you did not do and why.'

export function workspaceApprovalFingerprint(toolName: string, args: unknown): string | null {
  if (!isSensitiveToolName(toolName)) {
    return null
  }
  return fingerprintSensitiveToolArgs(toolName, args)
}

/** Sent to the model when Stop ended the wait for an answer. */
export const TOOL_STOPPED_MESSAGE = 'The user stopped this run before answering. Do not retry this action.'

const TIER_RANK: Record<ToolRiskTier, number> = {
  [ToolRiskTier.LOW]: 0,
  [ToolRiskTier.MEDIUM]: 1,
  [ToolRiskTier.HIGH]: 2,
  [ToolRiskTier.CRITICAL]: 3,
}

function maxTier(a: ToolRiskTier, b: ToolRiskTier): ToolRiskTier {
  return (TIER_RANK[b] ?? 0) > (TIER_RANK[a] ?? 0) ? b : a
}

function createToolStoppedResult(toolName: string, riskTier: ToolRiskTier) {
  return { denied: true, stopped: true, toolName, riskTier, message: TOOL_STOPPED_MESSAGE }
}

function createToolDeniedResult(toolName: string, riskTier: ToolRiskTier) {
  return {
    denied: true,
    toolName,
    riskTier,
    message: TOOL_REFUSAL_MESSAGE,
  }
}

/**
 * The risk tier the user said "Always" for: the scope's grant when scoped, else this chat's session approval. A grant
 * for read-only commands only is never an ordinary grant.
 */
function grantedRiskTier(sessionId: string, scopeId: string | undefined, toolName: string): ToolRiskTier | undefined {
  if (scopeId) {
    const grant = getScopeGrant(scopeId, toolName)
    return grant && !grant.readOnlyCommands ? grant.riskTier : undefined
  }
  const approval = getToolApproval(sessionId, toolName)
  return approval?.scope === 'session' && !approval.readOnlyCommands ? approval.riskTier : undefined
}

/** Whether the user said "Always" for this shell tool's read-only commands, in this scope (else this chat). */
function hasReadOnlyCommandGrant(sessionId: string, scopeId: string | undefined, toolName: string): boolean {
  if (scopeId) return getScopeGrant(scopeId, toolName)?.readOnlyCommands === true
  const approval = getToolApproval(sessionId, toolName)
  return approval?.scope === 'session' && approval.readOnlyCommands === true
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
 * Shared approval gate. Per call: LOW tools that do not always ask run at once. A local shell tool's read-only command
 * (`ls -la`, `git status`; see `offersReadOnlyCommandGrant` and `isReadOnlyCommand`; never CRITICAL, never a secret
 * path) runs at once for a Dango built-in; for any other tool (MCP) it asks once, offering an Always that covers only
 * that tool's read-only commands, and then runs unasked under that grant (ADR 0015, maintainer 2026-10-22). Otherwise a
 * grant with exactly the same risk tier (the scope's grant when `scopeId` is set, else this chat's session approval)
 * runs the call, unless the tool always asks (send, delete, pay, workspace files, commands or code) or the call is
 * CRITICAL. Everything else asks through the permission sheet; the wait for an answer is outside the execute timeout,
 * and Stop (`abortSignal`) settles it as "Not now".
 */
export function wrapToolsWithApproval(
  sessionId: string | undefined,
  tools: ToolSet,
  opts: { scopeId?: string; builtin?: boolean } = {}
): ToolSet {
  if (!sessionId) {
    return tools
  }
  const scopeId = opts.scopeId || undefined
  // Only Dango's own toolsets pass `builtin: true`; MCP tools never do, whatever they are named.
  const riskOpts = { builtin: opts.builtin === true }

  return Object.fromEntries(
    Object.entries(tools).map(([toolName, definition]) => {
      const wrapTier = getToolRiskTier(toolName, definition?.description, undefined, riskOpts)
      const description = definition?.description
      const asksEveryTime = alwaysAsks(toolName, description)
      // Only a local shell tool's read-only commands may skip the sheet (built-in) or take a read-only Always (MCP);
      // code, SQL, remote, send, delete and workspace tools never do.
      const readOnlyCommandTool = offersReadOnlyCommandGrant(toolName, description)

      return [
        toolName,
        {
          ...definition,
          execute: async (args: unknown, context) => {
            // Args can raise the tier (`rm -rf ~/`, `~/.ssh/id_rsa`): classify this call, never below the wrap tier.
            const riskTier = maxTier(wrapTier, getToolRiskTier(toolName, description, args, riskOpts))
            // R9: never Always, and never a grant, for tools that always ask, CRITICAL calls or secret paths.
            const grantable =
              canAlways(toolName, riskTier, description) &&
              riskTier !== ToolRiskTier.CRITICAL &&
              !asksEveryTime &&
              !secretPathIn(args)
            // A read-only command (ADR 0015): its grant, if any, covers only calls that pass this same check.
            // Prose that rides along must be short and plain, or the call asks with no Always.
            const readOnlyCommand =
              readOnlyCommandTool &&
              riskTier !== ToolRiskTier.CRITICAL &&
              !secretPathIn(args) &&
              isReadOnlyCommand(args) &&
              readOnlyProseIsPlain(args)
            const fingerprint = workspaceApprovalFingerprint(toolName, args) ?? undefined
            const audit = (
              scope: ToolApprovalAuditEntry['scope'],
              decision: ToolApprovalAuditEntry['decision'],
              readOnlyGrant = false
            ) =>
              toolApprovalStore.getState().addAuditEntry({
                sessionId,
                toolName,
                riskTier,
                scope,
                decision,
                timestamp: Date.now(),
                args: redactSensitiveToolPayload(toolName, args),
                ...(fingerprint ? { argsFingerprint: fingerprint } : {}),
                ...(readOnlyGrant ? { readOnlyCommands: true } : {}),
              })

            const grantedTier = grantable ? grantedRiskTier(sessionId, scopeId, toolName) : undefined

            if (riskTier === ToolRiskTier.LOW && !asksEveryTime) {
              audit('none', 'auto-approve')
            } else if (readOnlyCommand && opts.builtin === true) {
              // A Dango built-in shell tool's read-only command never asks (ADR 0015).
              audit('none', 'auto-approve')
            } else if (readOnlyCommand && hasReadOnlyCommandGrant(sessionId, scopeId, toolName)) {
              audit(scopeId ? 'scope' : 'session', 'auto-approve', true)
            } else if (grantable && grantedTier === riskTier) {
              audit(scopeId ? 'scope' : 'session', 'auto-approve')
            } else {
              const choice = await requestToolPermission(
                {
                  sessionId,
                  scopeId,
                  toolName,
                  toolDescription: description,
                  riskTier,
                  summary: describeToolAction(toolName, args, description),
                  allowAlways: grantable || readOnlyCommand,
                  readOnlyCommand,
                },
                { signal: context?.abortSignal }
              )

              if (choice === 'deny' && context?.abortSignal?.aborted) {
                // Stop, not a refusal: no "Not now" audit entry.
                return createToolStoppedResult(toolName, riskTier)
              }
              if (choice === 'deny') {
                audit('none', 'deny')
                return createToolDeniedResult(toolName, riskTier)
              }

              if (choice === 'always' && (grantable || readOnlyCommand)) {
                const now = Date.now()
                // A read-only command's Always is stored marked, so it can only ever match read-only commands.
                const marker = readOnlyCommand ? { readOnlyCommands: true } : {}
                if (scopeId) {
                  const store = toolApprovalStore.getState()
                  const previous = getScopeGrant(scopeId, toolName)
                  const stored = store.addScopeGrant(scopeId, {
                    toolName,
                    riskTier,
                    grantedAt: now,
                    ...(description ? { toolDescription: description } : {}),
                    ...marker,
                  })
                  if (!stored) {
                    // Not saved: put memory back as it was, so the next call asks and no later write saves this grant.
                    if (previous) store.addScopeGrant(scopeId, previous)
                    else store.revokeScopeGrant(scopeId, toolName)
                    notifyAlwaysNotSaved(toolName)
                  }
                  // A grant that was not saved let only this call run, and the log says so.
                  audit(stored ? 'scope' : 'once', 'allow', stored && readOnlyCommand)
                } else {
                  const store = toolApprovalStore.getState()
                  const previous = getToolApproval(sessionId, toolName)
                  const stored = store.addApproval(sessionId, {
                    toolName,
                    riskTier,
                    scope: 'session',
                    timestamp: now,
                    ...marker,
                  })
                  if (!stored) {
                    // Not saved: put memory back as it was, so the next call asks and no later write saves it.
                    if (previous) store.addApproval(sessionId, previous)
                    else store.removeApproval(sessionId, toolName)
                    notifyAlwaysNotSaved(toolName)
                  }
                  // A grant that was not saved let only this call run, and the log says so.
                  audit(stored ? 'session' : 'once', 'allow', stored && readOnlyCommand)
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
