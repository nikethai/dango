---
id: TASK-41
title: 'Risk engine: fewer false positives on device reads and permission removal'
status: Ideas
assignee: []
created_date: '2026-10-20 03:38'
labels:
  - permissions
dependencies: []
ordinal: 59000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 06c's destructive-command hardening makes reading /dev/urandom or /dev/zero and 'chmod -rwx ~' (removing permissions) ask every time. Left by slice 06c (docs/specs/2026-10-17-slice-06c-permission-swarm-search.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Reading random/zero devices and removing permissions are not rated CRITICAL
<!-- AC:END -->
