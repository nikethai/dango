import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, '../../../static/dango-foundations.css'), 'utf8')
const rule = (selector: string) =>
  css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

describe('conflict card statements (finding 19)', () => {
  it('keeps Keep this at its width and wraps the statement instead', () => {
    const button = rule('.dango-conflict__statement > .dg-btn')
    expect(button).toMatch(/flex-shrink:\s*0/)
    expect(button).toMatch(/white-space:\s*nowrap/)
    const text = rule('.dango-conflict__statement > :first-child')
    expect(text).toMatch(/min-width:\s*0/)
    expect(text).toMatch(/overflow-wrap:\s*anywhere/)
  })
})
