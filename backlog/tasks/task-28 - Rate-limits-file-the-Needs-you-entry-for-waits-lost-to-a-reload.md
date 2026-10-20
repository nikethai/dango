---
id: TASK-28
title: 'Rate limits: file the Needs you entry for waits lost to a reload'
status: Ideas
assignee: []
created_date: '2026-10-19 18:31'
updated_date: '2026-10-19 18:31'
labels:
  - errors
dependencies: []
ordinal: 46000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Rate-limit retries live in memory. After a reload a waiting chat shows 'is limiting requests' with Retry, but no Needs you entry is ever filed and room runs started by Team answer or Keep discussing never resolve an open one. Left by slice 06b (docs/specs/2026-10-17-slice-06b-chat-actions-errors.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A rate-limited answer left waiting across a reload appears in Review
- [ ] #2 Team answer and Keep discussing resolve the chat's rate-limit entry when every turn answers
<!-- AC:END -->
