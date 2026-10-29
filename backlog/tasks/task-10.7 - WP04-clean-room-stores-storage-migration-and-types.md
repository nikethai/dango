---
id: TASK-10.7
title: 'WP04: clean-room stores, storage, migration and types'
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:14:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.6
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 18000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There are 62 files of state and persistence code with upstream origin (about 6.6k lines), including migration.ts, chatStore.ts, sessionHelpers.ts, generation.ts and the settings and session types. This is the riskiest package, because existing installs must keep their data. Storage keys and JSON field names are the allowed compatibility boundary. Whether migrations for old upstream data versions are dropped is a maintainer decision (plan Task 7).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A WP04 spec lists the compatibility boundary: StorageKey values, key formats, and the settings and session field names
- [ ] #2 A snapshot test loads a scrubbed store from the current release and round-trips sessions, message counts, provider keys and settings JSON
- [ ] #3 The old WP04 files are deleted; pnpm check, lint and test pass; the provenance scan of changed files exits 0
<!-- AC:END -->
