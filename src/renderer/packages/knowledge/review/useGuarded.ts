import { t } from 'i18next'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getLogger } from '@/lib/utils'

const log = getLogger('knowledge')

/** The toast for a failure other than a contradiction. Loaded on demand: the toast store reads localStorage. */
export async function toastFailure(): Promise<void> {
  const toastActions = await import('@/stores/toastActions')
  toastActions.add(t("Couldn't save that. Try again."))
}

/**
 * Runs one action at a time: a second call while the first is pending returns early, and `busy` lets the
 * buttons disable. A rejection is logged and toasted, unless `onError` handles it (returns true).
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
    async (action: () => Promise<unknown>): Promise<void> => {
      if (flight.current) return
      flight.current = true
      setBusy(true)
      try {
        await action()
      } catch (error) {
        if (!(await onError?.(error))) {
          log.error('Review action failed:', error)
          await toastFailure()
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
