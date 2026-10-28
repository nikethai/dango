---
id: TASK-10.13
title: 'WP07, WP09, WP10: clean-room the UI the redesign left'
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:13:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.2
documentation:
  - docs/specs/2026-10-16-redesign-brief.md
  - docs/specs/2026-10-16-ux-flows.md
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 24000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
After the redesign, settings (56 files), chat UI and components (168) and modals (20) still hold about 14.3k upstream-derived lines. The redesign edited most old UI files in place: 192 of the 206 files on the 2026-10-17 list are still flagged, and 52 new files picked up traces, including routes/new.tsx and settings/agents/AgentsSettings.tsx, which copy real upstream code. Each surface is rebuilt fresh in new files from the redesign brief and UX flows as shipped, then the old file is deleted. Restyling an old file such as InputBox.tsx keeps it upstream-derived (plan Task 13).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every WP07, WP09 and WP10 row in files.csv is rebuilt fresh in new files under the clean-room procedure, or deleted
- [ ] #2 Each PR passes pnpm provenance --changed --fail
- [ ] #3 pnpm provenance --summary shows WP07, WP09 and WP10 at 0 files
<!-- AC:END -->
