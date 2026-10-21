import { messageInputID } from '@/hooks/dom'

// Tauri Android keyboard handling.
//
// Problem: The soft keyboard covers bottom-positioned elements:
//  1. Vaul bottom-sheet drawers (Add Provider, selectors, etc.)
//  2. Chat input box at the bottom of the page
//
// adjustResize in the AndroidManifest shrinks the layout viewport when the
// IME opens. Since Vaul drawers use `position:fixed; bottom:0`, they sit on
// the bottom edge of that *shrunk* viewport — i.e. they automatically rest
// above the keyboard with NO JS help required.
//
// Earlier versions of this file tried to push drawers up via
// `drawer.style.bottom = kbHeight` based on visualViewport measurements.
// That fights the OS: visualViewport.resize fires before window.resize, so
// we'd push the drawer up via JS, then window.resize would arrive and we'd
// remove the JS push, then the OS layout would settle one frame later —
// causing the visible "flash → drop → push up" 3-step glitch.
//
// Current approach:
//  - Do NOT touch drawer styles at all. Trust adjustResize.
//  - Still expose --keyboard-inset-height for any consumers that want it.
//  - Do NOT manually move the chat input either. Trust adjustResize there too.
//    A second JS movement causes the visible two-phase jump on Android.
//  - Still scroll non-message inputs (e.g. inside drawers) into view if they
//    end up below the visible viewport, but scroll the drawer's own scroller
//    rather than the document.

