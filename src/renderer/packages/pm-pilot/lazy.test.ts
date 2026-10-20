import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { initPmPilotLazily } from './lazy'

function loader() {
  const calls: string[] = []
  const offReview = vi.fn(() => calls.push('off review'))
  const offQuestions = vi.fn(() => calls.push('off questions'))
  const mod = {
    initPmReview: vi.fn(() => {
      calls.push('review')
      return offReview
    }),
    initPmQuestions: vi.fn(() => {
      calls.push('questions')
      return offQuestions
    }),
  }
  let release: () => void = () => undefined
  const gate = new Promise<void>((r) => {
    release = r
  })
  const load = vi.fn(async () => {
    await gate
    return mod
  })
  return { calls, mod, load, release }
}

describe('initPmPilotLazily (final review M4)', () => {
  it('web and mobile never load the pm-pilot package', () => {
    const l = loader()
    initPmPilotLazily(false, l.load)()
    expect(l.load).not.toHaveBeenCalled()
  })

  it('desktop loads it and registers the applier and openers once loaded; cleanup removes them', async () => {
    const l = loader()
    const cleanup = initPmPilotLazily(true, l.load)
    expect(l.calls).toEqual([])
    l.release()
    await vi.waitFor(() => expect(l.calls).toEqual(['review', 'questions']))
    cleanup()
    expect(l.calls).toEqual(['review', 'questions', 'off questions', 'off review'])
  })

  it('a cleanup before the package loads registers nothing', async () => {
    const l = loader()
    initPmPilotLazily(true, l.load)()
    l.release()
    await l.load.mock.results[0].value
    await Promise.resolve()
    expect(l.calls).toEqual([])
  })

  it('__root.tsx imports no pm-pilot module statically', () => {
    const root = readFileSync(resolve(__dirname, '../../routes/__root.tsx'), 'utf8')
    const staticImports = root
      .split('\n')
      .filter((line) => /^\s*import\s[^(]*from\s+'@\/packages\/pm-pilot'/.test(line))
    expect(staticImports).toEqual([])
    expect(root).toContain('initPmPilotLazily(')
  })
})
