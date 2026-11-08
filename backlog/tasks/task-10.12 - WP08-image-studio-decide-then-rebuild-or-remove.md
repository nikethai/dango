---
id: TASK-10.12
title: 'WP08: image studio - decide, then rebuild or remove'
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:13:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.2
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 23000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The image creator route has 12 upstream-derived files (about 1.7k lines). The redesign moves Image studio into Advanced. Removing it until it is wanted again is the cheapest path; rebuilding it needs a short behaviour spec (plan Task 12).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The maintainer decision (rebuild or remove) is recorded in the task notes
- [ ] #2 Either way, no WP08 file scans as non-clean, and pnpm check and build:web pass
<!-- AC:END -->
