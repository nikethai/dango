import { settingsStore } from '@/stores/settingsStore'

export type FirstRunStep = 1 | 2 | 3 | 4 | 5

export type FirstRunRecord = {
  step: FirstRunStep
  sourceSkipped: boolean
  scopeId?: string
  firstReadJobId?: string
  completedAt?: number
}

export type FirstRunResolution = { show: false } | { show: true; step: FirstRunStep; modelOnly: boolean }

export const FIRST_RUN_PATH = '/first-run'

/** The step to show once a model exists: the saved step, never before step 2. */
export function stepAfterModel(record: FirstRunRecord | undefined): FirstRunStep {
  return Math.max(2, record?.step ?? 2) as FirstRunStep
}

/**
 * Whether first run shows, and at which step. `hasModel` is `!needEditSetting()`.
 * - No record: a new user without a model starts at step 1; an upgrading user with a model never sees it.
 * - Completed: shows only step 1 (`modelOnly`) after every model was removed.
 * - In progress: step 1 until there is a model, then the saved step.
 */
export function resolveFirstRun(record: FirstRunRecord | undefined, hasModel: boolean): FirstRunResolution {
  if (!record) return hasModel ? { show: false } : { show: true, step: 1, modelOnly: false }
  if (record.completedAt !== undefined) return hasModel ? { show: false } : { show: true, step: 1, modelOnly: true }
  return { show: true, step: hasModel ? stepAfterModel(record) : 1, modelOnly: false }
}

function isUnder(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`)
}

/**
 * Where the app goes for first run, or null to stay. The quick window (and any desktop window that is not main)
 * never gets first run. Settings stays reachable (Models and keys, MCP, Documents), and so does Quick Chat.
 */
export function firstRunRedirect(
  pathname: string,
  isQuickWindow: boolean,
  r: FirstRunResolution
): typeof FIRST_RUN_PATH | null {
  if (!r.show || isQuickWindow) return null
  if (isUnder(pathname, FIRST_RUN_PATH) || isUnder(pathname, '/settings') || isUnder(pathname, '/quick')) return null
  return FIRST_RUN_PATH
}

/**
 * The `from` search value of `/first-run`: an in-app path (with its query and hash) to return to, or undefined.
 * Only a same-origin path starting with a single `/` passes; backslashes are rejected (`/\\host` resolves off-origin).
 */
export function firstRunFrom(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) {
    return undefined
  }
  const base = 'http://first-run.invalid'
  let url: URL
  try {
    url = new URL(value, base)
  } catch {
    return undefined
  }
  if (url.origin !== base) return undefined
  return isUnder(url.pathname, FIRST_RUN_PATH) ? undefined : value
}

/** Merges `patch` into the saved record (starting one at step 1) and writes settings. */
export function setFirstRun(patch: Partial<FirstRunRecord>): void {
  const state = settingsStore.getState()
  const base: FirstRunRecord = state.firstRun ?? { step: 1, sourceSkipped: false }
  state.setSettings({ firstRun: { ...base, ...patch } })
}
