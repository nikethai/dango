import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import postcss, { type Rule } from 'postcss'
import { describe, expect, test } from 'vitest'

const read = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

const LABEL_CLASSES = ['settings-section-label', 'settings-section-title', 'settings-collapsible-badge']

const labelRules = () => {
  const rules: Rule[] = []
  postcss.parse(read('src/renderer/components/settings/settings-surfaces.css')).walkRules((rule) => {
    if (LABEL_CLASSES.some((name) => rule.selector.includes(name))) {
      rules.push(rule)
    }
  })
  return rules
}

describe('settings section labels and badges follow the Dango label style', () => {
  test('the CSS finds the label rules', () => {
    expect(labelRules().length).toBeGreaterThanOrEqual(LABEL_CLASSES.length)
  })

  test('no uppercase and no letter-spacing', () => {
    const offenders: string[] = []
    for (const rule of labelRules()) {
      rule.each((node) => {
        if (node.type !== 'decl') {
          return
        }
        const value = node.value.trim()
        if (node.prop === 'text-transform' && value !== 'none') {
          offenders.push(`${rule.selector} { text-transform: ${value} }`)
        }
        if (node.prop === 'letter-spacing' && !['0', 'normal'].includes(value)) {
          offenders.push(`${rule.selector} { letter-spacing: ${value} }`)
        }
      })
    }
    expect(offenders).toEqual([])
  })

  test('section labels are 12px, 600, muted', () => {
    const decl = (rule: Rule, prop: string) => {
      let found: string | undefined
      rule.each((node) => {
        if (node.type === 'decl' && node.prop === prop) {
          found = node.value.replace(/\s*!important$/, '').trim()
        }
      })
      return found
    }
    for (const rule of labelRules().filter((r) => /section-(label|title)/.test(r.selector))) {
      const fontSize = decl(rule, 'font-size')
      if (fontSize !== undefined) {
        expect(fontSize, `${rule.selector} font-size`).toBe('0.75rem')
      }
      const weight = decl(rule, 'font-weight')
      if (weight !== undefined) {
        expect(weight, `${rule.selector} font-weight`).toBe('600')
      }
      const color = decl(rule, 'color')
      if (color !== undefined) {
        expect(color, `${rule.selector} color`).toBe('var(--dango-muted)')
      }
    }
  })

  test('the section header components carry no uppercase or tracking utilities', () => {
    for (const file of ['SettingsSection.tsx', 'SettingsCollapsible.tsx']) {
      const source = read(`src/renderer/components/settings/${file}`)
      expect(source, file).not.toMatch(/tt=["']uppercase["']|\buppercase\b|\btracking-/)
    }
  })
})

describe('settings section titles, badges and row titles are sentence case in English', () => {
  // proper nouns, product names and acronyms that keep their capitals
  const PROPER = new Set([
    'Dango',
    'MCP',
    'API',
    'BYOK',
    'SOCKS',
    'HTTP',
    'OpenAI',
    'MinerU',
    'Exa',
    'Serper',
    'Tavily',
    'Google',
    'Gemini',
    'Markdown',
    'LaTeX',
    'Mermaid',
    'Whisper',
    'yt-dlp',
    'Claude',
    'DashScope',
    'QwenCloud',
    'Singapore',
    // OpenAI's Responses API
    'Responses',
  ])
  // 'Screen Recording' is the macOS privacy permission's own name
  const PROPER_PHRASES = new Set(['Google Custom Search', 'Screen Recording'])

  const tsxFiles: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        walk(full)
      } else if (entry.name.endsWith('.tsx')) {
        tsxFiles.push(full)
      }
    }
  }
  walk(resolve(process.cwd(), 'src/renderer'))

  const en = JSON.parse(read('src/renderer/i18n/locales/en/translation.json')) as Record<string, string>

  // every t('...') inside a title= or badge= of <SettingsSection> / <SettingsCollapsible>, and the row-level title= of
  // <SettingsPrefRow> (an arrow function's `=>` before the title must not end the tag)
  const labelKeys = () => {
    const keys = new Map<string, string>()
    for (const file of tsxFiles) {
      const source = readFileSync(file, 'utf8')
      for (const tag of source.matchAll(/<(SettingsSection|SettingsCollapsible|SettingsPrefRow)\b((?:=>|[^>])*)>/g)) {
        const attrs = tag[1] === 'SettingsPrefRow' ? /\b(title)=\{([^}]*)\}/g : /\b(title|badge)=\{([^}]*)\}/g
        for (const attr of tag[2].matchAll(attrs)) {
          for (const call of attr[2].matchAll(/\bt\('([^']+)'\)/g)) {
            keys.set(call[1], file.replace(`${process.cwd()}/`, ''))
          }
        }
      }
    }
    return keys
  }

  const isSentenceCase = (text: string) => {
    if (PROPER_PHRASES.has(text)) {
      return true
    }
    const words = text.split(/\s+/)
    if (!/^[A-Z0-9]/.test(words[0]) && !PROPER.has(words[0])) {
      return false
    }
    return words.slice(1).every((word) => {
      const bare = word.replace(/^[("'\u201c]+|[)"',.:;!?\u201d]+$/g, '')
      return !/^[A-Z]/.test(bare) || PROPER.has(bare) || /^[A-Z0-9&/-]{2,}$/.test(bare)
    })
  }

  test('the scan finds the labels', () => {
    const keys = labelKeys()
    expect(keys.size).toBeGreaterThan(50)
    expect(keys.has('System Notifications')).toBe(true)
    expect(keys.has('Advanced')).toBe(true)
    expect(keys.has('Default Chat Model')).toBe(true)
    expect(keys.has('Search Provider')).toBe(true)
  })

  const offendersIn = (keys: Map<string, string>) =>
    [...keys].filter(([key]) => !isSentenceCase(en[key] ?? key)).map(([key, file]) => `${en[key] ?? key} (${file})`)

  // the settings nav (ITEMS labels in route.tsx, also the breadcrumb) and each page's <SettingsPageHeader title>
  const navAndPageKeys = () => {
    const keys = new Map<string, string>()
    const route = 'src/renderer/routes/settings/route.tsx'
    for (const call of read(route).matchAll(/\blabel: '([^']+)'/g)) {
      keys.set(call[1], route)
    }
    for (const file of tsxFiles) {
      const source = readFileSync(file, 'utf8')
      for (const tag of source.matchAll(/<SettingsPageHeader\b((?:=>|[^>])*)>/g)) {
        for (const call of tag[1].matchAll(/\btitle=\{t\('([^']+)'\)\}/g)) {
          keys.set(call[1], file.replace(`${process.cwd()}/`, ''))
        }
      }
    }
    return keys
  }

  test('settings nav items and page titles are sentence case', () => {
    const keys = navAndPageKeys()
    expect(keys.has('Model Provider')).toBe(true)
    expect(keys.has('General Settings')).toBe(true)
    expect(keys.size).toBeGreaterThan(20)
    expect(offendersIn(keys)).toEqual([])
  })

  // option labels on settings screens: `label: t('...')` in select / segmented data, and label={t('...')} on a
  // Radio, Checkbox or Switch
  const optionKeys = () => {
    const keys = new Map<string, string>()
    const settingsFiles = tsxFiles.filter((file) =>
      ['src/renderer/routes/settings/', 'src/renderer/components/settings/'].some((dir) =>
        file.startsWith(resolve(process.cwd(), dir))
      )
    )
    for (const file of settingsFiles) {
      const source = readFileSync(file, 'utf8')
      const where = file.replace(`${process.cwd()}/`, '')
      for (const call of source.matchAll(/\blabel:\s*t\('([^']+)'\)/g)) {
        keys.set(call[1], where)
      }
      for (const tag of source.matchAll(/<(?:Radio|Checkbox|Switch)\b((?:=>|[^>])*)>/g)) {
        for (const call of tag[1].matchAll(/\blabel=\{t\('([^']+)'\)\}/g)) {
          keys.set(call[1], where)
        }
      }
    }
    return keys
  }

  test('settings option labels are sentence case', () => {
    const keys = optionKeys()
    expect(keys.has('Light Mode')).toBe(true)
    expect(keys.has('Home Page')).toBe(true)
    expect(offendersIn(keys)).toEqual([])
  })

  test('every English value is sentence case', () => {
    const offenders: string[] = []
    for (const [key, file] of labelKeys()) {
      const value = en[key] ?? key
      if (!isSentenceCase(value)) {
        offenders.push(`${value} (${file})`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('settings usage stat labels', () => {
  test('are not uppercased', () => {
    const source = read('src/renderer/routes/settings/usage.tsx')
    expect(source).not.toMatch(/tt=["']uppercase["']/)
  })
})

describe('provider add panel header', () => {
  test('relies on the label rule, with no case or tracking overrides', () => {
    const source = read('src/renderer/components/settings/provider/ProviderList.tsx')
    expect(source).not.toMatch(/!normal-case|tracking-normal/)
  })
})
