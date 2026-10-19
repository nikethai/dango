import { z } from 'zod'

export type BackgroundJob = {
  id: string
  scopeId: string
  kind: 'sync' | 'review' | 'swarm' | 'plan'
  label: string
  status: 'running' | 'done' | 'failed' | 'needs-you'
  attempts: number
  nextRetryAt?: number
  startedAt: number
  finishedAt?: number
  error?: string
  sourceId?: string
  progress?: string
  outcome?: string
  fix?: JobFix
  stoppedAt?: number
}
export const RETRY_DELAYS_MS = [10_000, 60_000, 300_000] as const // then a Needs you entry

export type JobFixAction = 'reconnect' | 'relink-folder' | 'choose-model' | 'try-again'
export type JobFix = { action: JobFixAction; label: string }
// English keys: the UI passes them through t().
export const JOB_FIX_LABELS: Record<JobFixAction, string> = {
  reconnect: 'Reconnect',
  'relink-folder': 'Choose the folder again',
  'choose-model': 'Choose a model',
  'try-again': 'Try again',
}

/** Delay before the next automatic retry after `failedRuns` failures; null when retries are used up. */
export function retryDelayAfter(failedRuns: number): number | null {
  return RETRY_DELAYS_MS[failedRuns - 1] ?? null
}

export const JOB_HISTORY_PER_SCOPE = 50
export const REVIEW_INTERVAL_MS = 6 * 60 * 60 * 1000

export const BackgroundJobSchema: z.ZodType<BackgroundJob> = z.object({
  id: z.string(),
  scopeId: z.string(),
  kind: z.enum(['sync', 'review', 'swarm', 'plan']),
  label: z.string(),
  status: z.enum(['running', 'done', 'failed', 'needs-you']),
  attempts: z.number(),
  nextRetryAt: z.number().optional(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  error: z.string().optional(),
  sourceId: z.string().optional(),
  progress: z.string().optional(),
  outcome: z.string().optional(),
  fix: z
    .object({ action: z.enum(['reconnect', 'relink-folder', 'choose-model', 'try-again']), label: z.string() })
    .optional(),
  stoppedAt: z.number().optional(),
})
