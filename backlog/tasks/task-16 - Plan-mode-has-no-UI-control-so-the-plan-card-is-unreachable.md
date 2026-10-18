---
id: TASK-16
title: 'Plan mode has no UI control, so the plan card is unreachable'
status: Ideas
assignee: []
created_date: '2026-10-18 15:43'
labels: []
dependencies: []
type: feature
ordinal: 34000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
No component or route in the app writes planMode (settings.planMode / session.settings.planMode); git history shows none ever did. Plan mode, and so slice 06a's plan card (proposed, running, stopped with Continue, finished with a Review Change), only appears when planMode is set outside the UI (import, sync, devtools). The running card and live thinking line have also not been tried against a real streaming model. Decide which slice owns a plan-mode control (composer toggle or chat settings) and whether Continue's 'blocked when plan mode is off' state should stay.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The maintainer picks the slice that owns a plan-mode control
- [ ] #2 A user can turn plan mode on for an agent chat from the UI
- [ ] #3 A plan runs end to end against a real model: proposed, running, stopped, Continue, finished, Change in Review
<!-- AC:END -->
