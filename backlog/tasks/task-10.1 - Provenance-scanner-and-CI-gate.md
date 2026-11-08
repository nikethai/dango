---
id: TASK-10.1
title: Provenance scanner and CI gate
status: Now
assignee:
  - '@claude'
created_date: 2026-10-17 07:24
updated_date: '2026-11-08T15:22:00Z'
labels:
  - licensing
dependencies: []
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-17-upstream-provenance.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign.md
parent_task_id: TASK-10
type: chore
ordinal: 12000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Every later step needs one repeatable definition of "clean", and a way to stop new upstream code entering through a PR. The upstream repo is public and may be in model training data, so AI-written code can reproduce it from memory. The 2026-10-17 and 2026-10-28 audits were done with throwaway scripts; this makes the method part of the repo (plan Task 1). Claude's commits are authored as noreply@anthropic.com; without that address in the team pattern the scanner would credit about 90k team lines to upstream.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 pnpm provenance classifies files as identical, upstream, mixed, trace or clean using blame -w -M -C -C plus 4-line copy matching against the pinned baseline refs (fe801920, 40cbd874, 0ac6385a)
- [x] #2 Run with --ref 2e3a77ce --all, it reproduces the 2026-10-28 audit counts: identical 268, upstream 226, mixed 169, trace 297, clean 1,477
- [x] #3 The team author pattern in config.json includes noreply@anthropic.com, and a line whose commit is reachable from a baseline counts as upstream whatever its author
- [ ] #4 A pull_request workflow runs pnpm provenance --changed --fail as a ratchet against the merge base: it fails when a new file is not clean, a clean file stops being clean, or a flagged file gains upstream blame or copy-matched lines, and passes when a flagged file is only rewired or shrunk
- [ ] #5 Tags provenance-baseline-2026-10-17 (3f7c2725) and provenance-baseline-2026-10-28 (2e3a77ce) exist on origin
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
1. Fetch the pinned upstream baselines (0ac6385a, 40cbd874) and unshallow the clone so blame sees full history.
2. Write scripts/provenance/scan.test.mjs first: normalisation, shingles, matching, classification, team pattern (temp git repo), ratchet, and the 2e3a77ce baseline regression (opt-in, skipped without the upstream objects).
3. Implement scan.mjs (normalizeLines, shingleHashes, buildCorpus, matchFile, blameFile, classify, ratchet, scanRef) and cli.mjs (--ref, --paths, --changed, --fail, --csv, --summary, --all), plus config.json and allowlist.txt.
4. Calibrate against the 2026-10-28 files.csv per file until --ref 2e3a77ce --all gives identical 268, upstream 226, mixed 169, trace 297, clean 1,477, and --summary matches the WP table.
5. Add pnpm provenance, the vitest include, and .github/workflows/provenance.yml (pull_request, fetch-depth 0, fetch baselines, pnpm provenance --changed --fail).
6. Tag provenance-baseline-2026-10-17 (3f7c2725) and provenance-baseline-2026-10-28 (2e3a77ce) and push the tags.
7. pnpm test, check, lint; commit build(provenance): add upstream provenance scanner and PR gate.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Implemented scripts/provenance (scan.mjs, cli.mjs, config.json, allowlist.txt, scan.test.mjs), pnpm provenance, the vitest include and .github/workflows/provenance.yml.

Evidence:
- Full scan at 2e3a77ce --all: identical 268, upstream 226, mixed 169, trace 297, clean 1,477. Compared file by file with the 2026-10-28 files.csv: 0 class, 0 blame-count and 0 line-estimate mismatches across all 2,284 in-scope files.
- pnpm provenance --ref 2e3a77ce --summary prints the 16 WPs of the audit table: 951 files, 79,699 lines.
- PROVENANCE_REGRESSION=1 vitest run scripts/provenance: 21 passed, regression 512 s.
- pnpm provenance --changed --fail on this branch passes (new files clean; package.json and vitest.config.mts edited but no upstream lines added).
- Throwaway commit authored as noreply@anthropic.com: a new file with upstream code, upstream lines appended to flagged parser.ts and to clean settingsNavModel.ts all FAIL (new file upstream; copy-matched 37 to 65; clean to mixed), exit 1.
- pnpm test: only tray-icons.test.ts fails (sharp not installable here, same as main); pnpm check 36, pnpm lint 9, unchanged.

Deviation: the baseline regression test is opt-in (PROVENANCE_REGRESSION=1) as well as skipped without the upstream objects, so pnpm test stays fast where the upstream refs are fetched.

Open: AC #4 is verified locally only; check it after the workflow runs on a PR. AC #5: pushing the tags from this session was refused (HTTP 403 on tag refs); the maintainer pushes them.
<!-- SECTION:NOTES:END -->
