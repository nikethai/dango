import type { LayoutMode } from '@/hooks/useLayoutMode'

export type SidebarLayout = 'expanded' | 'rail'

export type SidebarToggleState = {
  mode: LayoutMode
  sidebarLayout: SidebarLayout
  railPeek: boolean
}

export type SidebarToggleResult = Pick<SidebarToggleState, 'sidebarLayout' | 'railPeek'>

/**
 * The sidebar toggle (Header, Page, ⌘\): medium opens or closes the rail peek and never writes the saved layout; wide
 * flips between expanded and rail and clears any peek; phone has no sidebar to toggle.
 */
export function getSidebarToggleResult({ mode, sidebarLayout, railPeek }: SidebarToggleState): SidebarToggleResult {
  if (mode === 'medium') {
    return { sidebarLayout, railPeek: !railPeek }
  }
  if (mode === 'wide') {
    return { sidebarLayout: sidebarLayout === 'rail' ? 'expanded' : 'rail', railPeek: false }
  }
  return { sidebarLayout, railPeek }
}

/**
 * The toggle's name where it shows (medium, and the rail at wide): Expand at wide, Show or Hide the peek at medium.
 * Header, Page and the rail foot share it.
 */
export function sidebarToggleLabel(t: (key: string) => string, mode: LayoutMode, railPeek: boolean): string {
  if (mode === 'wide') return t('Expand sidebar')
  return railPeek ? t('Hide sidebar') : t('Show sidebar')
}