export function setupKeyboardHandler() {
  const vv = window.visualViewport
  const root = document.documentElement
  let fullVisualHeight = vv?.height || window.innerHeight
  let fullWindowHeight = window.innerHeight
  let focusStabilizer: ReturnType<typeof setInterval> | null = null

  // Track keyboard-visible state so we only mutate the safe-area var on
  // transitions (avoid spamming the style on every viewport tick).
  let kbVisible = false

  // Forget the remembered full heights: rotating, split-screen or a window resize with nothing focused is not the IME.
  function resetBaseline() {
    fullVisualHeight = vv?.height || window.innerHeight
    fullWindowHeight = window.innerHeight
  }

  // data-keyboard="open" hides the phone tab bar (dango-layout.css). Only a focused field with a shrunk viewport counts,
  // so a landscape or split-screen window never loses its navigation.
  function syncKeyboardFlag() {
    if (kbVisible && isEditable(document.activeElement as HTMLElement | null)) {
      root.dataset.keyboard = 'open'
    } else {
      delete root.dataset.keyboard
    }
  }

  function getKeyboardHeight(): number {
    // The IME only opens for a focused field; without one, any shrink is a new window size.
    if (!isEditable(document.activeElement as HTMLElement | null)) {
      resetBaseline()
      return 0
    }

    if (vv && vv.height > fullVisualHeight) {
      fullVisualHeight = vv.height
    }

    if (window.innerHeight > fullWindowHeight) {
      fullWindowHeight = window.innerHeight
    }

    const visualHeight = vv?.height || window.innerHeight
    const fromVisualViewport = Math.round(fullVisualHeight - visualHeight)
    const fromWindowResize = Math.round(fullWindowHeight - window.innerHeight)
    const kbHeight = Math.max(fromVisualViewport, fromWindowResize)
    return kbHeight > 100 ? kbHeight : 0
  }

  function onViewportChange() {
    const kbHeight = getKeyboardHeight()
    const visualHeight = vv?.height || window.innerHeight
    const visibleBottom = Math.min(visualHeight, window.innerHeight)

    // Set CSS custom property for anything that wants to react
    root.style.setProperty('--keyboard-inset-height', `${kbHeight}px`)

    // Collapse only the app-layout bottom safe-area while the IME is visible.
    // Keep the base safe-area var stable so Vaul drawers and other overlays do
    // not lose/re-add their bottom spacer mid-animation, which causes flashing.
    // The main app shell reads this override var with a fallback to the base
    // safe-area value.
    const nowVisible = kbHeight > 0
    if (nowVisible && !kbVisible) {
      root.style.setProperty('--mobile-safe-area-inset-bottom-layout', '0px')
      kbVisible = true
    } else if (!nowVisible && kbVisible) {
      root.style.removeProperty('--mobile-safe-area-inset-bottom-layout')
      kbVisible = false
    }
    syncKeyboardFlag()

    // Chat input offset:
    // AndroidManifest uses adjustResize, so the OS already moves in-flow
    // content like the chat composer above the IME. Any extra JS lift creates
    // the exact two-phase "push, then push again" behavior the user sees.
    root.style.setProperty('--input-box-keyboard-offset', '0px')

    // Scroll focused input into visible area only if it's truly below the
    // visible viewport. Skip the chat composer (it has its own handling).
    // For inputs inside a Vaul drawer, scroll the drawer's own scroller.
    if (kbHeight > 0) {
      requestAnimationFrame(() => {
        const el = document.activeElement as HTMLElement | null
        if (el && isEditable(el)) {
          if (el.id === messageInputID) return
          const rect = el.getBoundingClientRect()
          if (rect.bottom > visibleBottom - 16) {
            const drawerEl = el.closest<HTMLElement>('[data-vaul-drawer]')
            if (drawerEl) {
              const scrollable = drawerEl.querySelector<HTMLElement>('.overflow-y-auto')
              if (scrollable) {
                const scrollRect = scrollable.getBoundingClientRect()
                if (rect.bottom > scrollRect.bottom) {
                  scrollable.scrollTop += rect.bottom - scrollRect.bottom + 16
                }
                return
              }
            }
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }
      })
    }
  }

  if (vv) {
    vv.addEventListener('resize', onViewportChange)
    vv.addEventListener('scroll', onViewportChange)
  }
  window.addEventListener('resize', onViewportChange)

  // A rotation changes the full height; measure again from the new size.
  const onOrientationChange = () => {
    resetBaseline()
    onViewportChange()
  }
  screen.orientation?.addEventListener?.('change', onOrientationChange)
  window.addEventListener('orientationchange', onOrientationChange)

  // When an input gains focus, wait for keyboard animation then recompute.
  // Use a single delayed measurement instead of a polling interval to avoid
  // re-running viewport math (and any side effects) every 120ms while the
  // IME settles — that polling was a contributing source of flicker.
  document.addEventListener(
    'focus',
    (e) => {
      const el = e.target as HTMLElement | null
      if (!el || !isEditable(el)) return
      // Moving between fields with the IME still up: keep the tab bar hidden (blur cleared the flag just before).
      syncKeyboardFlag()

      if (focusStabilizer) {
        clearInterval(focusStabilizer)
        focusStabilizer = null
      }

      setTimeout(() => {
        if (el.id === messageInputID) {
          onViewportChange()
          return
        }
        const rect = el.getBoundingClientRect()
        const visualHeight = vv?.height || window.innerHeight
        const visibleBottom = Math.min(visualHeight, window.innerHeight)
        if (rect.bottom > visibleBottom - 16) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }
        onViewportChange()
      }, 350)
    },
    true
  )

  document.addEventListener(
    'blur',
    (_e) => {
      if (focusStabilizer) {
        clearInterval(focusStabilizer)
        focusStabilizer = null
      }
      // Nothing is being typed into any more: never leave the tab bar hidden.
      delete root.dataset.keyboard
    },
    true
  )

  window.addEventListener(
    'keydown',
    (e) => {
      const isBackLike =
        e.key === 'Escape' ||
        e.key === 'Back' ||
        e.key === 'GoBack' ||
        e.code === 'Escape' ||
        e.keyCode === 4 ||
        e.keyCode === 27

      if (!isBackLike) return
      const active = document.activeElement as HTMLElement | null
      if (active?.id !== messageInputID) return

      // Some Android WebViews close IME on Back without blurring textarea.
      active.blur()
      setTimeout(onViewportChange, 80)
    },
    true
  )

  root.style.setProperty('--keyboard-inset-height', '0px')
  root.style.setProperty('--input-box-keyboard-offset', '0px')
}

function isEditable(el: HTMLElement | null): boolean {
  if (!el) return false
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable
}

setupKeyboardHandler()
