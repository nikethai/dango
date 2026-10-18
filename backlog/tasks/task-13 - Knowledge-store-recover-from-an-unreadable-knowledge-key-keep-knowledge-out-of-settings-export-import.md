---
id: TASK-13
title: >-
  Knowledge store: recover from an unreadable 'knowledge' key; keep knowledge
  out of settings export/import
status: Ideas
assignee: []
created_date: '2026-10-18 05:33'
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
