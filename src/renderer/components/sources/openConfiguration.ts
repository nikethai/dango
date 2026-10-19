import platform from '@/platform'
import { getWindowRole } from '@/platform/windowRole'

/**
 * Opens a configuration route where configuring happens: in the main window when called from any other desktop
 * window (quick or other), else here.
 */
export async function openConfiguration(to: string): Promise<void> {
  if (platform.openInMain && (await getWindowRole()) !== 'jobs') {
    try {
      await platform.openInMain(to)
      return
    } catch (error) {
      console.error('[sources] Could not open the main window', error)
    }
  }
  // Loaded on demand: the router pulls in every route.
  const { router } = await import('@/router')
  await router.navigate({ to: to as never })
}
