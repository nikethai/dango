// A11Y1 rule 2 inventory (slice 09 Task 10): every mascot is the Mascot component, so reduced motion holds its idle
// pose and writes its state everywhere. No other file draws the mascot by hand.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER = resolve(process.cwd(), 'src/renderer')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

const files = walk(RENDERER).map((full) => ({
  path: relative(RENDERER, full).split(sep).join('/'),
  src: readFileSync(full, 'utf8'),
}))

const MASCOT = 'components/brand/Mascot.tsx'
const BODY_PATH = 'M8 38 C 8 21'

describe('mascot inventory', () => {
  it('scans the renderer', () => {
    expect(files.some((f) => f.path === MASCOT)).toBe(true)
    expect(files.some((f) => f.path.endsWith('.test.tsx'))).toBe(false)
  })

  it('only Mascot.tsx has the dg-mascot class or the mascot body path', () => {
    const offenders = files
      .filter((f) => f.path !== MASCOT && (f.src.includes('dg-mascot') || f.src.includes(BODY_PATH)))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('first run, the thinking line (also Quick Chat), empty states and live cards draw it through <Mascot>', () => {
    // Quick Chat shows the mascot through ThinkingLine (showMascot); the menu bar is a native tray icon.
    for (const p of [
      'components/first-run/FirstRunCard.tsx',
      'components/first-run/FirstReadCard.tsx',
      'components/chat/ThinkingLine.tsx',
      'components/review/ReviewEmpty.tsx',
      'components/plan/PlanCard.tsx',
      'components/chat/swarm/SwarmLiveCard.tsx',
    ]) {
      const src = files.find((f) => f.path === p)?.src ?? ''
      expect({ p, mascot: /<Mascot\b/.test(src) && src.includes("from '@/components/brand/Mascot'") }).toEqual({
        p,
        mascot: true,
      })
    }
    const quick = files.find((f) => f.path === 'components/quick-chat/QuickChatPanel.tsx')?.src ?? ''
    expect(quick).toMatch(/<ThinkingLine[^>]*\bshowMascot\b/)
  })
})
