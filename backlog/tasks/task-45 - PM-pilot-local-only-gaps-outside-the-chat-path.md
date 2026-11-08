---
id: TASK-45
title: 'PM pilot: local-only gaps outside the chat path'
status: Done
assignee: []
created_date: 2026-10-20 18:24
updated_date: '2026-11-08T15:34:00Z'
labels:
  - pm-pilot
  - privacy
dependencies: []
ordinal: 63000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From the slice 10 final review, paths not covered by cloudSafeMessages: follow-up suggestions generated after a model switch; legacy memory tools while legacy memory is active; a local model's web search query can carry local-only words to the search provider; PostToolUse hooks receive client_recall output; settings export and history sync carry chats that quote client mail (history sync is end-to-end encrypted).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Each listed path either filters local-only content or is documented as user-controlled
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in #110 (redesign blockers, tasks 5 and 6). Verified 2026-11-08 on main da41b5f: FollowUpSuggestions.test.ts, hooks/wrap-tools.test.ts, knowledge/save-message.test.ts, memory/tools.test.ts, pm-pilot/local-only-chat.test.ts, model-calls/stream-text.test.ts and routes/settings/-general-export.test.tsx pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed in #110. Follow-up suggestions never send local-only answers to a cloud model; legacy memory saving and reflecting are off in chats that hold local-only text; a local turn offered client recall gets no web search, link reading or native grounding; PostToolUse hooks never receive client_recall or client_answer output; Save as knowledge keeps the local-only rule. Settings export and history transfer leave out chats that quote device-only mail unless ticked; encrypted history sync still uploads them, as decided in ADR 0016 (user-controlled, passphrase-encrypted).
<!-- SECTION:FINAL_SUMMARY:END -->
