---
id: TASK-30
title: 'Unknown model capabilities: don''t silently drop tools at run time'
status: Ideas
assignee: []
created_date: '2026-10-19 18:31'
labels:
  - providers
dependencies: []
ordinal: 48000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Models with no capabilities list are never blocked before sending, but isSupportToolUse() treats them as tool-less at run time, so Agent Mode tools vanish without a word. Left by slice 06b (docs/specs/2026-10-17-slice-06b-chat-actions-errors.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A model with unknown capabilities either gets its tools or the user is told they are off
<!-- AC:END -->
