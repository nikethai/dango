---
id: TASK-47
title: >-
  Offer to draft replies for recent unanswered mail when Gmail review is turned
  on
status: Ideas
assignee: []
created_date: '2026-10-22 00:28'
labels:
  - pm-pilot
dependencies: []
ordinal: 65000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
When the user turns Background review back on for a Gmail source, Dango acts only on mail that arrives afterwards (maintainer decision 2026-10-21, docs/specs/2026-10-21-blocker-decisions.md D4). Offer once, in the same place: 'Draft replies for the last 3 days' unanswered mail?' Accepting drafts replies (never sends) for threads in that window whose newest inbound message has no reply and no Dango draft; declining or ignoring changes nothing. Trust, the daily draft cap and local-only rules still apply.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Turning review on shows the offer once per switch-on, only when such mail exists
- [ ] #2 Accepting drafts only unanswered threads from the last 3 days; nothing is sent
- [ ] #3 Declining leaves older mail stored and searchable, not drafted
<!-- AC:END -->
