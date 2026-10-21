// A11Y1 rule 1 (slice 09 Task 9): one polite live region per turn. Chat and message-part components show status
// visually; only TurnAnnouncer speaks it.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER = resolve(process.cwd(), 'src/renderer')
const ROOTS = ['components/chat', 'components/message-parts']

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

const LIVE = /aria-live=["']polite["']|role=["']status["']/

describe('live regions in chat', () => {
  it('only TurnAnnouncer has a polite live region', () => {
    const files = ROOTS.flatMap((root) => walk(resolve(RENDERER, root)))
    expect(files.length).toBeGreaterThan(10)
    const withRegion = files
      .filter((full) => LIVE.test(readFileSync(full, 'utf8')))
      .map((full) => relative(RENDERER, full).split(sep).join('/'))
    expect(withRegion).toEqual(['components/chat/TurnAnnouncer.tsx'])
  })
})
