import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, test } from 'vitest'
import { contrastRatio } from './contrast'
import { dangoColors, dangoFonts } from './dangoTokens'
import { createDangoMantineTheme, dangoCssVariablesResolver } from './mantineTheme'
import { getThemeDesign } from './muiTheme'

const root = process.cwd()
const readSource = (relativePath: string) => readFileSync(resolve(root, relativePath), 'utf8')
const globalsCss = readSource('src/renderer/static/globals.css')
const globalsRoot = postcss.parse(globalsCss)

// [chatbox variable suffix, dango token]
const VARIABLE_MAP: Array<[string, string]> = [
  ['tint-primary', 'ink'],
  ['tint-secondary', 'ink-2'],
  ['tint-tertiary', 'muted'],
  ['tint-gray', 'muted'],
  ['tint-placeholder', 'muted'],
  ['tint-brand', 'green'],
  ['tint-success', 'green'],
  ['tint-error', 'danger'],
  ['tint-warning', 'amber-text'],
  ['tint-on-brand', 'on-green'],
  ['border-primary', 'hairline'],
  ['border-secondary', 'line'],
  ['border-brand', 'green'],
  ['border-success', 'green'],
  ['border-error', 'danger'],
  ['border-warning', 'amber-text'],
  ['background-primary', 'ground'],
  ['background-rail', 'surface'],
  ['background-secondary', 'raised'],
  ['background-lift', 'raised'],
  ['background-tertiary', 'surface'],
  ['background-user-bubble', 'surface'],
  ['background-primary-hover', 'surface'],
  ['background-secondary-hover', 'surface'],
  ['background-tertiary-hover', 'hairline'],
  ['background-brand-primary', 'green'],
  ['background-brand-secondary', 'green-wash'],
  ['background-success-primary', 'green'],
  ['background-success-secondary', 'green-wash'],
  ['background-warning-secondary', 'amber-wash'],
  ['background-error-primary', 'danger'],
  ['background-mask-overlay', 'scrim'],
  ['composer-bg', 'raised'],
  ['composer-shadow', 'shadow-composer'],
  ['font-ui', 'font-sans'],
  ['font-mono', 'font-mono'],
  ['radius-sm', 'radius-sm'],
  ['radius-md', 'radius-md'],
  ['radius-lg', 'radius-lg'],
  ['radius-xl', 'radius-xl'],
  ['radius-xxl', 'radius-sheet'],
]

const normalizeSelector = (selector: string) => selector.replace(/\s+/g, ' ').trim()

const declsOf = (rule: Rule) => {
  const out = new Map<string, string>()
  rule.each((node) => {
    if (node.type === 'decl') {
      out.set(node.prop, node.value.trim())
    }
  })
  return out
}

const rootRules = (selector: string) => {
  const rules: Rule[] = []
  globalsRoot.walkRules((rule) => {
    if (rule.selector.replace(/\s+/g, ' ').trim() === selector) {
      rules.push(rule)
    }
  })
  return rules
}

// Declarations of globals.css that apply in one colour scheme: the top-level `:root` block, the dark block (dark
// only) and the Mantine colour block, which lists both schemes. Later blocks win, as in the cascade.
const schemeDecls = (mode: 'light' | 'dark') => {
  const out = new Map<string, string>()
  globalsRoot.each((node) => {
    if (node.type !== 'rule') {
      return
    }
    const selectors = node.selectors.map(normalizeSelector)
    const applies =
      selectors.includes(':root') ||
      (mode === 'dark' && selectors.includes(':root[data-mantine-color-scheme="dark"]')) ||
      selectors.includes(`:root[data-mantine-color-scheme="${mode}"][data-mantine-color-scheme]`)
    if (applies) {
      for (const [prop, value] of declsOf(node)) {
        out.set(prop, value)
      }
    }
  })
  return out
}

// Split on commas that are not inside parentheses.
const splitArgs = (value: string) => {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(value.slice(start, i).trim())
      start = i + 1
    }
  }
  parts.push(value.slice(start).trim())
  return parts
}

const toHex = (channels: number[]) => `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
const channelsOf = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))

/**
 * Resolve a colour value from globals.css to `#rrggbb` in one scheme: follows `var()` through the scheme's
 * declarations and the Dango tokens, and computes `color-mix(in srgb, A p%, B)`.
 */
