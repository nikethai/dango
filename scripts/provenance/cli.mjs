#!/usr/bin/env node
// pnpm provenance [--ref <ref>] [--paths <path|dir|glob>…] [--changed] [--fail] [--csv <out>] [--summary] [--all]
// See docs/specs/2026-10-17-clean-room-relicense.md, Task 1.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { git, isExcluded, loadConfig, matchesPaths, ROOT, ratchet, scanRef } from './scan.mjs'

const CLASSES = ['identical', 'upstream', 'mixed', 'trace', 'clean']

function parseArgs(argv) {
  const opts = { ref: 'HEAD', paths: null, changed: false, fail: false, csv: null, summary: false, all: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--ref') {
      opts.ref = argv[++i]
    } else if (arg === '--csv') {
      opts.csv = argv[++i]
    } else if (arg === '--paths') {
      opts.paths = []
      while (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        opts.paths.push(argv[++i])
      }
    } else if (arg === '--changed' || arg === '--fail' || arg === '--summary' || arg === '--all') {
      opts[arg.slice(2)] = true
    } else if (arg === '--') {
      // pnpm passes a separator through
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }
  return opts
}

/** Minimal CSV reader for files.csv (quoted fields, no embedded newlines). */
function readCsv(file) {
  const [header, ...rows] = readFileSync(file, 'utf8').split('\n').filter(Boolean)
  const split = (line) => {
    const out = []
    let cur = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"'
          i++
        } else if (ch === '"') {
          quoted = false
        } else {
          cur += ch
        }
      } else if (ch === '"') {
        quoted = true
      } else if (ch === ',') {
        out.push(cur)
        cur = ''
      } else {
        cur += ch
      }
    }
    out.push(cur)
    return out
  }
  const cols = split(header)
  return rows.map((line) => Object.fromEntries(split(line).map((v, i) => [cols[i], v])))
}

const csvField = (v) => (/[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))

function workPackages() {
  const map = new Map()
  for (const row of readCsv(join(ROOT, loadConfig().workPackages))) {
    map.set(row.path, row.work_package)
  }
  return map
}

function writeCsv(file, results, wps) {
  const header = [
    'work_package',
    'path',
    'class',
    'upstream_lines_est',
    'upstream_share',
    'blame_team',
    'blame_upstream',
    'closest_upstream_file',
  ]
  const rows = results
    .filter((r) => r.class !== 'clean')
    .map((r) =>
      [
        wps.get(r.path) ?? '',
        r.path,
        r.class,
        r.upstreamEst,
        Math.round(r.share * 1000) / 1000,
        r.team,
        r.upstream,
        r.sources.slice(0, 2).join(';'),
      ]
        .map(csvField)
        .join(',')
    )
  writeFileSync(file, `${[header.join(','), ...rows].join('\n')}\n`)
}

function printCounts(results) {
  const counts = Object.fromEntries(CLASSES.map((c) => [c, 0]))
  for (const r of results) {
    counts[r.class]++
  }
  console.log(`${results.length} files: ${CLASSES.map((c) => `${c} ${counts[c]}`).join(', ')}`)
}

function printSummary(results, wps) {
  const byWp = new Map()
  for (const r of results.filter((x) => x.class !== 'clean')) {
    const wp = wps.get(r.path) ?? '(not in files.csv)'
    const entry = byWp.get(wp) ?? { files: 0, lines: 0 }
    entry.files++
    entry.lines += r.upstreamEst
    byWp.set(wp, entry)
  }
  const width = Math.max(...[...byWp.keys()].map((k) => k.length), 5)
  let files = 0
  let lines = 0
  for (const [wp, e] of [...byWp].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`${wp.padEnd(width)}  ${String(e.files).padStart(5)} files  ${String(e.lines).padStart(7)} lines`)
    files += e.files
    lines += e.lines
  }
  console.log(`${'total'.padEnd(width)}  ${String(files).padStart(5)} files  ${String(lines).padStart(7)} lines`)
}

const progress = (done, total) => {
  if (total >= 200 && (done % 100 === 0 || done === total)) {
    process.stderr.write(`scanned ${done}/${total}\n`)
  }
}

async function changed(opts) {
  const config = loadConfig()
  const base = (await git(ROOT, ['merge-base', 'origin/main', opts.ref])).trim()
  const diff = (await git(ROOT, ['diff', '--name-status', '-M', '-z', base, opts.ref])).split('\0').filter(Boolean)
  const pairs = []
  for (let i = 0; i < diff.length; ) {
    const status = diff[i++]
    if (status.startsWith('R') || status.startsWith('C')) {
      pairs.push({ from: status.startsWith('R') ? diff[i] : null, to: diff[i + 1] })
      i += 2
    } else {
      const path = diff[i++]
      if (status !== 'D') {
        pairs.push({ from: status === 'A' ? null : path, to: path })
      }
    }
  }
  const relevant = pairs.filter(
    (p) => (opts.all || !isExcluded(p.to, config)) && (!opts.paths || matchesPaths(p.to, opts.paths))
  )
  if (relevant.length === 0) {
    console.log('No changed files to check.')
    return true
  }
  const [heads, bases] = await Promise.all([
    scanRef({ ref: opts.ref, all: true, exact: new Set(relevant.map((p) => p.to)), onProgress: progress }),
    scanRef({ ref: base, all: true, exact: new Set(relevant.filter((p) => p.from).map((p) => p.from)) }),
  ])
  const headBy = new Map(heads.map((r) => [r.path, r]))
  const baseBy = new Map(bases.map((r) => [r.path, r]))
  let ok = true
  for (const p of relevant) {
    const head = headBy.get(p.to)
    const before = p.from ? (baseBy.get(p.from) ?? null) : null
    const verdict = ratchet(before, head)
    ok &&= verdict.ok
    const was = before ? `${before.class} → ` : 'new, '
    console.log(
      `${verdict.ok ? 'ok  ' : 'FAIL'}  ${p.to}  (${was}${head.class})${verdict.ok ? '' : `: ${verdict.reason}`}`
    )
  }
  console.log(
    ok
      ? `Provenance gate passed for ${relevant.length} changed file(s) against ${base.slice(0, 8)}.`
      : 'Provenance gate failed. Clean-room the flagged code (docs/specs/2026-10-17-clean-room-relicense.md).'
  )
  return ok
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  if (opts.changed) {
    return (await changed(opts)) || !opts.fail ? 0 : 1
  }
  const results = await scanRef({ ref: opts.ref, all: opts.all, paths: opts.paths, onProgress: progress })
  const wps = opts.csv || opts.summary ? workPackages() : null
  if (opts.csv) {
    writeCsv(opts.csv, results, wps)
  }
  if (opts.summary) {
    printSummary(results, wps)
  }
  printCounts(results)
  const flagged = results.filter((r) => r.class !== 'clean')
  if (opts.fail && flagged.length > 0) {
    for (const r of flagged.slice(0, 50)) {
      console.log(`FAIL  ${r.path}  (${r.class}, about ${r.upstreamEst} upstream lines)`)
    }
    if (flagged.length > 50) {
      console.log(`… and ${flagged.length - 50} more`)
    }
    return 1
  }
  return 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(2)
  }
)
