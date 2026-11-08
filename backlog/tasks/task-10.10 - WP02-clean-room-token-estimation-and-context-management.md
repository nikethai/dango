---
id: TASK-10.10
title: 'WP02: clean-room token estimation and context management'
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:14:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.9
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 21000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There are 19 files with upstream origin (about 3.1k lines): the token-estimation queue, analyzer, persister and executor, plus context-management and model-context. The spec states the token budget rules and compaction thresholds as numbers. A simpler design is encouraged; a different structure also lowers the risk of converging on the upstream code (plan Task 10).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A WP02 spec states the budget rules and thresholds numerically, and the tests check them
- [ ] #2 The old WP02 files are deleted; pnpm check, lint and test pass; the provenance scan of changed files exits 0
<!-- AC:END -->
