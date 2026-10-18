import { FORCE_ENABLE_DEV_PAGES } from '@/dev/devToolsConfig'
import platform, { platformCapabilities } from '@/platform'
import { featureFlags } from '@/utils/feature-flags'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import type { SettingsNavAvailability } from './settingsNavModel'

export function currentSettingsNavAvailability(): SettingsNavAvailability {
  return {
    agents:
      platformCapabilities.supportsDesktopOnlySettings &&
      platform.type === 'desktop' &&
      CHATBOX_BUILD_PLATFORM !== 'android',
    mcp: !!featureFlags.mcp,
    knowledgeBase: !!featureFlags.knowledgeBase,
    hotkeys: !platformCapabilities.isMobileLayout,
    devTools: FORCE_ENABLE_DEV_PAGES,
  }
}
