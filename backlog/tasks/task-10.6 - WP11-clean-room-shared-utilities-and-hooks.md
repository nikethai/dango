---
id: TASK-10.6
title: 'WP11: clean-room shared utilities and hooks'
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:14:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.2
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 17000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There are 53 utility and hook files with upstream code (about 3.5k lines), for example format-chat, request, file-extensions, message utils, cache and model-tester. Other packages build on them, so they go first. Maintained libraries are preferred over hand-written helpers. word_count.ts is third-party MIT code: keep it with its notice, or replace it (plan Task 6).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A WP11 behaviour spec exists in docs/specs/clean-room/ and a docs/log.md line records it
- [ ] #2 The new modules are written from the spec only, with tests from its test tables, and the old WP11 files are deleted
- [ ] #3 pnpm check, lint and test pass, and pnpm provenance --changed --fail exits 0
<!-- AC:END -->
