---
id: TASK-16
title: 'Plan mode has no UI control, so the plan card is unreachable'
status: Ideas
assignee: []
created_date: '2026-10-18 15:43'
updated_date: '2026-10-19 18:31'
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
- [x] #1 The maintainer picks the slice that owns a plan-mode control
- [ ] #2 A user can turn plan mode on for an agent chat from the UI
- [ ] #3 A plan runs end to end against a real model: proposed, running, stopped, Continue, finished, Change in Review
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Maintainer, 2026-10-18: users should be able to turn plan mode on; the slice is the agent's choice; add an end-to-end test if possible. Decision: slice 06b (chat actions, composer) owns it — a plan-mode toggle for agent chats in the composer, plus an end-to-end test of the plan flow (proposed → Run plan → running → Stop → Continue → finished → one Change in Review) driven through generate() with a scripted fake model, since no real model or API key is available in the build container. A real-model check stays a manual step.

Slice 06b (feat/redesign-06b-chat-actions-errors): Tools menu gets a Mode section on desktop and small screens (Agent Mode, Plan mode, Project folder); one writer setChatPlanMode/turnOnChatPlanMode; stopped plan card offers 'Turn on plan mode'; stores/session/plan-flow.test.ts drives proposed → Run plan → running → Stop → Continue → finished → one Change through generate() with a scripted model. AC #2 is checked once the PR merges; AC #3 (real model) stays a manual step in the PR.
<!-- SECTION:NOTES:END -->
