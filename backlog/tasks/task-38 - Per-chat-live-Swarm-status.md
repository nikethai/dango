---
id: TASK-38
title: Per-chat live Swarm status
status: Ideas
assignee: []
created_date: '2026-10-20 03:38'
labels:
  - chat
dependencies: []
ordinal: 56000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Team room live status is one global slot, so two Swarms in two chats overwrite each other's live card and Stop routing. Pre-existing; slice 06c's Stop guard also reads it. Left by slice 06c (docs/specs/2026-10-17-slice-06c-permission-swarm-search.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Two Swarms in two chats each keep their own live card and Stop
<!-- AC:END -->
