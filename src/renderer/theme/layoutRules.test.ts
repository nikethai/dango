import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, test } from 'vitest'

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
  test('the tab bar, not .App, pads the safe-area bottom at phone', () => {
    expect(valueFor(':root[data-layout="phone"] .App', 'padding-bottom')).toBe('0')
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

  test('tab colours: active green text, inactive muted, raised surface, hairline top border', () => {
    // More specific than index.css's html[data-theme='dark'] a, which would otherwise win.
    expect(valueFor('.dg-tabbar a.dg-tabbar__tab', 'color')).toBe('var(--dango-muted)')
    expect(valueFor('.dg-tabbar a.dg-tabbar__tab[aria-current="page"]', 'color')).toBe('var(--dango-green-text)')
    expect(valueFor('.dg-tabbar', 'background')).toBe('var(--dango-raised)')
    expect(valueFor('.dg-tabbar', 'border-top')).toBe('1px solid var(--dango-hairline)')
  })
})
