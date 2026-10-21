import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { getWindowRole, knownWindowRole, type WindowRole } from '@/platform/windowRole'
import { needEditSetting } from '@/stores/settingActions'
import { useSettingsStore } from '@/stores/settingsStore'
import { type FIRST_RUN_PATH, type FirstRunResolution, firstRunRedirect, resolveFirstRun } from './firstRun'

/** First run's resolution, re-read whenever settings change (a model added or removed, a step saved). */
export function useFirstRunResolution(): FirstRunResolution {
  const record = useSettingsStore((s) => s.firstRun)
  // needEditSetting reads the store; the selector re-runs on every settings change.
  const hasModel = useSettingsStore(() => !needEditSetting())
  return useMemo(() => resolveFirstRun(record, hasModel), [record, hasModel])
}

/**
 * Sends the main window to first run on every path change while it should show. Waits for the window role: the
 * desktop quick window boots at `/` and its label is only known asynchronously, so nothing redirects until the role
 * is `jobs` (main on desktop; the only window on web and mobile).
 */
export function useFirstRunGate(pathname: string, navigate: (to: typeof FIRST_RUN_PATH, from: string) => void): void {
  const resolution = useFirstRunResolution()
  const [role, setRole] = useState<WindowRole | undefined>(() => knownWindowRole())

  useEffect(() => {
    if (role) return
    let live = true
    void getWindowRole().then((r) => {
      if (live) setRole(r)
    })
    return () => {
      live = false
    }
  }, [role])

  useLayoutEffect(() => {
    if (!role) return
    const to = firstRunRedirect(pathname, role !== 'jobs', resolution)
    if (to) navigate(to, pathname)
  }, [pathname, role, resolution, navigate])
}
