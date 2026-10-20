---
id: TASK-35
title: Remove the unreachable Team room discuss/work code
status: Ideas
assignee: []
created_date: '2026-10-20 03:38'
labels:
  - chat
dependencies: []
ordinal: 53000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 06c made Swarm a single toggle; chat/TeamRoomActions.tsx and the discuss/work orchestrators can no longer be reached from the UI. Legacy chats with those modes now answer as their first agent. Left by slice 06c (docs/specs/2026-10-17-slice-06c-permission-swarm-search.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 No discuss/work room code remains and legacy chats still open
<!-- AC:END -->
