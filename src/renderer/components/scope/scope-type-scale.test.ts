import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const root = process.cwd()

type TypeStyle = { name: string; fontSize: string; lineHeight: string }

describe('Dango type scale', () => {
  const tokens = JSON.parse(readFileSync(resolve(root, 'design/dango/tokens.json'), 'utf8')) as {
    type: { groups: Array<{ name: string; styles: TypeStyle[] }> }
  }
  const styles = tokens.type.groups.find((g) => g.name === 'Interface')?.styles ?? []
  const css = postcss.parse(readFileSync(resolve(root, 'src/renderer/static/dango-foundations.css'), 'utf8'))
  const vars: Record<string, string> = {}
  css.walkRules(':root', (rule) => {
    rule.walkDecls(/^--dango-type-/, (d) => {
      vars[d.prop] = d.value
    })
  })

  it.each(['title-2', 'headline', 'body', 'callout', 'caption'])('%s variables match tokens.json', (name) => {
    const style = styles.find((s) => s.name === name)
    expect(style).toBeTruthy()
    expect(vars[`--dango-type-${name}-size`]).toBe(style?.fontSize)
    expect(vars[`--dango-type-${name}-line`]).toBe(style?.lineHeight)
  })

  it('scope page components use the type scale, not raw font sizes', () => {
    const dir = resolve(root, 'src/renderer/components/scope')
    // EverywhereRow sits in the legacy rail beside FolderItem and keeps its row metrics until the rail is rebuilt.
    const files = readdirSync(dir).filter(
      (f) => f.endsWith('.tsx') && !f.includes('.test.') && f !== 'EverywhereRow.tsx'
    )
    const offenders = files.filter((f) => /fontSize\s*:/.test(readFileSync(resolve(dir, f), 'utf8')))
    expect(offenders).toEqual([])
  })

  it('no inline font shorthand overrides a dg-type class on the same element', () => {
    const dir = resolve(root, 'src/renderer/components/scope')
    const files = readdirSync(dir).filter((f) => f.endsWith('.tsx') && !f.includes('.test.'))
    const offenders: string[] = []
    for (const f of files) {
      const src = readFileSync(resolve(dir, f), 'utf8')
      // Opening tags that carry a dg-type-* class; check their inline style (literal or a named const).
      for (const tag of src.match(/<\w+[^>]*className="[^"]*dg-type-[^"]*"[^>]*>/g) ?? []) {
        const literal = tag.match(/style=\{\{([^}]*)\}\}/)?.[1] ?? ''
        const named = tag.match(/style=\{(\w+)\}/)?.[1]
        const body = named ? (src.match(new RegExp(`const ${named} = \\{([^}]*)\\}`))?.[1] ?? '') : ''
        if (/\bfont\s*:/.test(literal + body)) offenders.push(`${f}: ${tag.slice(0, 60)}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
