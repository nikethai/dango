---
id: TASK-10.8
title: 'WP05: clean-room platform layer, bootstrap and app shell'
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:14:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.7
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 19000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There are 39 files across the platform implementations (desktop, web, test), storages, logger, index.tsx, Sidebar.tsx and setup modules (about 3.1k lines). Desktop, web and mobile must behave the same afterwards. The Tauri IPC command names are already clean and stay as the boundary. Sidebar.tsx overlaps the Dango theme slice, so it is built fresh rather than restyled (plan Task 8).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 One platform contract test suite passes against the desktop (mocked IPC), web and test platforms
- [ ] #2 The old WP05 files are deleted; pnpm check, lint, test and build:web pass; the provenance scan of changed files exits 0
<!-- AC:END -->
