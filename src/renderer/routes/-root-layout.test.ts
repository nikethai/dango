import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (p: string) => readFileSync(resolve(__dirname, '..', p), 'utf8')

describe('__root layout wiring (RS1, RS2)', () => {
  const root = read('routes/__root.tsx')

  it('gives the content box id="main" and tabIndex -1 (sheet focus fallback)', () => {
    expect(root).toMatch(/<Box id="main" tabIndex=\{-1\}/)
  })

  it('insets the content from the sidebar presentation in at most 150 ms, with no motion when reduced', () => {
    expect(root).toContain('useSidebarEffectiveWidth()')
    expect(root).toContain("transition: 'padding 150ms")
    expect(root).toContain("'@media (prefers-reduced-motion: reduce)': { transition: 'none' }")
    expect(root).not.toContain('220ms')
  })

  it('turns data-layout off in the Quick Chat window and on first run', () => {
    expect(root).toContain('useLayoutMode()')
    expect(root).toContain('const suppressLayoutAttribute = isQuickRoute || isFirstRunRoute')
    expect(root).toContain('setLayoutAttributeSuppressed(suppressLayoutAttribute)')
  })
})

describe('sidebar toggles', () => {
  it('Header and Page show the toggle at medium and wide-rail only, never at phone', () => {
    for (const file of ['components/layout/Header.tsx', 'components/layout/Page.tsx']) {
      const src = read(file)
      expect(src, file).toContain("layoutMode === 'medium' || (layoutMode === 'wide' && sidebarLayout === 'rail')")
      expect(src, file).toContain('toggleSidebar(layoutMode)')
      expect(src, file).not.toContain('getSidebarToggleResult')
    }
  })

  it('⌘\\ toggles the sidebar', () => {
    const src = read('hooks/useShortcut.tsx')
    expect(src).toContain("e.key === '\\\\' && ctrlKey")
    expect(src).toContain('toggleSidebar()')
  })

  it('useIsSmallScreen follows the layout mode, not the MUI sm breakpoint', () => {
    const src = read('hooks/useScreenChange.ts')
    expect(src).not.toMatch(/breakpoints\.down\('sm'\)/)
    expect(src).toContain("return useLayoutMode() === 'phone'")
  })
})
