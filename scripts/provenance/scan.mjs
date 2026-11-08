// Upstream provenance scanner: decides whether each file is upstream-derived.
// Method: docs/specs/2026-10-17-clean-room-relicense.md (Task 1) and docs/research/2026-10-28-upstream-provenance-after-redesign.md.
import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = join(HERE, '..', '..')

export function loadConfig() {
  return JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'))
}

export function loadAllowlist(file = join(HERE, 'allowlist.txt')) {
  const hashes = new Set()
  for (const raw of readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (line && !line.startsWith('#')) {
      hashes.add(line.split(/\s+/)[0])
    }
  }
  return hashes
}

function git(repo, args, { encoding = 'utf8' } = {}) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: repo, encoding, maxBuffer: 1 << 30 }, (error, stdout) =>
      error ? reject(error) : resolve(stdout)
    )
  })
}

// --- copy check -----------------------------------------------------------------------------------------------

const TRIVIAL = /^[\s{}()[\];,]*$|^(import|export \{|\} from|\/\/|\/\*|\*|<\/)/

/** Significant lines: trimmed, runs of whitespace collapsed, at least 10 characters, not trivial. */
export function normalizeLines(text) {
  const out = []
  text.split('\n').forEach((raw, line) => {
    const t = raw.trim().replace(/\s+/g, ' ')
    if (t.length >= 10 && !TRIVIAL.test(t)) {
      out.push({ line, text: t })
    }
  })
  return out
}

/** One hash per run of k consecutive significant lines; from/to index into `lines`. */
export function shingleHashes(lines, k = 4) {
  const out = []
  for (let i = 0; i + k <= lines.length; i++) {
    const joined = lines
      .slice(i, i + k)
      .map((l) => l.text)
      .join('\n')
    out.push({ from: i, to: i + k - 1, hash: createHash('md5').update(joined).digest('hex').slice(0, 16) })
  }
  return out
}

/** Reads every blob in a git batch call. Returns Map<sha, Buffer>. */
function readBlobs(repo, shas) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['cat-file', '--batch'], { cwd: repo })
    const chunks = []
    child.stdout.on('data', (c) => chunks.push(c))
    child.on('error', reject)
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`git cat-file exited ${code}`))
        return
      }
      const buf = Buffer.concat(chunks)
      const blobs = new Map()
      let pos = 0
      while (pos < buf.length) {
        const nl = buf.indexOf(10, pos)
        const [sha, type, size] = buf.subarray(pos, nl).toString().split(' ')
        if (type === 'missing') {
          pos = nl + 1
          continue
        }
        const start = nl + 1
        blobs.set(sha, buf.subarray(start, start + Number(size)))
        pos = start + Number(size) + 1
      }
      resolve(blobs)
    })
    child.stdin.end(`${[...new Set(shas)].join('\n')}\n`)
  })
}

async function listTree(repo, ref) {
  const out = await git(repo, ['ls-tree', '-r', '-z', ref])
  return out
    .split('\0')
    .filter(Boolean)
    .map((entry) => {
      const tab = entry.indexOf('\t')
      const [mode, type, sha] = entry.slice(0, tab).split(' ')
      return { mode, type, sha, path: entry.slice(tab + 1) }
    })
    .filter((e) => e.type === 'blob')
}

const isBinary = (buf) => buf.subarray(0, 8000).includes(0)

