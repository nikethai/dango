import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { blameFile, classify, loadConfig, matchFile, normalizeLines, ratchet, scanRef, shingleHashes } from './scan.mjs'

const lines = (...texts) => texts.map((text, line) => ({ line, text }))
const sig = (n, prefix = 'const value') =>
  Array.from({ length: n }, (_, i) => `${prefix}_${i} = computeSomething(${i})`).join('\n')

describe('normalizeLines', () => {
  it('trims, collapses spaces and drops short or trivial lines', () => {
    expect(normalizeLines('  const   a = 1234567890\n}\nimport x from "y"\nshort')).toEqual([
      { line: 0, text: 'const a = 1234567890' },
    ])
  })

  it('drops lines that are only punctuation, imports, exports, comments or closing tags', () => {
    const text = [
      '  });  ;  ',
      'export { a, b, c, d, e }',
      '} from "./some/where/else"',
      '// a long explanatory comment line',
      '/* another long comment block */',
      ' * jsdoc continuation line here',
      '</SomeComponentName>',
      'return computeTheThing(value)',
    ].join('\n')
    expect(normalizeLines(text)).toEqual([{ line: 7, text: 'return computeTheThing(value)' }])
  })
})

describe('shingleHashes', () => {
  it('gives one shingle per run of 4 significant lines', () => {
    const shingles = shingleHashes(normalizeLines(sig(5)))
    expect(shingles).toHaveLength(2)
    expect(shingles[0]).toMatchObject({ from: 0, to: 3 })
    expect(shingles[1]).toMatchObject({ from: 1, to: 4 })
    for (const s of shingles) {
      expect(s.hash).toMatch(/^[0-9a-f]{16}$/)
    }
  })

  it('gives none for fewer than 4 lines', () => {
    expect(shingleHashes(normalizeLines(sig(3)))).toEqual([])
  })
})

describe('matchFile', () => {
  const corpusOf = (text, path = 'upstream/file.ts') => {
    const corpus = new Map()
    for (const { hash } of shingleHashes(normalizeLines(text))) {
      corpus.set(hash, new Set([path]))
    }
    return corpus
  }

  it('counts 4 shared consecutive significant lines', () => {
    const corpus = corpusOf(sig(4))
    const result = matchFile(`${sig(4)}\n${sig(6, 'let other')}`, corpus)
    expect(result).toEqual({ significant: 10, matched: 4, sources: ['upstream/file.ts'] })
  })

  it('counts nothing for only 3 shared lines', () => {
    const corpus = corpusOf(sig(4))
    const shared = sig(3)
    expect(matchFile(`${shared}\n${sig(6, 'let other')}`, corpus).matched).toBe(0)
  })

  it('skips allowlisted hashes', () => {
    const corpus = corpusOf(sig(4))
    const [{ hash }] = shingleHashes(normalizeLines(sig(4)))
    expect(matchFile(sig(4), corpus, new Set([hash])).matched).toBe(0)
  })
})

describe('classify', () => {
  const base = { identical: false, team: 0, upstream: 0, significant: 0, matched: 0 }

  it('identical wins over everything', () => {
    expect(classify({ ...base, identical: true })).toBe('identical')
  })

  it('uses the larger of the blame share and the copy share', () => {
    expect(classify({ ...base, team: 15, upstream: 85 })).toBe('upstream')
    expect(classify({ ...base, team: 50, upstream: 50 })).toBe('mixed')
    expect(classify({ ...base, team: 100, significant: 20, matched: 17 })).toBe('upstream')
    expect(classify({ ...base, team: 100, significant: 40, matched: 20 })).toBe('mixed')
  })

  it('flags a small share as trace', () => {
    expect(classify({ ...base, team: 38, upstream: 2 })).toBe('trace')
    expect(classify({ ...base, team: 100, significant: 100, matched: 4 })).toBe('trace')
  })

  it('all zero is clean', () => {
    expect(classify(base)).toBe('clean')
  })
})

