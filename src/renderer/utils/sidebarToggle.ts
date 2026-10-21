import type { LayoutMode } from '@/hooks/useLayoutMode'

export type SidebarLayout = 'expanded' | 'rail'

export type SidebarToggleState = {
  mode: LayoutMode
  sidebarLayout: SidebarLayout
  showSidebar: boolean
  railPeek: boolean
}

export type SidebarToggleResult = Pick<SidebarToggleState, 'sidebarLayout' | 'showSidebar' | 'railPeek'>

/**
 * The sidebar toggle (Header, Page, ⌘\): medium opens or closes the rail peek and never writes the saved layout; wide
 * flips between expanded and rail and clears any peek; phone has no sidebar to toggle.
 */
export function getSidebarToggleResult({
  mode,
  sidebarLayout,
  showSidebar,
  railPeek,
}: SidebarToggleState): SidebarToggleResult {
  if (mode === 'medium') {
    return { sidebarLayout, showSidebar, railPeek: !railPeek }
  }
  if (mode === 'wide') {
    return { sidebarLayout: sidebarLayout === 'rail' ? 'expanded' : 'rail', showSidebar: true, railPeek: false }
  }
  return { sidebarLayout, showSidebar, railPeek }
}
