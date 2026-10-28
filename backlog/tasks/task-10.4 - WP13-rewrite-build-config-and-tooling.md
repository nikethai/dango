---
id: TASK-10.4
title: 'WP13: rewrite build config and tooling'
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:13:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.1
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 15000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Config files such as package.json, tailwind.config.js, biome.json, tsconfig.json and the Vite and Vitest configs still come from upstream, along with leftover ESLint and Prettier files. They are mostly functional, but rewriting them from tool docs is cheap and removes doubt. The CHATBOX_* env vars become DANGO_*, keeping the old names as fallbacks for one release (plan Task 4).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The WP13 files are rewritten or deleted and scan clean
- [ ] #2 The path aliases @/* and @shared/* still resolve in the build and in tests
- [ ] #3 pnpm install, check, lint, test, build:web and build all pass
<!-- AC:END -->