describe('ratchet', () => {
  const file = (over) => ({
    class: 'mixed',
    identical: false,
    team: 50,
    upstream: 50,
    significant: 80,
    matched: 8,
    ...over,
  })
  const clean = file({ class: 'clean', team: 100, upstream: 0, matched: 0 })

  it('fails a new file with upstream lines', () => {
    expect(ratchet(null, file({ class: 'trace', team: 96, upstream: 4, matched: 0 })).ok).toBe(false)
  })

  it('passes a new clean file', () => {
    expect(ratchet(null, clean).ok).toBe(true)
  })

  it('fails a clean file that gains an upstream match', () => {
    expect(ratchet(clean, { ...clean, class: 'trace', matched: 4 }).ok).toBe(false)
  })

  it('passes a mixed file whose import line is rewired', () => {
    expect(ratchet(file(), file({ team: 51, upstream: 49 })).ok).toBe(true)
  })

  it('fails a mixed file that gains 4 copy-matched lines', () => {
    expect(ratchet(file(), file({ matched: 12 })).ok).toBe(false)
  })

  it('fails a mixed file that gains upstream blame lines', () => {
    expect(ratchet(file(), file({ upstream: 51 })).ok).toBe(false)
  })

  it('passes a mixed file that loses lines', () => {
    expect(ratchet(file(), file({ team: 40, upstream: 30, significant: 60, matched: 4 })).ok).toBe(true)
  })

  it('fails a file that becomes identical to an upstream file', () => {
    expect(ratchet(file(), file({ class: 'identical', identical: true })).ok).toBe(false)
  })
})

describe('blameFile team pattern', () => {
  const team = /thong|nikethai|canvilled|huyminh|huynguyen|noreply@anthropic\.com/i
  let repo
  let baseline

  const git = (args, author) =>
    execFileSync('git', args, {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: author?.[0] ?? 'Someone',
        GIT_AUTHOR_EMAIL: author?.[1] ?? 'someone@example.com',
        GIT_COMMITTER_NAME: 'Committer',
        GIT_COMMITTER_EMAIL: 'committer@example.com',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
      },
    }).trim()
  const commit = (content, author) => {
    writeFileSync(join(repo, 'a.ts'), content)
    git(['add', 'a.ts'])
    git(['commit', '-q', '-m', 'change'], author)
    return git(['rev-parse', 'HEAD'])
  }

  beforeAll(() => {
    repo = mkdtempSync(join(tmpdir(), 'provenance-'))
    git(['init', '-q', '-b', 'main'])
    commit('upstream line one\n', ['Upstream Dev', 'dev@upstream.example'])
    // an upstream commit by the same address Claude uses on the fork
    baseline = commit('upstream line one\nupstream claude line\n', ['Claude', 'noreply@anthropic.com'])
    commit('upstream line one\nupstream claude line\nfork claude line\nfork team line\n', [
      'Claude',
      'noreply@anthropic.com',
    ])
    commit('upstream line one\nupstream claude line\nfork claude line\nfork team line\nthong line\n', [
      'Thong',
      'thong@example.com',
    ])
  })

  afterAll(() => {
    rmSync(repo, { recursive: true, force: true })
  })

  it('credits fork lines by noreply@anthropic.com to the team, and lines reachable from a baseline to upstream', async () => {
    expect(await blameFile(repo, 'HEAD', 'a.ts', team, [baseline])).toEqual({ team: 3, upstream: 2 })
  })
})

const hasObject = (sha) => {
  try {
    execFileSync('git', ['cat-file', '-e', `${sha}^{commit}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}
const regression =
  process.env.PROVENANCE_REGRESSION === '1' &&
  ['2e3a77cebb305b91c47f96eb803ea66be67ef779', ...loadConfig().baselines].every(hasObject)

// Full blame of 2,437 files, about 15 minutes. Run with PROVENANCE_REGRESSION=1 after fetching the baselines.
describe.skipIf(!regression)('baseline regression', () => {
  it(
    'reproduces the 2026-10-28 audit class counts at 2e3a77ce over all files',
    async () => {
      const results = await scanRef({ ref: '2e3a77ce', all: true })
      const counts = { identical: 0, upstream: 0, mixed: 0, trace: 0, clean: 0 }
      for (const r of results) {
        counts[r.class]++
      }
      expect(results).toHaveLength(2437)
      expect(counts).toEqual({ identical: 268, upstream: 226, mixed: 169, trace: 297, clean: 1477 })
    },
    60 * 60_000
  )
})
