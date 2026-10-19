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

export const JOB_FIX_ACTIONS = ['reconnect', 'relink-folder', 'choose-model', 'try-again'] as const
export type JobFixAction = (typeof JOB_FIX_ACTIONS)[number]
export type JobFix = { action: JobFixAction; label: string }
// English keys: the UI passes them through t().
export const JOB_FIX_LABELS: Record<JobFixAction, string> = {
  reconnect: 'Sign in again',
  'relink-folder': 'Find the folder',
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
  fix: z.object({ action: z.enum(JOB_FIX_ACTIONS), label: z.string() }).optional(),
  stoppedAt: z.number().optional(),
})

/** Parses stored jobs, dropping invalid rows one by one. */
export function parseJobs(raw: unknown): BackgroundJob[] {
  if (!Array.isArray(raw)) return []
  const jobs: BackgroundJob[] = []
  for (const row of raw) {
    const parsed = BackgroundJobSchema.safeParse(row)
    if (parsed.success) jobs.push(parsed.data)
  }
  return jobs
}
