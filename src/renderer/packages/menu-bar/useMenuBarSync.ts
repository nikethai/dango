import { readBackgroundPaused } from '@shared/types/settings'
import { useEffect, useRef } from 'react'
import i18n from '@/i18n'
import { loadReviewEntries, useLastCheckedAt, useReviewWaitingCount } from '@/packages/review'
import platform, { platformCapabilities } from '@/platform'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { computeTrayStatus } from './tray-status'

const MINUTE_MS = 60_000

/**
 * Pushes the menu bar / tray status (mood, status line, pause label) to the native shell from the main window.
 * Re-pushes on every input change and once a minute (for the "checked" text); the minute tick and
 * `session:changed` also reload Review entries so rows written by the quick window reach this hidden window.
 */
export function useMenuBarSync(): void {
  const waiting = useReviewWaitingCount()
  const lastCheckedAt = useLastCheckedAt()
  const paused = readBackgroundPaused(useSettingsStore((s) => s.backgroundPaused))
  // Latest inputs for the minute tick and the toggle handler, without re-creating the interval.
  const latest = useRef({ waiting, lastCheckedAt, paused })
  latest.current = { waiting, lastCheckedAt, paused }
  const pushRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let disposed = false
    let interval: ReturnType<typeof setInterval> | undefined
    let unlistenToggle: (() => void) | undefined
    let unlistenSession: (() => void) | undefined

    const push = () => {
      if (disposed) return
      const status = computeTrayStatus({ ...latest.current, now: Date.now() }, (key, opts) =>
        String(i18n.t(key, opts as Record<string, unknown>))
      )
      void Promise.resolve(platform.setTrayStatus?.(status)).catch(() => undefined)
    }

    void (async () => {
      if (!platformCapabilities.supportsDesktopOnlySettings || !platform.setTrayStatus) return
      let label: string | undefined
      try {
        label = await platform.getWindowLabel?.()
      } catch {
        return
      }
      if (disposed || label !== 'main') return
      pushRef.current = push
      push()
      interval = setInterval(() => {
        void loadReviewEntries().catch(() => undefined)
        push()
      }, MINUTE_MS)
      unlistenToggle = platform.onTrayPauseToggle?.(() => {
        const state = settingsStore.getState()
        state.setSettings({ backgroundPaused: !readBackgroundPaused(state.backgroundPaused) })
      })
      try {
        const { listen } = await import('@tauri-apps/api/event')
        const dispose = await listen('session:changed', () => void loadReviewEntries().catch(() => undefined))
        if (disposed) dispose()
        else unlistenSession = dispose
      } catch {
        // not running under Tauri
      }
    })()

    return () => {
      disposed = true
      pushRef.current = null
      if (interval) clearInterval(interval)
      unlistenToggle?.()
      unlistenSession?.()
    }
  }, [])

  // biome-ignore lint/correctness/useExhaustiveDependencies: inputs are the trigger; push reads them via the ref
  useEffect(() => {
    pushRef.current?.()
  }, [waiting, lastCheckedAt, paused])
}