const resolveColor = (value: string, mode: 'light' | 'dark', decls = schemeDecls(mode)): string => {
  const v = value.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) {
    return v.toLowerCase()
  }
  if (/^#[0-9a-f]{3}$/i.test(v)) {
    return `#${[...v.slice(1)].map((c) => c + c).join('')}`.toLowerCase()
  }
  const variable = /^var\((--[\w-]+)\)$/.exec(v)
  if (variable) {
    const name = variable[1]
    if (name.startsWith('--dango-')) {
      const token = name.slice('--dango-'.length) as keyof (typeof dangoColors)['light']
      if (dangoColors[mode][token]) {
        return resolveColor(dangoColors[mode][token], mode, decls)
      }
    }
    const declared = decls.get(name)
    if (declared === undefined) {
      throw new Error(`${name} is not declared for ${mode}`)
    }
    return resolveColor(declared, mode, decls)
  }
  const mix = /^color-mix\(in srgb,(.*)\)$/.exec(v)
  if (mix) {
    const [a, b] = splitArgs(mix[1]).map((arg) => {
      const pct = /^(.*?)\s+(\d+(\.\d+)?)%$/.exec(arg)
      return pct ? { color: pct[1], weight: Number(pct[2]) / 100 } : { color: arg, weight: undefined }
    })
    const wa = a.weight ?? (b.weight === undefined ? 0.5 : 1 - b.weight)
    const ca = channelsOf(resolveColor(a.color, mode, decls))
    const cb = channelsOf(resolveColor(b.color, mode, decls))
    return toHex(ca.map((c, i) => c * wa + cb[i] * (1 - wa)))
  }
  throw new Error(`cannot resolve colour "${v}" for ${mode}`)
}

