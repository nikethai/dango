---
id: TASK-10.14
title: 'WP01: rebuild i18n with structured keys and new copy'
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:13:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.13
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 25000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
All 13 non-English locale files are upstream translations, and the English locale uses upstream English sentences as keys (1,283 keys). The changelogs are upstream release notes. This runs after the UI rebuild, so keys used only by the old UI are already gone. Fewer shipped locales is acceptable (plan Task 14).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Keys are structured IDs and the English copy is written fresh from the UX flows copy rules
- [ ] #2 A key-coverage test passes: every key in source exists in English and in every shipped locale
- [ ] #3 The old locale files, changelogs and script/translate.mjs are deleted; the provenance scan of src/renderer/i18n exits 0
<!-- AC:END -->
