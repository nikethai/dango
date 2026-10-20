---
id: TASK-31
title: 'Multi-agent rooms: ability, cost and plan-mode gaps'
status: Ideas
assignee: []
created_date: '2026-10-19 18:31'
updated_date: '2026-10-19 18:31'
labels:
  - chat
dependencies: []
ordinal: 49000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rooms have several pre-send gaps: an @mention that turns a chat into a room after the check isn't seen; room cost estimates count one run (Swarm prices every agent at the composer's model); Continue on a stopped plan isn't gated for rooms or web/mobile (6a planContinueState); messages.ts still sets planPhase 'planning' in rooms. Left by slice 06b (docs/specs/2026-10-17-slice-06b-chat-actions-errors.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Ability and cost checks see the room the send will create
- [ ] #2 Room estimates price each agent's own model
- [ ] #3 Continue on a stopped plan is only offered where plan runs can execute
<!-- AC:END -->