describe('theme mapping onto Dango', () => {
  test('every mapped variable points at its Dango token', () => {
    const [lightRule] = rootRules(':root')
    const darkRules = rootRules(':root[data-mantine-color-scheme="dark"]')
    expect(lightRule).toBeDefined()
    expect(darkRules.length).toBeGreaterThan(0)
    const light = declsOf(lightRule)
    const dark = new Map<string, string>()
    for (const rule of darkRules) {
      for (const [prop, value] of declsOf(rule)) {
        dark.set(prop, value)
      }
    }

    const wrong: string[] = []
    for (const [name, token] of VARIABLE_MAP) {
      const prop = `--chatbox-${name}`
      if (light.get(prop) !== `var(--dango-${token})`) {
        wrong.push(`${prop}: light is ${light.get(prop)}, want var(--dango-${token})`)
      }
      if (dark.has(prop)) {
        wrong.push(`${prop}: still redeclared in the dark block`)
      }
    }
    expect(wrong).toEqual([])

    // hovers are expressions over Dango tokens, in light only (the tokens flip for dark)
    const greenHover = 'color-mix(in srgb, var(--dango-green) 88%, var(--dango-ink))'
    const washHover = 'color-mix(in srgb, var(--dango-green-wash) 85%, var(--dango-green))'
    const hovers: Array<[string, string]> = [
      ['background-brand-primary-hover', greenHover],
      ['background-success-primary-hover', greenHover],
      ['background-brand-secondary-hover', washHover],
      ['background-success-secondary-hover', washHover],
      ['background-error-primary-hover', 'color-mix(in srgb, var(--dango-danger) 88%, var(--dango-ink))'],
    ]
    const wrongHovers: string[] = []
    for (const [name, value] of hovers) {
      const prop = `--chatbox-${name}`
      if (light.get(prop) !== value) {
        wrongHovers.push(`${prop}: light is ${light.get(prop)}, want ${value}`)
      }
      if (dark.has(prop)) {
        wrongHovers.push(`${prop}: still redeclared in the dark block`)
      }
    }
    expect(wrongHovers).toEqual([])
  })

  test('brand fills never carry white text in CSS', () => {
    const isBrandFill = (value: string) =>
      !value.includes('color-mix') &&
      (value.includes('--chatbox-background-brand-primary') || value.includes('--chatbox-tint-brand'))
    const isWhite = (value: string) =>
      ['#fff', '#ffffff', 'white', 'var(--chatbox-tint-white)', 'var(--mantine-color-white)'].includes(
        value
          .trim()
          .toLowerCase()
          .replace(/\s*!important$/, '')
      )

    const offenders: string[] = []
    globalsRoot.walkRules((rule) => {
      const decls = declsOf(rule)
      const fill = decls.get('background') ?? decls.get('background-color')
      const color = decls.get('color')
      const isFilledButtonRule = rule.selector.includes('data-variant="filled"')
      if (color && isWhite(color) && ((fill && isBrandFill(fill)) || isFilledButtonRule)) {
        offenders.push(`${rule.selector} (line ${rule.source?.start?.line})`)
      }
    })
    expect(offenders).toEqual([])
  })

  test('brand fills never carry white text in TSX', () => {
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walk(full)
        } else if (entry.name.endsWith('.tsx')) {
          files.push(full)
        }
      }
    }
    walk(resolve(root, 'src/renderer'))

    const literal = /'[^'\n]*'|"[^"\n]*"|`[^`]*`/g
    const offenders: string[] = []
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const match of source.matchAll(literal)) {
        const text = match[0]
        if (
          text.includes('bg-chatbox-background-brand-primary') &&
          /(^|[\s'"`:])(text-white|text-chatbox-tint-white)(?=$|[\s'"`])/.test(text)
        ) {
          const line = source.slice(0, match.index).split('\n').length
          offenders.push(`${file.replace(`${root}/`, '')}:${line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  test('Mantine filled buttons use on-brand text', () => {
    const theme = createDangoMantineTheme()
    // biome-ignore lint/suspicious/noExplicitAny: resolvers are typed against Mantine's internal theme
    const components = theme.components as any
    const mantineTheme = {} as never
    const onBrand = 'var(--chatbox-tint-on-brand)'

    expect(components.Button.vars(mantineTheme, { variant: 'filled' }).root['--button-color']).toBe(onBrand)
    expect(components.ActionIcon.vars(mantineTheme, { variant: 'filled' }).root['--ai-color']).toBe(onBrand)
    expect(
      components.Button.vars(mantineTheme, { variant: 'filled', color: 'chatbox-brand' }).root['--button-color']
    ).toBe(onBrand)

    // danger takes the raised surface colour, grey takes white (see the contrast test below)
    for (const [color, label] of [
      ['chatbox-error', 'var(--dango-raised)'],
      ['chatbox-gray', 'var(--chatbox-tint-white)'],
    ]) {
      const props = { variant: 'filled', color }
      expect(components.Button.vars(mantineTheme, props).root['--button-color']).toBe(label)
      expect(components.ActionIcon.vars(mantineTheme, props).root['--ai-color']).toBe(label)
    }

    // success is the same green fill as brand
    const success = { variant: 'filled', color: 'chatbox-success' }
    expect(components.Button.vars(mantineTheme, success).root['--button-color']).toBe(onBrand)
    expect(components.ActionIcon.vars(mantineTheme, success).root['--ai-color']).toBe(onBrand)

    const blue = { variant: 'filled', color: 'blue' }
    expect(components.Button.vars(mantineTheme, blue).root).toEqual({})
    expect(components.ActionIcon.vars(mantineTheme, blue).root).toEqual({})
    expect(components.Button.vars(mantineTheme, { variant: 'light' }).root['--button-color']).toBeUndefined()

    expect(theme.fontFamily).toBe('var(--chatbox-font-ui)')
  })

  // follows the real chain: the label from the vars resolver, the fill from Mantine's `--mantine-color-<c>-filled`
  // through globals.css, in each scheme
  test.each(['chatbox-brand', 'chatbox-success', 'chatbox-gray', 'chatbox-error'])(
    'filled %s controls have a readable label in both themes, at rest and on hover',
    (color) => {
      const theme = createDangoMantineTheme()
      // biome-ignore lint/suspicious/noExplicitAny: resolvers are typed against Mantine's internal theme
      const components = theme.components as any
      const mantineTheme = {} as never
      const failures: string[] = []
      const props = { variant: 'filled', color }
      const label = components.Button.vars(mantineTheme, props).root['--button-color']
      expect(label, `${color} label`).toBeDefined()
      expect(components.ActionIcon.vars(mantineTheme, props).root['--ai-color'], `${color} icon`).toBe(label)
      for (const mode of ['light', 'dark'] as const) {
        for (const fillVar of [`--mantine-color-${color}-filled`, `--mantine-color-${color}-filled-hover`]) {
          const fg = resolveColor(label, mode)
          const bg = resolveColor(`var(${fillVar})`, mode)
          const ratio = contrastRatio(fg, bg)
          if (ratio < 4.5) {
            failures.push(`${color} ${mode} ${fillVar}: ${fg} on ${bg} is ${ratio.toFixed(2)}:1`)
          }
        }
      }
      expect(failures).toEqual([])
    }
  )

  test('checked Checkbox ticks and Radio dots on a green fill use on-brand, readable in both themes', () => {
    const theme = createDangoMantineTheme()
    // biome-ignore lint/suspicious/noExplicitAny: resolvers are typed against Mantine's internal theme
    const components = theme.components as any
    const mantineTheme = {} as never
    const onBrand = 'var(--chatbox-tint-on-brand)'

    for (const [name, iconVar] of [
      ['Checkbox', '--checkbox-icon-color'],
      ['Radio', '--radio-icon-color'],
    ]) {
      for (const props of [{}, { color: 'chatbox-brand' }, { color: 'chatbox-success' }, { variant: 'filled' }]) {
        expect(components[name].vars(mantineTheme, props).root[iconVar], `${name} ${JSON.stringify(props)}`).toBe(
          onBrand
        )
      }
      // other colours, the outline variant and an explicit iconColor keep Mantine's own icon colour
      for (const props of [{ color: 'blue' }, { variant: 'outline' }, { iconColor: 'red' }]) {
        expect(components[name].vars(mantineTheme, props).root, `${name} ${JSON.stringify(props)}`).toEqual({})
      }
    }

    for (const mode of ['light', 'dark'] as const) {
      const ratio = contrastRatio(resolveColor(onBrand, mode), resolveColor('var(--chatbox-tint-brand)', mode))
      expect(ratio, `on-brand on green, ${mode}`).toBeGreaterThanOrEqual(4.5)
    }
  })

  test('the checked Switch thumb on a green track is on-brand', () => {
    const theme = createDangoMantineTheme()
    // biome-ignore lint/suspicious/noExplicitAny: resolvers are typed against Mantine's internal theme
    const components = theme.components as any
    const mantineTheme = {} as never

    // the thumb colour is handed to CSS on the root; the checked-state rule below picks it up
    for (const props of [{}, { color: 'chatbox-brand' }, { color: 'chatbox-success' }]) {
      expect(components.Switch.styles(mantineTheme, props).root['--chatbox-switch-checked-thumb']).toBe(
        'var(--chatbox-tint-on-brand)'
      )
    }
    expect(components.Switch.styles(mantineTheme, { color: 'blue' }).root).toEqual({})

    // Mantine's own CSS is unlayered, so the rule must be too
    const selector = '.mantine-Switch-input:checked:not(:disabled) + * > .mantine-Switch-thumb'
    const rules = rootRules(selector)
    expect(rules.length).toBe(1)
    expect(rules[0].parent?.type).toBe('root')
    const decls = declsOf(rules[0])
    const thumb = 'var(--chatbox-switch-checked-thumb, var(--mantine-color-white))'
    expect(decls.get('--switch-thumb-bg')).toBe(thumb)
    expect(decls.get('--switch-thumb-bd')).toBe(thumb)
  })

  test('composer surface uses the Dango composer radius and send is green with on-green text', () => {
    const find = (selector: string) => rootRules(selector).map(declsOf)

    const cards = find('.composer-card').filter((decls) =>
      decls.get('background')?.startsWith('var(--chatbox-composer-bg')
    )
    expect(cards.length).toBeGreaterThan(0)
    for (const decls of cards) {
      expect(decls.get('border-radius')).toBe('var(--dango-radius-composer)')
    }

    // plain .composer-send must not set a fill (it would hit Stop and disabled)
    for (const decls of find('.composer-send')) {
      expect(decls.has('background')).toBe(false)
      expect(decls.has('color')).toBe(false)
    }

    const sends = find('.composer-send:not(.is-stop):not(:disabled)')
    expect(sends.length).toBe(1)
    expect(sends[0].get('background')).toBe('var(--chatbox-background-brand-primary)')
    expect(sends[0].get('color')).toBe('var(--chatbox-tint-on-brand)')
  })

  test('the Send button is green through its Mantine colour prop, Stop is dark', () => {
    const source = readSource('src/renderer/components/InputBox/InputBox.tsx')
    const labelAt = source.indexOf('aria-label={isSamplingVideoFrames')
    expect(labelAt).toBeGreaterThan(-1)
    const openTag = source.lastIndexOf('<ActionIcon', labelAt)
    const tag = source.slice(openTag, labelAt)
    expect(tag).toContain("color={showStop ? 'dark' : 'chatbox-brand'}")
    expect(tag).toContain("showStop && 'is-stop'")
  })

  test('the dark ground is Dango, not the old #121214', () => {
    const indexCss = readSource('src/renderer/static/index.css')
    const indexHtml = readSource('src/renderer/index.html')
    expect(/#121214/i.test(indexCss), 'index.css has #121214').toBe(false)
    expect(/#121214/i.test(indexHtml), 'index.html has #121214').toBe(false)

    // html/body/#root take the ground from the mapped variable, with no dark-only literal override
    const offenders: string[] = []
    postcss.parse(indexCss).walkRules((rule) => {
      const touchesPage = /(^|[\s,])(html|body|#root)(\[[^\]]*\])?(\s+body)?$/.test(rule.selector.trim())
      if (!touchesPage) {
        return
      }
      for (const [prop, value] of declsOf(rule)) {
        if (prop.startsWith('background') && !value.includes('var(--chatbox-background-primary')) {
          offenders.push(`${rule.selector} { ${prop}: ${value} }`)
        }
      }
    })
    expect(offenders).toEqual([])

    // the splash paints before CSS loads, so it keeps literals: they must be the Dango ground
    expect(indexHtml.includes(`background-color: ${dangoColors.dark.ground}`), 'splash dark ground').toBe(true)
    expect(indexHtml.includes(`background-color: ${dangoColors.light.ground}`), 'splash light ground').toBe(true)
  })

  test('the page loads no Satoshi font: the UI font is the Dango sans stack', () => {
    const indexHtml = readSource('src/renderer/index.html')
    expect(indexHtml).not.toContain('fontshare.com')
    expect(/satoshi/i.test(indexHtml), 'index.html mentions Satoshi').toBe(false)
    expect(/satoshi/i.test(readSource('src/renderer/static/index.css')), 'index.css mentions Satoshi').toBe(false)
  })

  test("Mantine's semantic colour variables resolve to Dango in both schemes", () => {
    const resolved = dangoCssVariablesResolver({} as never)
    const expected = {
      '--mantine-color-body': 'var(--dango-ground)',
      '--mantine-color-text': 'var(--dango-ink)',
      '--mantine-color-dimmed': 'var(--dango-muted)',
      '--mantine-color-placeholder': 'var(--dango-muted)',
      '--mantine-color-default-border': 'var(--dango-line)',
      '--mantine-color-default': 'var(--dango-raised)',
      '--mantine-color-default-hover': 'var(--dango-surface)',
      '--mantine-color-default-color': 'var(--dango-ink)',
    }
    expect(resolved.light).toMatchObject(expected)
    expect(resolved.dark).toMatchObject(expected)
  })

  test('Mantine inputs use the raised fill and the control border; the chevron is muted', () => {
    const theme = createDangoMantineTheme()
    // biome-ignore lint/suspicious/noExplicitAny: style resolvers are typed against Mantine's internal theme
    const components = theme.components as any
    const mantineTheme = {} as never

    const wrapper = components.Input.styles(mantineTheme, {}).wrapper
    expect(wrapper['--input-bg']).toBe('var(--dango-raised)')
    expect(wrapper['--input-bd']).toBe('var(--dango-control-border)')
    expect(wrapper['--input-color']).toBe('var(--dango-ink)')
    expect(wrapper['--input-placeholder-color']).toBe('var(--dango-muted)')

    for (const name of ['Input', 'TextInput', 'Textarea', 'Select', 'NativeSelect']) {
      const input = components[name].styles(mantineTheme, {}).input
      expect(input.backgroundColor, `${name} fill`).toBe('var(--dango-raised)')
      expect(input.borderColor, `${name} border`).toBe('var(--dango-control-border)')
      expect(input.color, `${name} text`).toBe('var(--dango-ink)')
    }

    expect(components.ComboboxChevron.vars(mantineTheme, {}).chevron['--combobox-chevron-color']).toBe(
      'var(--dango-muted)'
    )
    expect(components.ComboboxChevron.vars(mantineTheme, { error: 'bad' }).chevron).toEqual({})
  })

  test('the root MantineProvider passes the Dango variables resolver', () => {
    const rootSource = readSource('src/renderer/routes/__root.tsx')
    expect(rootSource).toContain('cssVariablesResolver={dangoCssVariablesResolver}')
    // the brand is Dango green; no leftover description of the old indigo brand
    expect(/indigo/i.test(rootSource)).toBe(false)
  })

  test('no CSS rule gives a Mantine input a non-Dango fill or border', () => {
    const cssFiles: string[] = []
    const walkCss = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          walkCss(full)
        } else if (entry.name.endsWith('.css')) {
          cssFiles.push(full)
        }
      }
    }
    walkCss(resolve(root, 'src/renderer'))

    const INPUT_SELECTOR = /mantine-(Input|TextInput|Textarea|PasswordInput|Select|InputBase)-input/
    // bare inputs inside a panel: deliberately borderless and transparent, so they carry no fill or border to check
    // composer toolbar pickers (reasoning select, model trigger): borderless and transparent like the design
    // system's `.dg-model` (border: 0; background: transparent), asserted separately below
    const BARE = /model-picker-search-field|composer-reasoning-select|model-picker-trigger/
    const ALLOWED = [
      'var(--dango-raised)',
      'var(--dango-control-border)',
      'var(--dango-focus)',
      'var(--dango-danger)',
      'var(--chatbox-tint-brand)', // focus: maps onto green
      'var(--chatbox-tint-error)',
      'var(--chatbox-border-error)',
      'none',
      'transparent',
      '0',
      'inherit',
    ]
    const BORDER_WORDS = /^(\d+(\.\d+)?px|solid|dashed|none)$/
    const STATE_TOKENS = ALLOWED.filter((ok) => /focus|danger|error|tint-brand/.test(ok))
    const isAllowed = (value: string) => {
      const cleaned = value.replace(/\s*!important$/, '').trim()
      if (cleaned.startsWith('color-mix(')) {
        // translucent focus / error edges only
        return STATE_TOKENS.some((ok) => cleaned.includes(ok))
      }
      return cleaned
        .split(/\s+/)
        .filter((token) => !BORDER_WORDS.test(token))
        .every((token) => ALLOWED.includes(token))
    }

    const offenders: string[] = []
    for (const file of cssFiles) {
      postcss.parse(readFileSync(file, 'utf8')).walkRules((rule) => {
        if (!rule.selectors.some((sel) => INPUT_SELECTOR.test(sel) && !BARE.test(sel))) {
          return
        }
        rule.each((node) => {
          if (
            node.type === 'decl' &&
            ['background', 'background-color', 'border', 'border-color'].includes(node.prop)
          ) {
            if (!isAllowed(node.value)) {
              offenders.push(`${file.replace(`${root}/`, '')}:${node.source?.start?.line} ${node.prop}: ${node.value}`)
            }
          }
        })
      })
    }
    expect(offenders).toEqual([])
  })

  test('composer toolbar pickers are borderless and transparent (design system .dg-model)', () => {
    const PICKER = /(^|[^(])\.model-picker-trigger|composer-reasoning-select .*mantine-(Select|Input)-input/
    const all: Rule[] = []
    globalsRoot.walkRules((rule) => {
      if (rule.selectors.some((sel) => PICKER.test(normalizeSelector(sel)))) {
        all.push(rule)
      }
    })
    const strip = (value: string) => value.replace(/\s*!important$/, '').trim()
    const offenders: string[] = []
    for (const rule of all) {
      for (const [prop, value] of declsOf(rule)) {
        const v = strip(value)
        if (['background', 'background-color'].includes(prop) && !['transparent', 'var(--dango-surface)'].includes(v)) {
          offenders.push(`${rule.selector} { ${prop}: ${v} }`)
        }
        if (prop === 'border' && !['none', '0'].includes(v)) {
          offenders.push(`${rule.selector} { ${prop}: ${v} }`)
        }
        if (prop === 'box-shadow' && v !== 'none') {
          offenders.push(`${rule.selector} { ${prop}: ${v} }`)
        }
      }
    }
    expect(offenders).toEqual([])

    const find = (selector: string) => rootRules(selector).map(declsOf)
    const trigger = find('.model-picker-trigger')[0]
    expect(trigger.get('background')).toBe('transparent')
    expect(trigger.get('border')).toBe('none')
    expect(trigger.get('box-shadow')).toBe('none')
    expect(find('.model-picker-trigger:hover')[0].get('background')).toBe('var(--dango-surface)')

    // desktop select: inline Mantine styles need !important to lose
    const select = find('.composer-bar .composer-reasoning-select .mantine-Select-input')[0]
    const importantProps = (selector: string) => {
      const props: string[] = []
      for (const rule of rootRules(selector)) {
        rule.each((node) => {
          if (node.type === 'decl' && node.important) {
            props.push(node.prop)
          }
        })
      }
      return props
    }
    const selectSelector = '.composer-bar .composer-reasoning-select .mantine-Select-input'
    expect(select.get('background')).toBe('transparent')
    expect(select.get('border')).toBe('0')
    expect(select.get('box-shadow')).toBe('none')
    expect(select.get('color')).toBe('var(--dango-ink-2)')
    expect(importantProps(selectSelector)).toEqual(['background', 'border', 'box-shadow', 'color'])
    expect(find(`${selectSelector}:hover`)[0].get('background')).toBe('var(--dango-surface)')

    // Mantine's input sets `outline: none` on :focus, so the reasoning select brings the ring back (the trigger is a
    // plain button and would get the global one, but keeps the explicit rule beside it)
    for (const selector of [
      '.composer-card .model-picker-trigger:focus-visible',
      '.composer-card .composer-reasoning-select .mantine-Select-input:focus-visible',
    ]) {
      let decls: Map<string, string> | undefined
      globalsRoot.walkRules((rule) => {
        if (rule.selectors.some((sel) => normalizeSelector(sel) === selector)) {
          decls = declsOf(rule)
        }
      })
      expect(decls?.get('outline'), selector).toBe('2px solid var(--dango-focus)')
      expect(decls?.get('outline-offset'), selector).toBe('2px')
    }
  })

  test('nothing in the composer silences the focus ring except the text field', () => {
    // :focus and :focus-visible on something inside the card (the card's own :focus-within elevation is fine)
    const FOCUS = /:focus(-visible)?(?![-\w])/
    const TEXT_FIELD = /\.composer-(textarea|rich-input)(:|$)/
    const offenders: string[] = []
    globalsRoot.walkRules((rule) => {
      const silences = rule.nodes.some(
        (node) => node.type === 'decl' && node.prop === 'outline' && /^(none|0)$/.test(node.value.trim())
      )
      if (!silences) {
        return
      }
      for (const raw of rule.selectors) {
        const sel = normalizeSelector(raw)
        if (sel.startsWith('.composer-card') && FOCUS.test(sel) && !TEXT_FIELD.test(sel)) {
          offenders.push(`${sel} (line ${rule.source?.start?.line})`)
        }
      }
    })
    expect(offenders).toEqual([])
  })

  test('the composer card shows a 2px --dango-focus ring while focus is inside it', () => {
    // the text field is ring-less, so the card's :focus-within shadow is the only focus cue while typing
    const RING = '0 0 0 2px var(--dango-focus)'
    for (const selector of [':root', ':root[data-mantine-color-scheme="dark"]']) {
      const value = declsOf(rootRules(selector)[0]).get('--chatbox-composer-shadow-focus')
      expect(value?.replace(/\s+/g, ' ').startsWith(RING), selector).toBe(true)
      expect(value, selector).not.toContain('color-mix')
    }
    const card = rootRules('.composer-card:focus-within:not(.composer-card-drag-active)').map(declsOf)
    expect(card.length).toBe(1)
    expect(card[0].get('box-shadow')).toBe('var(--chatbox-composer-shadow-focus)')
    const quick = rootRules('.quick-chat-shell .composer-card:focus-within:not(.composer-card-drag-active)').map(
      declsOf
    )
    expect(quick.length).toBe(1)
    expect(quick[0].get('box-shadow')?.replace(/\s+/g, ' ').startsWith(RING)).toBe(true)

    // non-text contrast against what sits around the card
    for (const mode of ['light', 'dark'] as const) {
      for (const bg of ['ground', 'surface', 'raised'] as const) {
        expect(contrastRatio(dangoColors[mode].focus, dangoColors[mode][bg]), `${mode} ${bg}`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  test('the new scope sheet input uses the raised fill and the control border', () => {
    const source = readSource('src/renderer/components/scope/NewScopeSheet.tsx')
    expect(source).not.toContain("background: 'var(--chatbox-background-primary)'")
    expect(source).not.toContain("borderColor: 'var(--chatbox-border-secondary)'")
    expect(source).toContain("background: 'var(--dango-raised)'")
    expect(source).toContain("borderColor: 'var(--dango-control-border)'")
  })

  test('the scope pill sits after the tools menu and before team mode in the composer', () => {
    const source = readSource('src/renderer/components/InputBox/InputBox.tsx')
    const pill = source.indexOf('<ScopePill')
    expect(pill).toBeGreaterThan(source.indexOf('<ComposerToolsMenu'))
    expect(pill).toBeLessThan(source.indexOf('<TeamModeSelect'))
  })

  test('the composer scope pill truncates at 160px', () => {
    const rules = rootRules('.composer-scope-pill')
    expect(rules.length).toBe(1)
    const decls = declsOf(rules[0])
    expect(decls.get('max-width')).toBe('160px')
    expect(decls.get('text-overflow')).toBe('ellipsis')
  })

  test('the global focus ring is 2px solid --dango-focus with a 2px offset', () => {
    const rules = rootRules(':focus-visible')
    expect(rules.length).toBe(1)
    const decls = declsOf(rules[0])
    expect(decls.get('outline')).toBe('2px solid var(--dango-focus)')
    expect(decls.get('outline-offset')).toBe('2px')
  })

  test('every focus ring is drawn with --dango-focus', () => {
    const files = ['src/renderer/static/globals.css', 'src/renderer/static/dango-components.css']
    // where a ring is deliberately off: the composer text field, the flush search-dialog input and its cmdk list
    // (focus stays in the input; the list shows the active item with aria-selected), and the model-picker search
    // field's inner input (the field shell draws the ring on :focus-within)
    const SILENCED = [
      '.composer-card .composer-textarea:focus-visible',
      '.composer-card .composer-rich-input:focus-visible',
      '.composer-rich-input:focus-visible',
      '.search-dialog-input:focus-visible',
      '.search-dialog-content :focus-visible',
      '.model-picker-search-field *:focus-visible',
    ]
    const RING_PROPS = ['outline', 'box-shadow']
    const FOCUS = /:focus(-visible|-within)?(?![-\w])|\[data-focus\]/
    const TRANSLUCENT_BRAND = /color-mix\([^;]*--chatbox-tint-brand/

    const offenders: string[] = []
    for (const file of files) {
      postcss.parse(readSource(file)).walkRules((rule) => {
        const selectors = rule.selectors.map(normalizeSelector)
        const visible = selectors.filter((sel) => sel.includes(':focus-visible'))
        const focus = selectors.filter((sel) => FOCUS.test(sel))
        rule.each((node) => {
          if (node.type !== 'decl') {
            return
          }
          const value = node.value.trim()
          const where = `${file}:${node.source?.start?.line} ${rule.selector.replace(/\s+/g, ' ')} { ${node.prop}: ${value} }`
          if (visible.length > 0 && RING_PROPS.includes(node.prop) && !value.includes('var(--dango-focus)')) {
            const off = /^(none|0)$/.test(value)
            if (!off || visible.some((sel) => !SILENCED.includes(sel))) {
              offenders.push(where)
              return
            }
          }
          // no translucent brand ring or edge on any focus state
          if (
            focus.length > 0 &&
            [...RING_PROPS, 'border-color'].includes(node.prop) &&
            TRANSLUCENT_BRAND.test(value)
          ) {
            offenders.push(where)
          }
        })
      })
    }
    expect(offenders).toEqual([])
  })

  test('MUI follows Dango', () => {
    const light = getThemeDesign('light', 16, 'en')
    expect(light.palette?.primary).toMatchObject({ main: dangoColors.light.green })
    expect(light.palette?.background).toMatchObject({ default: dangoColors.light.ground })

    const dark = getThemeDesign('dark', 16, 'en')
    expect(dark.palette?.primary).toMatchObject({ main: dangoColors.dark.green })
    expect(dark.palette?.background).toMatchObject({
      default: dangoColors.dark.ground,
      paper: dangoColors.dark.raised,
    })
    expect(dark.palette?.text).toMatchObject({ primary: dangoColors.dark.ink, secondary: dangoColors.dark['ink-2'] })
    expect(dark.palette?.divider).toBe(dangoColors.dark.hairline)

    for (const mode of ['light', 'dark'] as const) {
      // biome-ignore lint/suspicious/noExplicitAny: styleOverrides are a loose union in MUI's types
      const toast = getThemeDesign(mode, 16, 'en').components?.MuiSnackbarContent?.styleOverrides as any
      expect(toast.root, mode).toMatchObject({
        backgroundColor: dangoColors[mode].toast,
        color: dangoColors[mode]['on-toast'],
        boxShadow: 'var(--dango-shadow-toast)',
      })
      expect(toast.action.color, mode).toBe(dangoColors[mode]['toast-action'])
      expect(contrastRatio(dangoColors[mode]['on-toast'], dangoColors[mode].toast), mode).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(dangoColors[mode]['toast-action'], dangoColors[mode].toast), mode).toBeGreaterThanOrEqual(
        4.5
      )
    }

    expect(light.typography).toMatchObject({ fontFamily: dangoFonts.sans, fontSize: 14 })
    expect(getThemeDesign('light', 16, 'ar').typography).toMatchObject({ fontFamily: 'Cairo, Arial, sans-serif' })
    expect(getThemeDesign('light', 20, 'en').typography).toMatchObject({ fontSize: 17.5 })
  })
})
