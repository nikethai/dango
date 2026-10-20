---
id: TASK-39
title: 'Permission grants: clean up on scope delete; timeout wording'
status: Ideas
assignee: []
created_date: '2026-10-20 03:38'
labels:
  - permissions
dependencies: []
ordinal: 57000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Deleting a scope leaves its grants behind (inactive); undo of a scope delete should restore them. A permission timeout is told to the model and audit log as 'Not now' rather than 'no answer in time'. The audit log is last-writer-wins across windows. Left by slice 06c (docs/specs/2026-10-17-slice-06c-permission-swarm-search.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Deleting a scope removes its grants and undo restores them
<!-- AC:END -->
