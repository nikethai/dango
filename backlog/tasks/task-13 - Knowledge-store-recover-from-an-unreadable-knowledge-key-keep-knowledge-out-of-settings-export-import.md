---
id: TASK-13
title: >-
  Knowledge store: recover from an unreadable 'knowledge' key; keep knowledge
  out of settings export/import
status: Done
assignee: []
created_date: 2026-10-18 05:33
updated_date: '2026-11-08T15:34:00Z'
labels:
  - knowledge
dependencies: []
references:
  - docs/specs/2026-10-17-slice-04-knowledge.md
type: bug
ordinal: 31000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in slice 04's final review. (1) The knowledge store fails closed when the 'knowledge' key reads null (stored literal null and corrupt JSON look the same), so knowledge can't be saved and nothing recovers it. Only installs of the unreleased slice-04 branch (old getItem default-write) or imports from them can reach it. Smallest fix: an optional Platform getStoreRaw(key); treat a raw 'null' or '' like a missing key; keep failing closed otherwise; optionally a confirmed 'start over' action in the Knowledge tab. (2) Settings export/import (AdvancedSettingTab, settings/general.tsx) copies the whole knowledge and knowledge-migration documents over the target device's own; leave them out or merge. Fix before release.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in #110 (redesign blockers, task 7). Verified 2026-11-08 on main da41b5f: knowledge/store.test.ts, MemoryPrivacyPage.test.tsx, exportFilter.test.ts, exportFilter.deps.test.ts and routes/settings/-general-export.test.tsx pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Both parts fixed in #110. (1) A knowledge key that reads null, empty or 'null' counts as missing; corrupt JSON still fails closed, and Memory and privacy then shows 'Knowledge can't be read' with a confirmed Start over (getStoreRaw on the platform). (2) knowledge, knowledge-migration and sources never leave or enter through settings export/import; chats that quote device-only mail are left out unless the user ticks a box (maintainer decision 2026-10-22). Follow-ups noted in the known-issues register: a failed Start over is only logged.
<!-- SECTION:FINAL_SUMMARY:END -->
