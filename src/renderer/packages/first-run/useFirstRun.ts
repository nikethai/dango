import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getWindowRole, knownWindowRole, type WindowRole } from '@/platform/windowRole'
import { needEditSetting } from '@/stores/settingActions'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  type FIRST_RUN_PATH,
  type FirstRunResolution,
  firstRunRedirect,
  resolveFirstRun,
  setFirstRun,
} from './firstRun'

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
 * is `jobs` (main on desktop; the only window on web and mobile). `from` is where to return (path, query and hash).
 *
 * Without a record, the main window also writes one once: an upgrade (a model already configured) is marked
 * completed, so removing every model later shows only step 1; a new user without a model is recorded at step 1, so
 * a model added from Settings resumes at step 2 rather than reading as an upgrade.
 *
 * Returns whether a redirect is pending: the role is still unknown while this path would redirect the main window, or
 * the redirect was sent and the location has not moved yet. The root paints nothing in place of the page meanwhile,
 * so a new user never sees Review before first run.
 */
export function useFirstRunGate(
  pathname: string,
  navigate: (to: typeof FIRST_RUN_PATH, from: string) => void,
  from: string = pathname
): boolean {
  const record = useSettingsStore((s) => s.firstRun)
  const hasModel = useSettingsStore(() => !needEditSetting())
  const resolution = useMemo(() => resolveFirstRun(record, hasModel), [record, hasModel])
  const [role, setRole] = useState<WindowRole | undefined>(() => knownWindowRole())
  const recorded = useRef(false)

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
    if (role !== 'jobs' || record || recorded.current) return
    recorded.current = true
    setFirstRun(hasModel ? { step: 5, completedAt: Date.now() } : { step: 1 })
  }, [role, record, hasModel])

  useLayoutEffect(() => {
    if (!role) return
    const to = firstRunRedirect(pathname, role !== 'jobs', resolution)
    if (to) navigate(to, from)
  }, [pathname, from, role, resolution, navigate])

  if (role !== undefined && role !== 'jobs') return false
  return firstRunRedirect(pathname, false, resolution) !== null
}
