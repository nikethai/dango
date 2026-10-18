import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(__dirname, 'review-home.css'), 'utf8')
const phone = css.match(/@media \(max-width: 640px\)\s*\{([\s\S]*)\}\s*$/)?.[1] ?? ''
const rule = (selector: string) =>
  phone.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]*)\\}`))?.[1] ?? ''

describe('Review home at phone width (walk at 390px)', () => {
  it('stacks the row actions under its text, in the text column', () => {
    expect(rule('.dango-review-feed__row .dg-item')).toMatch(/grid-template-columns:\s*20px minmax\(0, 1fr\)/)
    const actions = rule('.dango-review-feed__row .dg-item__actions')
    expect(actions).toMatch(/grid-column:\s*2/)
    expect(actions).toMatch(/justify-content:\s*flex-start/)
  })

  it('narrows the feed gutter and lets the toolbar wrap', () => {
    expect(rule('.dango-review-feed')).toMatch(/padding:\s*0 var\(--dango-space-4\)/)
    expect(rule('.dango-review-toolbar')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('hides the New chat key hint (M6)', () => {
    expect(rule('.dango-review-toolbar__new .dg-kbd')).toMatch(/display:\s*none/)
  })
})
