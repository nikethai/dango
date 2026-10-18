import { useEffect, useRef, useState } from 'react'

/**
 * Follows `value`, changing at most once per `intervalMs`. A change inside the window lands at the
 * end of it with the latest value (trailing edge); intermediate values are dropped.
 */
export function useThrottledValue<T>(value: T, intervalMs: number): T {
  const [throttled, setThrottled] = useState(value)
  const lastEmitRef = useRef<number | null>(null)
  const latestRef = useRef(value)
  latestRef.current = value

  if (lastEmitRef.current === null) lastEmitRef.current = Date.now()

  useEffect(() => {
    if (Object.is(value, throttled)) return
    const wait = (lastEmitRef.current ?? 0) + intervalMs - Date.now()
    const emit = () => {
      lastEmitRef.current = Date.now()
      setThrottled(latestRef.current)
    }
    if (wait <= 0) {
      emit()
      return
    }
    const timer = setTimeout(emit, wait)
    return () => clearTimeout(timer)
  }, [value, throttled, intervalMs])

  return throttled
}
