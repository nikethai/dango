---
id: TASK-26
title: 'New chat with a summary: summarise only the tail that fits'
status: Ideas
assignee: []
created_date: '2026-10-19 18:31'
labels:
  - chat
dependencies: []
ordinal: 44000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
On a chat that is too long for the model, 'Start a new chat with a summary' asks the same model to summarise the whole chat, which can fail the same way; the user gets a toast and nothing is created. Left by slice 06b (docs/specs/2026-10-17-slice-06b-chat-actions-errors.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A too-long chat always yields a summary chat, by summarising only what fits the summary model
<!-- AC:END -->
