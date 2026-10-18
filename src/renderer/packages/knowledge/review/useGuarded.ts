import { t } from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLogger } from '@/lib/utils'

const log = getLogger('knowledge')

/** The default failure copy, for an action that saves. */
export const SAVE_FAILED = "Couldn't save that. Try again."
/** The failure copy for Open. */
export const OPEN_FAILED = "Couldn't open that. Try again."

/**
 * The toast for a failure other than a contradiction (default: the save copy; pass `OPEN_FAILED` for Open).
 * Loaded on demand: the toast store reads localStorage. Never rejects: a toast that can't show is logged.
 */
export async function toastFailure(message: string = SAVE_FAILED): Promise<void> {
  try {
    const toastActions = await import('@/stores/toastActions')
    toastActions.add(t(message))
  } catch (error) {
    log.error('Review failure toast failed:', error)
  }
}

/**
 * Runs one action at a time: a second call while the first is pending returns early, and `busy` lets the
 * buttons disable. A rejection is logged and toasted with `failure` (default: the save copy), unless
 * `onError` handles it (returns true). `run` never rejects, even when `onError` or the toast throws.
 */
export function useGuarded(onError?: (error: unknown) => Promise<boolean> | boolean) {
  const flight = useRef(false)
  const alive = useRef(true)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  const run = useCallback(
    async (action: () => Promise<unknown>, failure: string = SAVE_FAILED): Promise<void> => {
      if (flight.current) return
      flight.current = true
      setBusy(true)
      try {
        await action()
      } catch (error) {
        let handled = false
        try {
          handled = Boolean(await onError?.(error))
        } catch (handlerError) {
          log.error('Review error handler failed:', handlerError)
        }
        if (!handled) {
          log.error('Review action failed:', error)
          await toastFailure(failure)
        }
      } finally {
        flight.current = false
        if (alive.current) setBusy(false)
      }
    },
    [onError]
  )
  return { busy, run }
}
