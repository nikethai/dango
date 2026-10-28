---
id: TASK-10.1
title: Provenance scanner and CI gate
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:13:00Z'
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
- [ ] #1 pnpm provenance classifies files as identical, upstream, mixed, trace or clean using blame -w -M -C -C plus 4-line copy matching against the pinned baseline refs (fe801920, 40cbd874, 0ac6385a)
- [ ] #2 Run with --ref 2e3a77ce --all, it reproduces the 2026-10-28 audit counts: identical 268, upstream 226, mixed 169, trace 297, clean 1,477
- [ ] #3 The team author pattern in config.json includes noreply@anthropic.com
- [ ] #4 A pull_request workflow fails when a changed file is not clean and not allowlisted
- [ ] #5 Tags provenance-baseline-2026-10-17 (3f7c2725) and provenance-baseline-2026-10-28 (2e3a77ce) exist on origin
<!-- AC:END -->
