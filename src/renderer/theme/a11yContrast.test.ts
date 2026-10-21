import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, test } from 'vitest'
import { contrastRatio } from './contrast'
import { type DangoColor, dangoColors } from './dangoTokens'

// A11Y1 rule 5 (contrast) and rule 6 (targets). A failing pair goes back to the design system; token values are
// never tuned here.

const PAIRS: Array<[fg: DangoColor, bg: DangoColor, min: number, why: string]> = [
  ['green-text', 'raised', 4.5, 'green text'],
  ['green-text', 'surface', 4.5, 'green text'],
  ['green-text', 'green-wash', 4.5, 'green text on its wash'],
  ['muted', 'raised', 4.5, 'secondary text'],
  ['muted', 'surface', 4.5, 'secondary text'],
  ['focus', 'ground', 3, 'focus ring'],
  ['focus', 'surface', 3, 'focus ring'],
  ['focus', 'raised', 3, 'focus ring'],
  ['green', 'raised', 3, 'progress dots, switch'],
  ['green', 'surface', 3, 'progress dots, switch'],
  ['on-blue', 'blue', 4.5, 'text on blue'],
  ['on-green', 'green', 4.5, 'text on green: primary buttons and their shortcut hint'],
]

describe('contrast pairs (A11Y1 rule 5)', () => {
  for (const theme of ['light', 'dark'] as const) {
    test.each(PAIRS)(`${theme}: %s on %s ≥ %s (%s)`, (fg, bg, min) => {
      expect(contrastRatio(dangoColors[theme][fg], dangoColors[theme][bg])).toBeGreaterThanOrEqual(min)
    })
  }
})

const sheet = (name: string) => postcss.parse(readFileSync(resolve(process.cwd(), 'src/renderer/static', name), 'utf8'))
const STYLES = ['dango-components.css', 'dango-layout.css', 'globals.css'].map(sheet)

/** Every px value of `prop` declared on a rule whose selector list holds exactly `selector` (any nesting). */
const pxValues = (selector: string, prop: string): number[] => {
  const values: number[] = []
  for (const root of STYLES) {
    root.walkRules((rule: Rule) => {
      if (!rule.selectors.map((s) => s.trim()).includes(selector)) return
      rule.walkDecls(prop, (decl) => {
        const match = /^(\d+(?:\.\d+)?)px$/.exec(decl.value.trim())
        if (match) values.push(Number(match[1]))
      })
    })
  }
  return values
}

/** The declared size along one axis: every `prop` and `min-prop` value; at least one must exist. */
const sizes = (selector: string, axis: 'width' | 'height') => [
  ...pxValues(selector, axis),
  ...pxValues(selector, `min-${axis}`),
]

describe('targets (A11Y1 rule 6)', () => {
  test.each([
    ['.dg-btn', 'height'],
    ['.dg-btn--icon', 'width'],
    ['.rail-icon-btn', 'width'],
    ['.rail-icon-btn', 'height'],
  ] as const)('%s %s is at least 28 px', (selector, axis) => {
    const values = sizes(selector, axis)
    expect(values.length).toBeGreaterThan(0)
    for (const value of values) expect(value).toBeGreaterThanOrEqual(28)
  })
})

/** The last `prop` value in dango-layout.css on a top-level rule whose selector list holds `selector`. */
const layoutValue = (selector: string, prop: string): string | undefined => {
  let value: string | undefined
  STYLES[1].walkRules((rule: Rule) => {
    if (rule.parent?.type !== 'root') return
    if (!rule.selectors.map((s) => s.replace(/\s+/g, ' ').trim()).includes(selector)) return
    rule.walkDecls(prop, (decl) => {
      value = decl.value.trim()
    })
  })
  return value
}

describe('phone targets in the moved sheets and the inspector sheet (A11Y1 rule 6, 44 px)', () => {
  const phone = ':root[data-layout="phone"]'
  test('buttons and chips (dg-btn) and icon buttons are covered by the shared phone rule', () => {
    expect(layoutValue(`${phone} .dg-btn`, 'min-height')).toBe('44px')
    expect(layoutValue(`${phone} .mantine-ActionIcon-root`, 'min-height')).toBe('44px')
    expect(layoutValue(`${phone} .mantine-ActionIcon-root`, 'min-width')).toBe('44px')
  })

  test('the Clean up slider is 44 px tall at phone (T6)', () => {
    expect(layoutValue(`${phone} .dango-cleanup__range input`, 'min-height')).toBe('44px')
  })

  test('the inspector sheet’s tabs and header buttons are 44 px at phone (T7 M4)', () => {
    for (const cls of ['.workspace-tab', '.workspace-action-btn']) {
      expect(layoutValue(`${phone} .dango-inspector-sheet ${cls}`, 'min-height'), cls).toBe('44px')
    }
    expect(layoutValue(`${phone} .dango-inspector-sheet .workspace-action-btn`, 'min-width')).toBe('44px')
  })
})

describe('text inside primary buttons (A11Y1 rule 5, Task 12 walk)', () => {
  test('a shortcut hint in a primary button uses the on-green text colour, not muted (muted on green fails)', () => {
    expect(layoutValue('.dg-btn--primary .dg-kbd', 'color')).toBe('var(--dango-on-green)')
  })
})
