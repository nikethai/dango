import { getDefaultStore } from 'jotai'
import { getLastLocationOutsideSettings, router } from '@/router'
import { currentSessionIdAtom } from '@/stores/atoms'
import { sessionExistsInStorage } from '@/stores/chatStore'
import {
  getSettingsParentPath,
  resolveSettingsEntryPath,
  resolveSettingsExit,
  settingsOpenerHref,
} from '@/utils/settings-navigation'

export { getSettingsParentPath }

/**
 * Open Settings as a full-page route under `/settings/*`.
 * Desktop and mobile share the same navigation model (not a modal).
 */
export function navigateToSettings(path?: string) {
  const to = resolveSettingsEntryPath(path)
  // TanStack typed routes: cast because path is dynamic (provider id, etc.)
  void router.navigate({ to: to as '/settings/provider' })
}

/**
 * Leave settings and return to the page it was opened from; from a chat (or on cold entry), the last chat session,
 * or home if none. Prefer this over history.back() so deep links and cold entry always exit cleanly.
 */
export async function closeSettings() {
  const openerHref = settingsOpenerHref(getLastLocationOutsideSettings())
  if (openerHref) {
    void router.navigate({ href: openerHref })
    return
  }
  const store = getDefaultStore()
  const sessionId = store.get(currentSessionIdAtom)
  const target = await resolveSettingsExit(sessionId, sessionExistsInStorage)
  if (target.to === '/session/$sessionId' && target.params) {
    void router.navigate({ to: target.to, params: target.params })
    return
  }
  if (sessionId) {
    store.set(currentSessionIdAtom, null)
  }
  void router.navigate({ to: target.to })
}
