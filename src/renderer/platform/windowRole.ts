import platform, { platformCapabilities } from '@/platform'

/**
 * What this window may do: `jobs` runs background jobs and acts on sources (main on desktop, the only window on web
 * and mobile, R6); `quick` is the desktop quick window; `other` is any other desktop window, or one whose label could
 * not be read. Only `jobs` acts; the others send configuration to the main window.
 */
export type WindowRole = 'jobs' | 'quick' | 'other'

/** The role when it is known without asking: `jobs` off desktop, undefined on desktop until the label is read. */
export function knownWindowRole(): WindowRole | undefined {
  return platformCapabilities.supportsDesktopOnlySettings ? undefined : 'jobs'
}

/** Reads this window's role. On desktop, a missing or failing label lookup is `other`: it never runs jobs. */
export async function getWindowRole(): Promise<WindowRole> {
  const known = knownWindowRole()
  if (known) return known
  const getLabel = platform.getWindowLabel?.bind(platform)
  if (!getLabel) return 'other'
  try {
    const label = await getLabel()
    return label === 'main' ? 'jobs' : label === 'quick' ? 'quick' : 'other'
  } catch {
    return 'other'
  }
}
