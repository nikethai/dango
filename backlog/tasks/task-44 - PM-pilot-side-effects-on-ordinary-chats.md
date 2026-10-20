---
id: TASK-44
title: PM pilot side-effects on ordinary chats
status: Ideas
assignee: []
created_date: '2026-10-20 18:24'
labels:
  - pm-pilot
dependencies: []
ordinal: 62000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From slice 10 reviews: (1) while any client scope has Gmail or Asana, Gemini native grounding is off in every desktop chat (stream-text.ts); (2) after a local-only client_recall, cloud turns in that chat lose all later assistant context (fail-closed); (3) Quick Chat and the main window before its first sync show no 'sign in again' gap because source health is per window.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Gemini grounding is only turned off in chats where client_recall can load
- [ ] #2 After a local-only recall only the recall-derived content is hidden on cloud turns
- [ ] #3 Source health is shared across windows
<!-- AC:END -->
