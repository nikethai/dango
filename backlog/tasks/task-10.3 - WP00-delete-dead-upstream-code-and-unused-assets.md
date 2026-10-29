---
id: TASK-10.3
title: 'WP00: delete dead upstream code and unused assets'
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-29T15:46:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.1
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 14000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The 2026-10-28 audit found 65 upstream files (about 3.0k lines) that nothing in src/ imports: old setting tabs, index.ejs, components/ui/command.tsx and other files the redesign stopped using, unused icon components and 17 provider PNGs. Deleting them is the cheapest progress. The usage check resolves imports but does not read build or test config, so a few files (index.ejs, setupTests.ts, test.tsx) may still be wired up; those move to their topic WP. Whether the dev routes are kept is a maintainer decision (plan Task 3).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 All WP00 rows in files.csv are deleted, or reassigned to another WP with a reason
- [ ] #2 pnpm check, pnpm test and pnpm build:web pass
- [ ] #3 The maintainer decision on src/renderer/routes/dev is recorded in the task notes
- [ ] #4 Tests that list deleted file paths (for example sheetInventory.test.ts) are updated in the same PR
<!-- AC:END -->
