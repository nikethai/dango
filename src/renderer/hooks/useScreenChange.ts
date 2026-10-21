import { useMantineTheme } from '@mantine/core'
import { useTheme } from '@mui/material/styles'
import useMediaQuery from '@mui/material/useMediaQuery'
import { useUIStore } from '../stores/uiStore'
import { SIDEBAR_RAIL_WIDTH, sidebarPresentation, useLayoutMode } from './useLayoutMode'

/** Icon-only rail width (px). Expanded width uses useSidebarWidth(). */
export const SIDEBAR_ICON_RAIL_WIDTH = SIDEBAR_RAIL_WIDTH

/** Phone layout (< 760 px wide). */
export function useIsSmallScreen() {
  return useLayoutMode() === 'phone'
}

export function useScreenDownToMD() {
  const theme = useTheme()
  return useMediaQuery(theme.breakpoints.down('md'))
}

export function useIsLargeScreen() {
  const theme = useTheme()
  return !useMediaQuery(theme.breakpoints.down('lg'))
}

/** Expanded sidebar width: the user's dragged width, else 220 px (README Layout) at every non-phone width. */
export function useSidebarWidth() {
  const mantineTheme = useMantineTheme()
  const scale = mantineTheme.scale ?? 1
  const customWidth = useUIStore((s) => s.sidebarWidth)
  return customWidth ?? 220 * scale
}

/** How far the main content sits from the window edge: the docked sidebar or rail, 0 at phone. */
export function useSidebarEffectiveWidth() {
  const mode = useLayoutMode()
  const expandedWidth = useSidebarWidth()
  const sidebarLayout = useUIStore((s) => s.sidebarLayout)
  const railPeek = useUIStore((s) => s.railPeek)
  return sidebarPresentation({ mode, sidebarLayout, railPeek, expandedWidth }).contentInset
}

export function useInputBoxHeight(): { min: number; max: number } {
  const theme = useTheme()
  const sm = useMediaQuery(theme.breakpoints.up('sm'))
  const md = useMediaQuery(theme.breakpoints.up('md'))
  // const lg = useMediaQuery(theme.breakpoints.up('lg'))
  const xl = useMediaQuery(theme.breakpoints.up('xl'))
  if (xl) {
    return { min: 96, max: 480 }
  } else if (md) {
    return { min: 72, max: 384 }
  } else if (sm) {
    return { min: 56, max: 288 }
  } else {
    return { min: 32, max: 192 }
  }
}