/** Map<hash, Set<path>> over the text blobs, filtered by extension, in the trees of `refs`. */
export async function buildCorpus(repo, refs, extensions = loadConfig().corpusExtensions) {
  const exts = new Set(extensions)
  const pathsBySha = new Map()
  for (const ref of refs) {
    for (const e of await listTree(repo, ref)) {
      const ext = e.path.includes('.') ? e.path.slice(e.path.lastIndexOf('.') + 1) : ''
      if (exts.has(ext)) {
        if (!pathsBySha.has(e.sha)) {
          pathsBySha.set(e.sha, new Set())
        }
        pathsBySha.get(e.sha).add(e.path)
      }
    }
  }
  const blobs = await readBlobs(repo, [...pathsBySha.keys()])
  const corpus = new Map()
  for (const [sha, paths] of pathsBySha) {
    const buf = blobs.get(sha)
    if (!buf || isBinary(buf)) {
      continue
    }
    for (const { hash } of shingleHashes(normalizeLines(buf.toString('utf8')))) {
      if (!corpus.has(hash)) {
        corpus.set(hash, new Set())
      }
      for (const p of paths) {
        corpus.get(hash).add(p)
      }
    }
  }
  return corpus
}

/** Significant lines, how many fall inside a 4-line run also found upstream, and the upstream files matched most. */
export function matchFile(text, corpus, allowlist = new Set()) {
  const lines = normalizeLines(text)
  const covered = new Uint8Array(lines.length)
  const hits = new Map()
  for (const { from, to, hash } of shingleHashes(lines)) {
    const paths = corpus.get(hash)
    if (!paths || allowlist.has(hash)) {
      continue
    }
    covered.fill(1, from, to + 1)
    for (const p of paths) {
      hits.set(p, (hits.get(p) ?? 0) + 1)
    }
  }
  const sources = [...hits].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([p]) => p)
  return { significant: lines.length, matched: covered.reduce((n, c) => n + c, 0), sources }
}

// --- blame ----------------------------------------------------------------------------------------------------

const baselineCache = new Map()

/** Every commit reachable from any baseline ref. */
async function baselineCommits(repo, refs) {
  const key = `${repo}\0${refs.join(' ')}`
  if (!baselineCache.has(key)) {
    baselineCache.set(
      key,
      git(repo, ['rev-list', ...refs]).then((out) => new Set(out.split('\n').filter(Boolean)))
    )
  }
  return baselineCache.get(key)
}

/**
 * Blames every line with move and copy detection. A line is team when its author email matches `teamPattern`
 * and its commit is not reachable from a baseline; every other line is upstream.
 */
export async function blameFile(repo, ref, path, teamPattern, baselineRefs) {
  const [baseline, out] = await Promise.all([
    baselineCommits(repo, baselineRefs),
    git(repo, ['blame', '-w', '-M', '-C', '-C', '--line-porcelain', ref, '--', path]),
  ])
  let team = 0
  let upstream = 0
  let sha = ''
  let mail = ''
  for (const line of out.split('\n')) {
    if (line.startsWith('\t')) {
      if (teamPattern.test(mail) && !baseline.has(sha)) {
        team++
      } else {
        upstream++
      }
    } else if (line.startsWith('author-mail ')) {
      mail = line.slice('author-mail '.length)
    } else if (/^[0-9a-f]{40} /.test(line)) {
      sha = line.slice(0, 40)
    }
  }
  return { team, upstream }
}

// --- classification -------------------------------------------------------------------------------------------

export function share({ team, upstream, significant, matched }) {
  const blamed = team + upstream
  return Math.max(blamed ? upstream / blamed : 0, significant ? matched / significant : 0)
}

export function classify(r) {
  if (r.identical) {
    return 'identical'
  }
  const s = share(r)
  if (s >= 0.8) {
    return 'upstream'
  }
  if (s >= 0.1) {
    return 'mixed'
  }
  if (r.upstream >= 1 || r.matched >= 4) {
    return 'trace'
  }
  return 'clean'
}

/**
 * PR gate. `base` is the file at the merge base, or null for a file the PR adds. A PR may edit or shrink a flagged
 * file, but may not add a non-clean file, make a clean file non-clean, or add upstream blame or copy-matched lines.
 */
