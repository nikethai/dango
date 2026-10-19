---
id: TASK-22
title: Flush pending source removals on quit
status: Ideas
assignee: []
created_date: '2026-10-19 10:53'
labels:
  - sources
dependencies: []
ordinal: 40000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Removing a source waits 5 s for Undo before revoking it. Quitting inside that window means the source comes back on the next launch, whole and consistent. The renderer has no quit hook today. Found in the slice 07 final review (docs/specs/2026-10-17-slice-07-sources-background.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A source removed less than 5 s before quitting is not present after relaunch
<!-- AC:END -->
