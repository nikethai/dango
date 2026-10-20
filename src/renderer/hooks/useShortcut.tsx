import { getDefaultStore } from 'jotai'
import { useEffect } from 'react'
import { hasOpenSheet, topSheet } from '@/components/ui/useSheetFocus'
import { startNewChat } from '@/lib/startNewChat'
import { navigateToSettings } from '@/modals/Settings'
import { newChatScopeId } from '@/projects/scope-navigation'
import { router } from '@/router'
import { uiStore } from '@/stores/uiStore'
import { getOS } from '../packages/navigator'
import platform from '../platform'
import { currentSessionIdAtom } from '../stores/atoms'
import { startNewThread, switchToIndex, switchToNext } from '../stores/sessionActions'
import * as dom from './dom'
import { useIsSmallScreen } from './useScreenChange'

export default function useShortcut() {
  const isSmallScreen = useIsSmallScreen()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keyboardShortcut(e)
    }
    const focusMessageInput = () => {
      // (legacy comment removed)
      if (!isSmallScreen) {
        dom.focusMessageInput()
      }
    }
    const cancelOnFocus = platform.onWindowFocused(focusMessageInput)
    const cancelOnShow = platform.onWindowShow(focusMessageInput)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      cancelOnFocus()
      cancelOnShow()
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [isSmallScreen])

  function keyboardShortcut(e: KeyboardEvent) {
    // e.key alt、 option、shift e.key
    const ctrlOrCmd = e.ctrlKey || e.metaKey
    const shift = e.shiftKey
    const altOrOption = e.altKey

    const ctrlKey = getOS() === 'Mac' ? e.metaKey : e.ctrlKey

    if (e.key === 'i' && ctrlKey) {
      dom.focusMessageInput()
      return
    }
    if (e.key === 'e' && ctrlKey) {
      dom.focusMessageInput()
      // Toggle session-level web browsing mode using cached display value
      const sessionId = getDefaultStore().get(currentSessionIdAtom) || 'new'
      uiStore.getState().toggleSessionWebBrowsing(sessionId)
      return
    }

    // Create a genuinely new conversation; do not let Settings restore the previous session.
    // CmdOrCtrl + N
    if (e.key === 'n' && ctrlKey && !shift) {
      const { pathname, search } = router.state.location
      startNewChat({ scopeId: newChatScopeId(pathname, search) })
      return
    }
    // CmdOrCtrl + Shift + N
    if (e.key === 'n' && ctrlKey && shift) {
      router.navigate({
        to: '/image-creator',
      })
      return
    }
    // (legacy comment removed)
    if (e.key === 'r' && ctrlKey) {
      e.preventDefault()
      const sid = getDefaultStore().get(currentSessionIdAtom)
      if (sid) {
        void startNewThread(sid)
      }
      return
    }

    if (e.code === 'Tab' && ctrlKey && !shift) {
      switchToNext()
    }
    if (e.code === 'Tab' && ctrlKey && shift) {
      switchToNext(true)
    }
    for (let i = 1; i <= 9; i++) {
      if (e.code === `Digit${i}` && ctrlKey) {
        switchToIndex(i - 1)
      }
    }

    if (e.key === 'k' && ctrlKey) {
      e.preventDefault()
      const { openSearchDialog, setOpenSearchDialog } = uiStore.getState()
      if (openSearchDialog) {
        // Close only when the overlay is the top layer; a sheet above it keeps the keys.
        const top = topSheet()
        if (!top || top.classList.contains('dg-search')) setOpenSearchDialog(false)
      } else if (!hasOpenSheet()) {
        // A sheet (e.g. a permission request) is modal: the overlay must not cover it.
        setOpenSearchDialog(true)
      }
    }
    if (e.key === ',' && ctrlKey) {
      e.preventDefault()
      navigateToSettings()
      return
    }
  }
}
