import { useLayoutEffect, useSyncExternalStore } from 'react'
import { uiStore } from '@/stores/uiStore'
import { getSidebarToggleResult } from '@/utils/sidebarToggle'

/** Window size class (RS1–RS3). Layout depends on width only, never on the platform's form factor. */
export type LayoutMode = 'wide' | 'medium' | 'phone'

export const LAYOUT_WIDE_MIN = 1200
export const LAYOUT_MEDIUM_MIN = 760

/** Icon rail width (px) at medium and when collapsed at wide. */
export const SIDEBAR_RAIL_WIDTH = 56

export function layoutModeForWidth(width: number): LayoutMode {
  if (width >= LAYOUT_WIDE_MIN) return 'wide'
  if (width >= LAYOUT_MEDIUM_MIN) return 'medium'
  return 'phone'
}

export type SidebarPresentation = {
  show: 'expanded' | 'rail' | 'overlay' | 'none'
  drawerWidth: number
  contentInset: number
}

/**
 * How the sidebar is drawn for a mode: wide follows the user's layout; medium is always the rail; a rail peek lays the
 * expanded sidebar over the content without moving it; phone has no sidebar (the tab bar replaces it).
 * At wide + expanded a stale peek is ignored, so widening never leaves an overlay behind.
 */
export function sidebarPresentation(i: {
  mode: LayoutMode
  sidebarLayout: 'expanded' | 'rail'
  railPeek: boolean
  expandedWidth: number
}): SidebarPresentation {
  if (i.mode === 'phone') return { show: 'none', drawerWidth: 0, contentInset: 0 }
  if (i.mode === 'wide' && i.sidebarLayout === 'expanded') {
    return { show: 'expanded', drawerWidth: i.expandedWidth, contentInset: i.expandedWidth }
  }
  if (i.railPeek) return { show: 'overlay', drawerWidth: i.expandedWidth, contentInset: SIDEBAR_RAIL_WIDTH }
  return { show: 'rail', drawerWidth: SIDEBAR_RAIL_WIDTH, contentInset: SIDEBAR_RAIL_WIDTH }
}

// One live mode for the whole window, driven by resize.

function readWidth(): number {
  return typeof window === 'undefined' ? LAYOUT_WIDE_MIN : window.innerWidth
}

let currentMode: LayoutMode = layoutModeForWidth(readWidth())
let attributeSuppressed = false
let caughtUp = false
const listeners = new Set<() => void>()

/** Mode changes close transient sidebar states, so nothing is left floating over the new layout. */
function closeTransientSidebar(mode: LayoutMode) {
  const state = uiStore.getState()
  if (state.railPeek) state.setRailPeek(false)
  // The phone drawer is a temporary one with a scrim; never carry it open into (or out of) a resize.
  if (mode === 'phone' && state.showSidebar) state.setShowSidebar(false)
}

function syncLayoutAttribute() {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (attributeSuppressed || root.dataset.quickChat === '1') {
    delete root.dataset.layout
  } else if (root.dataset.layout !== currentMode) {
    root.dataset.layout = currentMode
  }
}

function refresh() {
  const next = layoutModeForWidth(readWidth())
  if (next === currentMode) return
  currentMode = next
  closeTransientSidebar(next)
  syncLayoutAttribute()
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener('resize', refresh)
  listeners.add(listener)
  // Catch up with a resize that happened while nothing was listening.
  refresh()
  if (!caughtUp) {
    caughtUp = true
    // A desktop window opened narrow starts with the phone drawer closed.
    if (currentMode === 'phone') closeTransientSidebar(currentMode)
  }
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) window.removeEventListener('resize', refresh)
  }
}

function getSnapshot(): LayoutMode {
  return currentMode
}

/**
 * The window's layout mode, following resizes. Also keeps `data-layout` on `<html>` in step, except in the Quick Chat
 * window (`data-quick-chat="1"`) or while suppressed (see setLayoutAttributeSuppressed).
 */
export function useLayoutMode(): LayoutMode {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-sync the attribute whenever the mode changes
  useLayoutEffect(() => {
    syncLayoutAttribute()
  }, [mode])
  return mode
}

/**
 * The root turns `data-layout` off where the app shell is not shown: the Quick Chat window (known only once its label
 * resolves) and the full-window first run.
 */
export function setLayoutAttributeSuppressed(suppressed: boolean) {
  attributeSuppressed = suppressed
  syncLayoutAttribute()
}

/** ⌘\ and the Header toggle: open or close the peek at medium, expand or collapse at wide; nothing at phone. */
export function toggleSidebar(mode: LayoutMode = currentMode) {
  const state = uiStore.getState()
  const next = getSidebarToggleResult({
    mode,
    sidebarLayout: state.sidebarLayout,
    showSidebar: state.showSidebar,
    railPeek: state.railPeek,
  })
  state.setSidebarLayout(next.sidebarLayout)
  state.setShowSidebar(next.showSidebar)
  state.setRailPeek(next.railPeek)
}
