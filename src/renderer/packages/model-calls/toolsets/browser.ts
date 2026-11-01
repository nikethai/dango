import type { ToolSet } from 'ai'
import { tool } from 'ai'
import z from 'zod'
import { acquireBrowserLock, releaseBrowserLock } from '@/packages/browser/lock'
import { assertBrowserUrl, workspaceBrowserDownloadsDir } from '@/packages/browser/url-policy'
import platform from '@/platform'
import { settingsStore } from '@/stores/settingsStore'
import { browserAgentUiStore } from '@/stores/browserAgentUiStore'

const SNAPSHOT_MAX = 180_000

/** Last browser tool name per session — used by prepareStep force-snapshot. */
const lastBrowserToolBySession = new Map<string, string>()
/** Whether last mutation/observation already embedded a text snapshot. */
const lastBrowserObsEmbeddedBySession = new Map<string, boolean>()

export function recordBrowserToolUse(sessionId: string, toolName: string, embeddedObservation: boolean) {
  if (!sessionId) return
  lastBrowserToolBySession.set(sessionId, toolName)
  lastBrowserObsEmbeddedBySession.set(sessionId, embeddedObservation)
}

export function getLastBrowserTool(sessionId: string): string | undefined {
  return lastBrowserToolBySession.get(sessionId)
}

export function getLastBrowserObservationEmbedded(sessionId: string): boolean {
  return Boolean(lastBrowserObsEmbeddedBySession.get(sessionId))
}

export function resetBrowserTurnState(sessionId: string) {
  lastBrowserToolBySession.delete(sessionId)
  lastBrowserObsEmbeddedBySession.delete(sessionId)
}

const BROWSER_MUTATION_TOOLS = new Set([
  'browser_navigate',
  'browser_click',
  'browser_type',
  'browser_scroll',
  'browser_tabs',
])

/** After a mutation without embedded snapshot, force browser_snapshot next. */
export function shouldForceBrowserSnapshot(lastToolName: string | undefined, hasEmbeddedObservation: boolean): boolean {
  if (hasEmbeddedObservation) return false
  if (!lastToolName) return false
  return BROWSER_MUTATION_TOOLS.has(lastToolName)
}

function hasEmbeddedSnapshot(result: Record<string, unknown>): boolean {
  return typeof result.snapshot === 'string' && result.snapshot.trim().length > 0
}

export type BrowserAgentToolOptions = {
  sessionId: string
  runId?: string
  workspaceRoot?: string
  /** Room policy already validated by caller */
  headless?: boolean
  allowlist?: string[]
}

function browserSettings() {
  const ext = settingsStore.getState().getSettings()?.extension?.browserAgent
  return {
    enabled: Boolean(ext?.enabled),
    headless: Boolean(ext?.headless),
    allowlist: Array.isArray(ext?.allowlist) ? ext!.allowlist! : [],
    maxStepsPerTurn: ext?.maxStepsPerTurn ?? 12,
  }
}

async function ensureSession(opts: BrowserAgentToolOptions) {
  if (platform.type !== 'desktop') {
    return { error: 'UNSUPPORTED_PLATFORM', message: 'Browser agent is only available on the desktop app.' }
  }
  if (!platform.browserSessionStart) {
    return { error: 'NOT_IMPLEMENTED', message: 'Browser controller is not available.' }
  }
  const settings = browserSettings()
  if (!settings.enabled) {
    return {
      error: 'NOT_ENABLED',
      message: 'Browser agent is disabled. Enable it in Settings → Browser Agent, then arm this chat.',
    }
  }

  const runId = opts.runId || `run-${opts.sessionId}`
  const lock = acquireBrowserLock(opts.sessionId, runId)
  if (!lock.ok) {
    return { error: 'BROWSER_BUSY', message: lock.error }
  }

  const downloadDir = workspaceBrowserDownloadsDir(opts.workspaceRoot)
  const downloadsEnabled = Boolean(downloadDir)
  const startParams = {
    sessionId: opts.sessionId,
    headless: opts.headless ?? settings.headless,
    downloadsEnabled,
    downloadDir: downloadDir || undefined,
    allowlist: opts.allowlist ?? settings.allowlist,
  }

  const markRunning = () => {
    browserAgentUiStore.getState().setStatus(opts.sessionId, {
      running: true,
      url: null,
      lastTool: 'session:start',
      error: null,
    })
  }

  try {
    let running = false
    try {
      const status = await platform.browserSessionStatus?.(opts.sessionId)
      running = Boolean(status?.running)
    } catch {
      // Dead host / RPC fail — evict and restart once
      running = false
      try {
        await platform.browserSessionStop?.(opts.sessionId)
      } catch {
        /* ignore */
      }
    }
    if (!running) {
      await platform.browserSessionStart(startParams)
      markRunning()
    }
    return { ok: true as const, downloadsEnabled, downloadDir }
  } catch (err) {
    // One recovery attempt: stop stale host then start fresh
    try {
      await platform.browserSessionStop?.(opts.sessionId)
      await platform.browserSessionStart(startParams)
      markRunning()
      return { ok: true as const, downloadsEnabled, downloadDir }
    } catch (err2) {
      releaseBrowserLock(opts.sessionId, runId)
      return {
        error: 'LAUNCH_FAILED',
        message: err2 instanceof Error ? err2.message : err instanceof Error ? err.message : String(err2),
      }
    }
  }
}

