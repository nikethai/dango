---
id: TASK-22
title: Flush pending source removals on quit
status: Done
assignee: []
created_date: 2026-10-19 10:53
updated_date: '2026-11-08T15:34:00Z'
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
- [x] #1 A source removed less than 5 s before quitting is not present after relaunch
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in #110 (redesign blockers, task 10). Verified 2026-11-08 on main da41b5f: pending-removal.test.ts and sources/store.test.ts pass. Covered by unit tests; not tried as a real quit and relaunch of the desktop app.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed in #110. Removing a source now stores removalPendingAt instead of waiting on an in-memory timer; the source is hidden at once and the main window's launch and due checks revoke it before any job starts, so quitting inside the 5 s undo window no longer brings it back. Remaining edge (known-issues register): a removal whose revoke keeps failing stays hidden and silent.
<!-- SECTION:FINAL_SUMMARY:END -->
