---
id: TASK-20
title: choose-model fix honours localOnly
status: Done
assignee: []
created_date: '2026-10-19 10:53'
updated_date: '2026-10-20 17:59'
labels:
  - sources
dependencies: []
ordinal: 38000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The background-review 'Choose a model' fix does not yet check a scope's localOnly setting, which nothing sets until slice 10. Once slice 10 sets localOnly, the fix must only offer local models for such scopes. Found in the slice 07 final review (docs/specs/2026-10-17-slice-07-sources-background.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 For a localOnly scope, the Choose a model fix offers and accepts only local models
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 10 (commit 330ccbb9, src/renderer/packages/sources/connect.ts): the choose-model fix looks up the job's source; a local-only source accepts only local models (Ollama, LM Studio) and opens Settings › Default models otherwise. Test: connect.test.ts 'choose-model for a local-only source accepts only a local model and opens default models otherwise' (passes; sources suite 113/113).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
The background-review Choose a model fix now honours a source's 'Keep on this device only' switch: for a local-only source it offers and accepts only local models, and never switches models by itself. Built in slice 10, tested in connect.test.ts. A remote Ollama or LM Studio still counts as local (known issue in the redesign known-issues list).
<!-- SECTION:FINAL_SUMMARY:END -->