function setUi(sessionId: string, patch: { lastTool?: string; url?: string | null; error?: string | null }) {
  try {
    browserAgentUiStore.getState().patchStatus(sessionId, patch)
  } catch {
    /* store may be absent in unit tests */
  }
}

function trimSnapshotFields<T extends Record<string, unknown>>(result: T): T {
  const snapshot = typeof result.snapshot === 'string' ? result.snapshot : undefined
  if (!snapshot || snapshot.length <= SNAPSHOT_MAX) return result
  return {
    ...result,
    snapshot: `${snapshot.slice(0, SNAPSHOT_MAX)}\n… [snapshot truncated]`,
    truncated: true,
  }
}

/** When host did not attach a snapshot (older binary / error path), fetch one. */
async function ensureSnapshotAttached(
  sessionId: string,
  result: Record<string, unknown>
): Promise<Record<string, unknown>> {
  if (typeof result.snapshot === 'string' && result.snapshot.trim()) {
    return trimSnapshotFields(result)
  }
  try {
    const shot = (await platform.browserSnapshot?.(sessionId, { interestingOnly: true })) as
      | Record<string, unknown>
      | undefined
    if (!shot) return trimSnapshotFields(result)
    return trimSnapshotFields({
      ...result,
      ...shot,
      nextAction:
        (typeof result.nextAction === 'string' && result.nextAction) ||
        'Fresh snapshot attached. Use only these refs for the next action.',
    })
  } catch {
    return trimSnapshotFields(result)
  }
}

export function browserToolSetDescription(): string {
  return `
# Dango Browser (isolated)

Use these tools to drive a **Dango-managed isolated browser** (not the user's personal Chrome profile).

## When to use
1. Prefer \`web_search\` / \`parse_link\` for simple Q&A.
2. Use browser for multi-step interactive web (forms, docs navigation, UI flows).
3. Navigate/click/type/scroll **auto-return a fresh snapshot** with new refs — use those refs only.
4. Stop and ask the user on auth walls, payments, or captchas.

## Tools
- browser_navigate { url } — opens URL and returns snapshot + refs
- browser_snapshot — a11y/ref tree (call if you need a re-read without acting)
- browser_click { ref } — click + auto snapshot
- browser_type { text, ref?, submit? } — type + auto snapshot
- browser_scroll { direction, amount?, ref? } — scroll + auto snapshot
- browser_tabs { action: list|select|new|close, tabId?, url? }
- browser_screenshot — secondary visual; prefer snapshot refs for interaction

Refs invalidate after every mutation/navigation. Only http(s). Downloads need a session workspace folder.
`
}

