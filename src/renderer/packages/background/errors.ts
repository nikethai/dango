import type { JobFix } from '@shared/types/background'

/**
 * A failure retrying cannot fix (expired sign-in, missing folder, no model). The job skips its retries and waits
 * for `fix`. `reason` is the lower-case English clause after "stopped:" (e.g. `'sign in again'`); it is a
 * translation key, translated when the Review entry is written.
 */
export class NeedsUserError extends Error {
  constructor(
    readonly reason: string,
    readonly fix: JobFix
  ) {
    super(reason)
    this.name = 'NeedsUserError'
  }
}
