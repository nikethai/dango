import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import postcss, { type AtRule, type Rule } from 'postcss'
import { describe, expect, test } from 'vitest'
import { createDangoMantineTheme } from './mantineTheme'

const layoutRoot = postcss.parse(readFileSync(resolve(process.cwd(), 'src/renderer/static/dango-layout.css'), 'utf8'))

const normalize = (selector: string) => selector.replace(/\s+/g, ' ').trim()

// The value of `prop` in the last rule (outside any at-rule) whose selector list contains `selector`.
const valueFor = (selector: string, prop: string): string | undefined => {
  let value: string | undefined
  layoutRoot.walkRules((rule: Rule) => {
    if (rule.parent?.type !== 'root') return
    if (!rule.selectors.map(normalize).includes(selector)) return
    rule.walkDecls(prop, (decl) => {
      // Formatter line breaks inside var( … ) don't change the value.
      value = decl.value.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim()
    })
  })
  return value
}

const SAFE_BOTTOM =
  'var(--mobile-safe-area-inset-bottom-layout, var(--mobile-safe-area-inset-bottom, env(safe-area-inset-bottom)))'

describe('phone shell rules (RS3)', () => {
  test('the tab bar, not .App, pads the safe-area bottom at phone, only where the tab bar shows (not first run)', () => {
    expect(valueFor(':root[data-layout="phone"][data-tabbar] .App', 'padding-bottom')).toBe('0')
    // Without the tab bar (first run) .App keeps its safe-area padding.
    expect(valueFor(':root[data-layout="phone"] .App', 'padding-bottom')).toBeUndefined()
    expect(valueFor('.dg-tabbar', 'padding-bottom')).toBe(SAFE_BOTTOM)
  })

  test('the tab bar hides while the on-screen keyboard is open', () => {
    expect(valueFor(':root[data-keyboard="open"] .dg-tabbar', 'display')).toBe('none')
  })

  test('tabs are at least 44 px tall', () => {
    expect(valueFor('.dg-tabbar a', 'min-height')).toBe('44px')
  })

  test('buttons and rows are at least 44 px at phone; icon buttons are also 44 px wide', () => {
    for (const cls of [
      '.dg-btn',
      '.dg-btn--icon',
      '.rail-icon-btn',
      '.dg-side__row',
      '.rail-nav-item',
      '.studio-rail-row',
      '.project-folder-row',
      '.mantine-ActionIcon-root',
    ]) {
      expect(valueFor(`:root[data-layout="phone"] ${cls}`, 'min-height'), cls).toBe('44px')
    }
    for (const cls of ['.dg-btn--icon', '.rail-icon-btn', '.mantine-ActionIcon-root']) {
      expect(valueFor(`:root[data-layout="phone"] ${cls}`, 'min-width'), cls).toBe('44px')
    }
  })

  test('more phone targets (Task 12 walk): Mantine buttons and tabs, any tab, the artifact card', () => {
    for (const cls of [
      '.mantine-Button-root',
      '.mantine-Tabs-tab',
      '[role="tab"]',
      '.artifact-card',
      '.settings-tabs a',
    ]) {
      expect(valueFor(`:root[data-layout="phone"] ${cls}`, 'min-height'), cls).toBe('44px')
    }
  })

  test('first run at phone: text fields and the "other providers" link are 44 px too (I2)', () => {
    for (const cls of ['.dg-first-run .mantine-Input-input', '.dg-first-run__other']) {
      expect(valueFor(`:root[data-layout="phone"] ${cls}`, 'min-height'), cls).toBe('44px')
    }
  })

  test('compact controls keep their look and get a 44 px hit area at phone (chips, status line, settings chrome)', () => {
    for (const cls of ['button.dg-chip', '.session-statusline-action']) {
      expect(valueFor(`:root[data-layout="phone"] ${cls}`, 'position'), cls).toBe('relative')
      expect(valueFor(`:root[data-layout="phone"] ${cls}::after`, 'height'), cls).toBe('44px')
      expect(valueFor(`:root[data-layout="phone"] ${cls}::after`, 'content'), cls).toBe('""')
    }
    // 32 px button + 6 px on each side.
    expect(valueFor(':root[data-layout="phone"] .settings-chrome-btn::after', 'inset')).toBe('-6px')
  })

  test('tab colours: active green text, inactive muted, raised surface, hairline top border', () => {
    // More specific than index.css's html[data-theme='dark'] a, which would otherwise win.
    expect(valueFor('.dg-tabbar a.dg-tabbar__tab', 'color')).toBe('var(--dango-muted)')
    expect(valueFor('.dg-tabbar a.dg-tabbar__tab[aria-current="page"]', 'color')).toBe('var(--dango-green-text)')
    expect(valueFor('.dg-tabbar', 'background')).toBe('var(--dango-raised)')
    expect(valueFor('.dg-tabbar', 'border-top')).toBe('1px solid var(--dango-hairline)')
  })
})

