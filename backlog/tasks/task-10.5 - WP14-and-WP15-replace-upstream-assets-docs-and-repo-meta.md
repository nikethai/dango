---
id: TASK-10.5
title: 'WP14 and WP15: replace upstream assets, docs and repo meta'
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
ordinal: 16000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The audit found 68 asset files identical to upstream (old app icons, third-party brand logos, installer script) and 27 docs or meta files (provider how-tos, testing doc, README parts, the team-sharing kit, ralph scripts). docs/archive holds 6 upstream-text files; the maintainer decides between deleting them and listing them as an exception (plan Task 5).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No WP14 or WP15 file scans as identical, upstream or mixed, except docs/archive if kept as a documented exception
- [ ] #2 Every third-party logo has its source recorded in src/renderer/static/logos/SOURCES.md
- [ ] #3 pnpm build:web passes
<!-- AC:END -->
