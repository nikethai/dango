---
id: TASK-24
title: 'Redo with another model: size the context for the picked model'
status: Ideas
assignee: []
created_date: '2026-10-19 18:31'
labels:
  - chat
dependencies: []
ordinal: 42000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Redo ▾ runs one turn on a picked model, but compaction and overflow checks still size the context for the chat's own model, so a smaller picked model on a long chat fails with a context-length error. Left by slice 06b (docs/specs/2026-10-17-slice-06b-chat-actions-errors.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Redo ▾ to a model with a smaller window compacts or warns for that model's window before sending
<!-- AC:END -->
