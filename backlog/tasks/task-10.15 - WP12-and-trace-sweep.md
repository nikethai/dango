---
id: TASK-10.15
title: WP12 and trace sweep
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:14:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.3
  - TASK-10.4
  - TASK-10.5
  - TASK-10.6
  - TASK-10.7
  - TASK-10.8
  - TASK-10.9
  - TASK-10.10
  - TASK-10.11
  - TASK-10.12
  - TASK-10.13
  - TASK-10.14
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 26000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
WP12 holds 155 test files on 2026-10-28 (about 13.4k upstream lines). The old upstream tests mostly disappear with their modules in the earlier packages. What is left, including the integration test harness, needs rebuilding or deleting. 295 files are trace only (about 1.5k lines); most are new redesign tests that copied a few render helpers from ThreadHistoryDrawer.test.tsx and MessageList.test.tsx. Replace those helpers with one clean shared test helper; review every other flagged line and rewrite it, or allowlist it with a reason (plan Task 15).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No WP12 file remains non-clean
- [ ] #2 Each trace file is rewritten or allowlisted with a reason the reviewer signed off
- [ ] #3 pnpm provenance --fail exits 0 across the repo, apart from the documented exceptions
<!-- AC:END -->
