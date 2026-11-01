import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

const readSource = (relativePath: string) => readFileSync(resolve(process.cwd(), relativePath), 'utf8')

describe('Welcome onboarding mobile layout', () => {
  test('allows long benefit copy to wrap within the sheet at enlarged text scale', () => {
    const welcome = readSource('src/renderer/modals/Welcome.tsx')

    expect(welcome).toContain('className="w-full min-w-0"')
    expect(welcome).toContain('className="flex flex-col items-stretch"')
    expect(welcome).toContain("classNames={{ item: 'whitespace-normal' }}")
  })

  test('does not silence the focus ring on its buttons', () => {
    const welcome = readSource('src/renderer/modals/Welcome.tsx')

    expect(welcome).not.toMatch(/outline-none|outline:\s*['"]?none/)
  })

  test('keeps each bullet on the first line of its label when the label wraps', () => {
    const welcome = readSource('src/renderer/modals/Welcome.tsx')
    const list = welcome.slice(welcome.indexOf('<List'), welcome.indexOf('<List.Item>'))

    // Mantine's default list-style-position is inside, which puts a wrapping label's inline-flex box under the marker
    expect(list).toContain("style={{ listStylePosition: 'outside' }}")
    expect(list).toMatch(/\bwithPadding\b/)
  })
})