export function createBrowserToolSet(opts: BrowserAgentToolOptions): { description: string; tools: ToolSet } {
  const allowlist = () => opts.allowlist ?? browserSettings().allowlist

  const browser_navigate = tool({
    description:
      'Navigate the isolated Dango browser to an http(s) URL. Returns a fresh accessibility snapshot with refs.',
    inputSchema: z.object({
      url: z.string().describe('http(s) URL to open'),
    }),
    execute: async (input: { url: string }) => {
      const check = assertBrowserUrl(input.url, allowlist())
      if (!check.ok) {
        setUi(opts.sessionId, { lastTool: 'browser_navigate', error: check.error })
        return { error: check.code, message: check.error }
      }
      const ready = await ensureSession(opts)
      if ('error' in ready && ready.error) return ready
      try {
        const result = (await platform.browserNavigate!(opts.sessionId, check.url)) as Record<string, unknown>
        const withShot = await ensureSnapshotAttached(opts.sessionId, result)
        recordBrowserToolUse(opts.sessionId, 'browser_navigate', hasEmbeddedSnapshot(withShot))
        setUi(opts.sessionId, {
          lastTool: 'browser_navigate',
          url: check.url,
          error: null,
        })
        return withShot
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        recordBrowserToolUse(opts.sessionId, 'browser_navigate', false)
        setUi(opts.sessionId, { lastTool: 'browser_navigate', error: message })
        return { error: 'ACTION_ERROR', message }
      }
    },
  })

  const browser_snapshot = tool({
    description:
      'Capture accessibility/ref snapshot of the current page. Usually unnecessary right after navigate/click/type (those auto-snapshot).',
    inputSchema: z.object({
      interestingOnly: z.boolean().optional().describe('Focus interactive/heading elements. Default true.'),
    }),
    execute: async (input: { interestingOnly?: boolean }) => {
      const ready = await ensureSession(opts)
      if ('error' in ready && ready.error) return ready
      try {
        const result = (await platform.browserSnapshot!(opts.sessionId, {
          interestingOnly: input.interestingOnly,
        })) as { snapshot?: string; url?: string; title?: string; truncated?: boolean }
        const trimmed = trimSnapshotFields(result as Record<string, unknown>)
        recordBrowserToolUse(opts.sessionId, 'browser_snapshot', hasEmbeddedSnapshot(trimmed))
        setUi(opts.sessionId, { lastTool: 'browser_snapshot', url: result?.url ?? null, error: null })
        return trimmed
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        recordBrowserToolUse(opts.sessionId, 'browser_snapshot', false)
        setUi(opts.sessionId, { lastTool: 'browser_snapshot', error: message })
        return { error: 'ACTION_ERROR', message }
      }
    },
  })

  const browser_click = tool({
    description:
      'Click an element by snapshot ref (e.g. e12). Returns a fresh snapshot. On stale ref, returns REF_INVALID + new snapshot.',
    inputSchema: z.object({
      ref: z.string().describe('Element ref from the latest browser snapshot'),
      button: z.enum(['left', 'right']).optional(),
    }),
    execute: async (input: { ref: string; button?: 'left' | 'right' }) => {
      const ready = await ensureSession(opts)
      if ('error' in ready && ready.error) return ready
      try {
        const result = (await platform.browserAct!(opts.sessionId, {
          action: 'click',
          ref: input.ref,
          button: input.button,
        })) as Record<string, unknown>
        const withShot = await ensureSnapshotAttached(opts.sessionId, result)
        const err = typeof withShot.error === 'string' ? String(withShot.error) : null
        recordBrowserToolUse(opts.sessionId, 'browser_click', hasEmbeddedSnapshot(withShot))
        setUi(opts.sessionId, {
          lastTool: `browser_click:${input.ref}`,
          error: err,
        })
        return withShot
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const isStale = message.includes('REF_INVALID') || message.toLowerCase().includes('stale ref')
        setUi(opts.sessionId, { lastTool: 'browser_click', error: message })
        if (isStale) {
          const recovered = await ensureSnapshotAttached(opts.sessionId, {
            error: 'REF_INVALID',
            message,
          })
          recordBrowserToolUse(opts.sessionId, 'browser_click', hasEmbeddedSnapshot(recovered))
          return recovered
        }
        recordBrowserToolUse(opts.sessionId, 'browser_click', false)
        return { error: 'ACTION_ERROR', message }
      }
    },
  })

  const browser_type = tool({
    description:
      'Type text into a ref or focused element. Returns a fresh snapshot. Never log passwords. May submit forms if submit=true.',
    inputSchema: z.object({
      text: z.string(),
      ref: z.string().optional(),
      submit: z.boolean().optional(),
    }),
    execute: async (input: { text: string; ref?: string; submit?: boolean }) => {
      const ready = await ensureSession(opts)
      if ('error' in ready && ready.error) return ready
      try {
        const result = (await platform.browserAct!(opts.sessionId, {
          action: 'type',
          text: input.text,
          ref: input.ref,
          submit: input.submit,
        })) as Record<string, unknown>
        // Do not echo typed secrets back; keep structural fields + snapshot
        const { text: _t, ...safe } = result as Record<string, unknown> & { text?: string }
        const withShot = await ensureSnapshotAttached(opts.sessionId, {
          ...safe,
          ok: safe.ok ?? true,
          ref: input.ref,
          submitted: Boolean(input.submit),
        })
        recordBrowserToolUse(opts.sessionId, 'browser_type', hasEmbeddedSnapshot(withShot))
        setUi(opts.sessionId, {
          lastTool: 'browser_type',
          error: typeof withShot.error === 'string' ? String(withShot.error) : null,
        })
        return withShot
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const isStale = message.includes('REF_INVALID') || message.toLowerCase().includes('stale ref')
        setUi(opts.sessionId, { lastTool: 'browser_type', error: message })
        if (isStale) {
          const recovered = await ensureSnapshotAttached(opts.sessionId, { error: 'REF_INVALID', message })
          recordBrowserToolUse(opts.sessionId, 'browser_type', hasEmbeddedSnapshot(recovered))
          return recovered
        }
        recordBrowserToolUse(opts.sessionId, 'browser_type', false)
        return { error: 'ACTION_ERROR', message }
      }
    },
  })

  const browser_scroll = tool({
    description: 'Scroll the page or an element. Returns a fresh snapshot with updated refs.',
    inputSchema: z.object({
      direction: z.enum(['up', 'down']),
      amount: z.number().optional(),
      ref: z.string().optional(),
    }),
    execute: async (input: { direction: 'up' | 'down'; amount?: number; ref?: string }) => {
      const ready = await ensureSession(opts)
      if ('error' in ready && ready.error) return ready
      try {
        const result = (await platform.browserAct!(opts.sessionId, {
          action: 'scroll',
          direction: input.direction,
          amount: input.amount,
          ref: input.ref,
        })) as Record<string, unknown>
        const withShot = await ensureSnapshotAttached(opts.sessionId, result)
        recordBrowserToolUse(opts.sessionId, 'browser_scroll', hasEmbeddedSnapshot(withShot))
        setUi(opts.sessionId, { lastTool: 'browser_scroll', error: null })
        return withShot
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        recordBrowserToolUse(opts.sessionId, 'browser_scroll', false)
        return { error: 'ACTION_ERROR', message }
      }
    },
  })

  const browser_tabs = tool({
    description: 'List, select, open, or close browser tabs in the isolated session.',
    inputSchema: z.object({
      action: z.enum(['list', 'select', 'new', 'close']),
      tabId: z.string().optional(),
      url: z.string().optional(),
    }),
    execute: async (input: { action: 'list' | 'select' | 'new' | 'close'; tabId?: string; url?: string }) => {
      if (input.url) {
        const check = assertBrowserUrl(input.url, allowlist())
        if (!check.ok) return { error: check.code, message: check.error }
      }
      const ready = await ensureSession(opts)
      if ('error' in ready && ready.error) return ready
      try {
        const result = await platform.browserTabs!(opts.sessionId, {
          op: input.action,
          tabId: input.tabId,
          url: input.url,
        })
        setUi(opts.sessionId, { lastTool: `browser_tabs:${input.action}`, error: null })
        // Tab switches invalidate refs — attach snapshot when page context changed
        if (input.action === 'select' || input.action === 'new') {
          return ensureSnapshotAttached(opts.sessionId, (result as Record<string, unknown>) || {})
        }
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { error: 'ACTION_ERROR', message }
      }
    },
  })

  const browser_screenshot = tool({
    description: 'Capture a screenshot of the current page (secondary; prefer browser_snapshot refs for interaction).',
    inputSchema: z.object({}),
    execute: async () => {
      const ready = await ensureSession(opts)
      if ('error' in ready && ready.error) return ready
      try {
        const result = await platform.browserScreenshot!(opts.sessionId)
        setUi(opts.sessionId, { lastTool: 'browser_screenshot', error: null })
        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { error: 'ACTION_ERROR', message }
      }
    },
    // Avoid base64-as-JSON text (Gemini 1M token cap); send multimodal image-data.
    toModelOutput: ({ output }: { output: any }) => {
      if (output?.error) {
        return {
          type: 'error-text' as const,
          value: `${output.error}${output.message ? `: ${output.message}` : ''}`,
        }
      }
      const base64 = output?.base64 as string | undefined
      if (!base64) {
        return { type: 'json' as const, value: output ?? {} }
      }
      const mediaType = (output?.mimeType as string) || 'image/png'
      return {
        type: 'content' as const,
        value: [
          { type: 'text' as const, text: `Browser screenshot (${mediaType}).` },
          { type: 'image-data' as const, data: base64, mediaType },
        ],
      }
    },
  })

  return {
    description: browserToolSetDescription(),
    tools: {
      browser_navigate,
      browser_snapshot,
      browser_click,
      browser_type,
      browser_scroll,
      browser_tabs,
      browser_screenshot,
    } as ToolSet,
  }
}

export async function stopBrowserSession(sessionId: string, runId?: string) {
  releaseBrowserLock(sessionId, runId)
  try {
    const res = (await platform.browserSessionStop?.(sessionId)) as { stopped?: boolean } | undefined
    // Every Stop calls this. A chat that never used the browser has no status, and writing one would open the
    // browser panel (finding 1): only a browser that was running, or a chat that already shows it, gets the update.
    const ui = browserAgentUiStore.getState()
    if (res?.stopped !== true && !ui.bySession[sessionId]) return
    ui.setStatus(sessionId, {
      running: false,
      url: null,
      lastTool: 'session:stop',
      error: null,
    })
  } catch {
    /* ignore */
  }
}
