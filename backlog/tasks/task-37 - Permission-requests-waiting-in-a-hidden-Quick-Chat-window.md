---
id: TASK-37
title: Permission requests waiting in a hidden Quick Chat window
status: Ideas
assignee: []
created_date: '2026-10-20 03:38'
labels:
  - permissions
dependencies: []
ordinal: 55000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Each window has its own permission queue. A request raised in a hidden Quick Chat window times out unseen after 2 minutes and is refused. Left by slice 06c (docs/specs/2026-10-17-slice-06c-permission-swarm-search.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A request in a hidden Quick Chat window is shown or notified before it times out
<!-- AC:END -->