// Declarations (prop → value, with !important kept) of the rules inside @media (prefers-reduced-motion: reduce)
// whose selector list contains `selector`.
const reducedMotionDecls = (selector: string): Record<string, string> => {
  const decls: Record<string, string> = {}
  layoutRoot.walkAtRules('media', (media: AtRule) => {
    if (!/prefers-reduced-motion:\s*reduce/.test(media.params)) return
    media.walkRules((rule: Rule) => {
      if (!rule.selectors.map(normalize).includes(selector)) return
      rule.walkDecls((decl) => {
        decls[decl.prop] = `${decl.value}${decl.important ? ' !important' : ''}`
      })
    })
  })
  return decls
}

describe('reduced motion (A11Y1 rule 2)', () => {
  test('nothing animates or transitions: pending dots, thinking line, tab bar, drawer and rail peek, content, sheets', () => {
    for (const selector of [
      '.assistant-pending-dots i',
      '.dg-think',
      '.dg-think *',
      '.dg-tabbar',
      '.dg-tabbar *',
      // The sidebar drawer: expanded ↔ rail ↔ peek width (Task 5).
      '.MuiDrawer-paper',
      '.studio-rail *',
      // The content inset that follows the sidebar width (Task 5), and the content itself.
      '.dg-content',
      '#main',
      // Every sheet appears in place instead of rising or sliding, including the inspector sheet (Task 7).
      '.dg-sheet',
      '.dango-sheet--right',
      '.dango-inspector-sheet',
      '.dg-sheet-scrim',
      // Phone drawers and pickers (vaul: slideFromBottom, 500 ms) and their overlay fade.
      '[data-vaul-drawer]',
      '[data-vaul-overlay]',
      // Infinite pulses and entries in chat and the agent panel (globals.css).
      '.todo-app-glyph.is-progress',
      '.agent-status-dot.is-muted',
      '.msg-followups',
      // Spinners stop turning but stay visible; pulses hold full opacity.
      '.animate-spin',
      '.animate-pulse',
      // Task 12 walk: message actions slide in on hover, the chat column and the docked inspector change width
      // (the aside's inline width transition), the artifact card fades its hover.
      '.msg-actions',
      '.session-main-col',
      '.workspace-panel',
      '.artifact-card',
    ]) {
      const decls = reducedMotionDecls(selector)
      expect({ selector, animation: decls.animation }).toEqual({ selector, animation: 'none !important' })
      expect({ selector, transition: decls.transition }).toEqual({ selector, transition: 'none !important' })
    }
  })

  test('nothing waits on an end event: no catch-all rule, and the splash keeps its fade (index.tsx animationend)', () => {
    layoutRoot.walkAtRules('media', (media: AtRule) => {
      if (!/prefers-reduced-motion:\s*reduce/.test(media.params)) return
      media.walkRules((rule: Rule) => {
        for (const selector of rule.selectors.map(normalize)) {
          expect(selector).not.toMatch(/^(\*|html|body|:root)$|splash/)
        }
      })
    })
  })

  test('Mantine respects reduced motion (Modal, Menu, Popover, Tooltip and Collapse skip their transitions)', () => {
    expect(createDangoMantineTheme().respectReducedMotion).toBe(true)
  })

  test('rail buttons do not shrink when pressed', () => {
    expect(reducedMotionDecls('.studio-rail button:active').transform).toBe('none !important')
  })
})

describe('focus rings (A11Y1 rule 3, Task 12 walk)', () => {
  test('a first-run step title takes focus without a ring (it is not a control; first launch showed one)', () => {
    expect(valueFor('.dg-first-run__title:focus', 'outline')).toBe('none')
  })

  test('scrollers that take Tab (react-virtuoso lists) show the focus ring', () => {
    expect(valueFor('[data-virtuoso-scroller]:focus-visible', 'outline')).toBe('2px solid var(--dango-focus)')
  })

  test('the knowledge row toggle is reset by a class, so the focus ring still applies', () => {
    expect(valueFor('.dango-knowledge-toggle', 'all')).toBe('unset')
    expect(valueFor('.dango-knowledge-toggle:focus-visible', 'outline')).toBe('2px solid var(--dango-focus)')
  })

  test('no inline all: unset on an element (it removes the focus ring)', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((f) => {
        const p = join(dir, f)
        return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(f) && !/\.test\.tsx$/.test(f) ? [p] : []
      })
    const offenders = walk(resolve(process.cwd(), 'src/renderer')).filter((p) =>
      /all:\s*['"]unset['"]/.test(readFileSync(p, 'utf8'))
    )
    expect(offenders).toEqual([])
  })
})

describe('sidebar rows at the 220 px default (R15, Task 12 walk)', () => {
  test('scope row hover actions overlay the row end above phone, so the name keeps its room', () => {
    expect(valueFor(':root:not([data-layout="phone"]) .project-folder-actions', 'position')).toBe('absolute')
    expect(valueFor(':root:not([data-layout="phone"]) .project-folder-row', 'position')).toBe('relative')
  })

  test('section header buttons sit above the stretched toggle, not inside it', () => {
    expect(valueFor('.rail-section-toggle::after', 'inset')).toBe('0')
    expect(valueFor('.rail-section-trail .mantine-ActionIcon-root', 'z-index')).toBe('1')
  })
})
