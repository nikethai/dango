import { isSensitiveToolName, redactSensitiveToolPayload } from '@shared/privacy/sensitive-tools'
import type { ToolSet } from 'ai'
import { CLIENT_ANSWER_TOOL, CLIENT_RECALL_TOOL } from '@/packages/model-calls/toolsets/pm-pilot-history'
import { runHooks } from './executor'

export type ToolHookContext = {
  sessionId?: string
  workspaceRoot?: string | null
}

type ToolExecute = (args: unknown, options: unknown) => PromiseLike<unknown> | unknown

/** Their results hold client mail and tasks that may be kept on this device (ADR 0003), so no hook gets them. */
const NO_POST_HOOK_TOOLS: ReadonlySet<string> = new Set([CLIENT_RECALL_TOOL, CLIENT_ANSWER_TOOL])

/**
 * Wrap every tool `execute` with global PreToolUse / PostToolUse hooks.
 * - PreToolUse exit/block → return error payload to the model (do not throw)
 * - Failures in the hook runner itself are fail-soft (tool still runs)
 * - Tools without execute (e.g. some provider-native tools) are left unchanged
 * - `client_recall` and `client_answer` get no PostToolUse (result or error): those can quote local-only mail
 */
export function wrapToolsWithLifecycleHooks(tools: ToolSet, ctx: ToolHookContext = {}): ToolSet {
  if (!tools || Object.keys(tools).length === 0) {
    return tools
  }

  return Object.fromEntries(
    Object.entries(tools).map(([toolName, definition]) => {
      const rawExecute = (definition as { execute?: ToolExecute } | undefined)?.execute
      if (typeof rawExecute !== 'function') {
        return [toolName, definition]
      }
      if (isSensitiveToolName(toolName)) {
        return [toolName, definition]
      }

      return [
        toolName,
        {
          ...definition,
          execute: async (args: unknown, options: unknown) => {
            const postHooks = !NO_POST_HOOK_TOOLS.has(toolName)
            const pre = await safeRunToolHooks('PreToolUse', toolName, args, ctx)
            if (pre?.blocked) {
              return {
                error: true,
                blocked: true,
                message: pre.blockReason || `Tool "${toolName}" was blocked by a PreToolUse hook.`,
              }
            }

            try {
              const result = await rawExecute(args, options)
              if (postHooks) await safeRunToolHooks('PostToolUse', toolName, args, ctx, result)
              return result
            } catch (err) {
              if (postHooks) {
                await safeRunToolHooks('PostToolUse', toolName, args, ctx, {
                  error: (err as Error)?.message || String(err),
                })
              }
              throw err
            }
          },
        },
      ]
    })
  ) as ToolSet
}

async function safeRunToolHooks(
  event: 'PreToolUse' | 'PostToolUse',
  toolName: string,
  toolInput: unknown,
  ctx: ToolHookContext,
  output?: unknown
) {
  try {
    const { loadHookOverrides, mergeHooksList, pushHookAudit } = await import('@/stores/hooksStore')
    const overrides = await loadHookOverrides()
    const hooks = mergeHooksList(overrides)
    // Fast path: no hooks for this event
    if (!hooks.some((h) => h.enabled && h.event === event)) {
      return undefined
    }

    return await runHooks({
      event,
      hooks,
      shellEnabled: Boolean(overrides.shellHooksEnabled),
      toolName,
      toolInput: redactSensitiveToolPayload(toolName, toolInput),
      sessionId: ctx.sessionId,
      workspaceRoot: ctx.workspaceRoot,
      output: output !== undefined ? safeStringify(output) : undefined,
      onRun: pushHookAudit,
    })
  } catch (error) {
    console.warn(`[hooks] ${event} failed for ${toolName}:`, error)
    return undefined
  }
}

function safeStringify(value: unknown): string {
  try {
    if (typeof value === 'string') return value.slice(0, 4000)
    return JSON.stringify(value)?.slice(0, 4000) || ''
  } catch {
    return String(value).slice(0, 400)
  }
}
