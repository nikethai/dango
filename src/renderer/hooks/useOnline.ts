import { useCallback, useEffect, useState } from 'react'

const readOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine)

/**
 * Whether the browser says it is online, kept current by the window's online/offline events. `recheck` reads it again
 * now (a Retry on an offline notice). Shared by Quick Chat and the main composer.
 */
export function useOnline(): [online: boolean, recheck: () => void] {
  const [online, setOnline] = useState(readOnline)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setOnline(readOnline())
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  const recheck = useCallback(() => setOnline(readOnline()), [])
  return [online, recheck]
}
