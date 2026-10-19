---
id: TASK-29
title: 'Usage service: treat Gemini per-minute 429s as rate limits'
status: Ideas
assignee: []
created_date: '2026-10-19 18:31'
labels:
  - providers
dependencies: []
ordinal: 47000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The chat notice treats Gemini RESOURCE_EXHAUSTED per-minute 429s as rate limits, but the shared classifyQuotaError still marks them exhausted, so the status bar shows 'Plan exhausted' while the notice says the provider is limiting requests. Left by slice 06b (docs/specs/2026-10-17-slice-06b-chat-actions-errors.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Gemini per-minute 429 never shows Plan exhausted
<!-- AC:END -->
