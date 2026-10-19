import { useEffect, useState } from 'react'
import { getWindowRole, knownWindowRole, type WindowRole } from '@/platform/windowRole'

/** This window's role (see `getWindowRole`); undefined until known, so callers hide or disable actions meanwhile. */
export function useWindowRole(): WindowRole | undefined {
  const [role, setRole] = useState<WindowRole | undefined>(knownWindowRole)
  useEffect(() => {
    if (role !== undefined) return
    let live = true
    void getWindowRole().then((next) => {
      if (live) setRole(next)
    })
    return () => {
      live = false
    }
  }, [role])
  return role
}
