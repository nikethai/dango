import { ensureDefaultChatModel } from '@/packages/first-run/ensureDefaultChatModel'
import { getWindowRole } from '@/platform/windowRole'
import { settingsStore } from '@/stores/settingsStore'

let started = false

/**
 * Main window only (the quick window never writes settings on its own): saves the obvious default chat model now and
 * whenever providers change, so every way of setting up a model leaves a default.
 */
export async function initDefaultModelWatch(): Promise<void> {
  if (started) return
  if ((await getWindowRole()) !== 'jobs' || started) return
  started = true
  ensureDefaultChatModel()
  settingsStore.subscribe((state, prev) => {
    if (state.providers !== prev.providers || state.customProviders !== prev.customProviders) ensureDefaultChatModel()
  })
}