export function ratchet(base, head) {
  if (head.class === 'clean') {
    return { ok: true }
  }
  if (!base) {
    return { ok: false, reason: `new file is ${head.class}, not clean` }
  }
  if (base.class === 'clean') {
    return { ok: false, reason: `was clean, now ${head.class}` }
  }
  if (head.identical && !base.identical) {
    return { ok: false, reason: 'now identical to an upstream file' }
  }
  if (head.upstream > base.upstream) {
    return { ok: false, reason: `upstream blame lines rose from ${base.upstream} to ${head.upstream}` }
  }
  if (head.matched > base.matched) {
    return { ok: false, reason: `copy-matched lines rose from ${base.matched} to ${head.matched}` }
  }
  return { ok: true }
}

// --- scanning a ref -------------------------------------------------------------------------------------------

async function pool(items, size, fn) {
  const results = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i], i)
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker))
  return results
}

const contextCache = new Map()

/** Upstream data shared by every scan in a process: identical blobs, the copy corpus and the allowlist. */
async function scanContext(repo, config) {
  if (!contextCache.has(repo)) {
    contextCache.set(
      repo,
      (async () => {
        const objects = await git(repo, ['rev-list', '--objects', ...config.identicalHistory])
        return {
          identical: new Set(objects.split('\n').map((l) => l.slice(0, 40))),
          corpus: await buildCorpus(repo, config.baselines, config.corpusExtensions),
          allowlist: loadAllowlist(),
          teamPattern: new RegExp(config.teamPattern, 'i'),
        }
      })()
    )
  }
  return contextCache.get(repo)
}

const globToRegExp = (glob) =>
  new RegExp(
    `^${glob
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*\/?/g, '\0')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '[^/]')
      .replace(/\0/g, '.*')}$`
  )

/** True when `path` is one of `patterns`: an exact path, a directory prefix or a glob. */
export function matchesPaths(path, patterns) {
  return patterns.some((p) => {
    if (/[*?]/.test(p)) {
      return globToRegExp(p).test(path)
    }
    const dir = p.replace(/\/$/, '')
    return path === dir || path.startsWith(`${dir}/`)
  })
}

export function isExcluded(path, config = loadConfig()) {
  return config.exclude.some((re) => new RegExp(re).test(path))
}

/**
 * Scans the files of `ref`. `paths` limits it to paths, directories or globs, and `exact` to a set of exact paths;
 * `all` turns off the config.json path exclusions. Returns one FileResult per file.
 */
export async function scanRef({ ref = 'HEAD', all = false, paths = null, exact = null, repo = ROOT, onProgress } = {}) {
  const config = loadConfig()
  const ctx = await scanContext(repo, config)
  const files = (await listTree(repo, ref)).filter(
    (f) =>
      (all || !isExcluded(f.path, config)) && (!paths || matchesPaths(f.path, paths)) && (!exact || exact.has(f.path))
  )
  const blobs = await readBlobs(
    repo,
    files.map((f) => f.sha)
  )
  let done = 0
  return pool(files, config.parallel, async (f) => {
    const result = await scanBlob(repo, ref, f.path, f.sha, blobs.get(f.sha), ctx, config)
    onProgress?.(++done, files.length)
    return result
  })
}

async function scanBlob(repo, ref, path, sha, buf, ctx, config) {
  const identical = ctx.identical.has(sha)
  let team = 0
  let upstream = 0
  let significant = 0
  let matched = 0
  let sources = []
  // Binaries and *.lock files are never blamed or copy-checked; only the identical check applies to them.
  if (!path.endsWith('.lock') && !isBinary(buf)) {
    ;({ team, upstream } = await blameFile(repo, ref, path, ctx.teamPattern, config.baselines))
    ;({ significant, matched, sources } = matchFile(buf.toString('utf8'), ctx.corpus, ctx.allowlist))
  }
  const r = { identical, team, upstream, significant, matched }
  const s = identical ? 1 : share(r)
  return {
    path,
    sha,
    ...r,
    class: classify(r),
    share: s,
    upstreamEst: Math.round(s * (team + upstream)),
    sources,
  }
}

export { git }
