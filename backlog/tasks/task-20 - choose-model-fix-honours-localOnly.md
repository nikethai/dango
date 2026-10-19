---
id: TASK-20
title: choose-model fix honours localOnly
status: Ideas
assignee: []
created_date: '2026-10-19 10:53'
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
- [ ] #1 For a localOnly scope, the Choose a model fix offers and accepts only local models
<!-- AC:END -->
