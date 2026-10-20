import type { ToolRiskTier } from '@shared/types/mcp'
import { useSyncExternalStore } from 'react'
import { canAlways, type PermissionChoice, type ToolActionSummary } from './describe'

export type PermissionRequest = {
  id: string
  sessionId: string
  scopeId?: string
  toolName: string
  riskTier: ToolRiskTier
  summary: ToolActionSummary
  allowAlways: boolean
}

type Entry = {
  request: PermissionRequest
  timeoutMs: number
  /** Started only when the entry becomes head, so each sheet gets the full timeout. */
  timer?: ReturnType<typeof setTimeout>
  settle: (choice: PermissionChoice) => void
}

const DEFAULT_TIMEOUT_MS = 120_000

// Per window: a tool call asks in the window whose turn started it.
let queue: Entry[] = []
const listeners = new Set<() => void>()
let nextId = 0

/** Start the head's timeout if it has none yet. Call after every queue change. */
function armHead() {
  const head = queue[0]
  if (!head || head.timer !== undefined) return
  const { id } = head.request
  head.timer = setTimeout(() => resolvePermission(id, 'deny'), head.timeoutMs)
}

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The request the sheet shows now (first open request), or null. */
export function getPermissionHead(): PermissionRequest | null {
  return queue[0]?.request ?? null
}

export function usePermissionHead(): PermissionRequest | null {
  return useSyncExternalStore(subscribe, getPermissionHead, getPermissionHead)
}

function sameGrantTarget(a: PermissionRequest, b: PermissionRequest): boolean {
  if (a.toolName !== b.toolName || a.riskTier !== b.riskTier || a.allowAlways !== b.allowAlways) return false
  if (a.scopeId || b.scopeId) return a.scopeId === b.scopeId
  return a.sessionId === b.sessionId
}

/**
 * Settle a request. `'always'` also settles every queued request for the same tool, risk tier and scope
 * (same chat when unscoped). A request that does not allow Always is settled `'once'` instead.
 */
export function resolvePermission(id: string, choice: PermissionChoice): void {
  const entry = queue.find((e) => e.request.id === id)
  if (!entry) return
  const effective: PermissionChoice = choice === 'always' && !entry.request.allowAlways ? 'once' : choice
  const settled =
    effective === 'always' ? queue.filter((e) => e === entry || sameGrantTarget(e.request, entry.request)) : [entry]
  queue = queue.filter((e) => !settled.includes(e))
  for (const e of settled) e.settle(effective)
  armHead()
  emit()
}

/**
 * Queue a permission request; resolves with the user's choice. The timeout (default 120 s, counted from when
 * the request shows) and an aborted signal both resolve `'deny'` and remove the request, so the next one shows.
 * `allowAlways` is stored as `allowAlways && canAlways(toolName, riskTier)`.
 */
export function requestToolPermission(
  req: Omit<PermissionRequest, 'id'>,
  opts: { signal?: AbortSignal; timeoutMs?: number } = {}
): Promise<PermissionChoice> {
  const { signal, timeoutMs = DEFAULT_TIMEOUT_MS } = opts
  if (signal?.aborted) return Promise.resolve('deny')

  nextId += 1
  // Never trust the caller: tools that always ask, and critical ones, never offer Always.
  const allowAlways = req.allowAlways && canAlways(req.toolName, req.riskTier)
  const request: PermissionRequest = { ...req, allowAlways, id: `permission-${nextId}` }

  return new Promise<PermissionChoice>((resolve) => {
    const onAbort = () => resolvePermission(request.id, 'deny')
    signal?.addEventListener('abort', onAbort, { once: true })
    const entry: Entry = {
      request,
      timeoutMs,
      settle: (choice) => {
        clearTimeout(entry.timer)
        signal?.removeEventListener('abort', onAbort)
        resolve(choice)
      },
    }
    queue = [...queue, entry]
    armHead()
    emit()
  })
}
