---
id: TASK-42
title: 'Local-model check: tell remote Ollama/LM Studio from local'
status: Ideas
assignee: []
created_date: '2026-10-20 18:24'
labels:
  - pm-pilot
  - privacy
dependencies: []
ordinal: 60000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Slice 10 decides 'local model' by provider id alone (Ollama, LM Studio), so an Ollama or LM Studio host on another machine, or an Ollama cloud model, counts as local and may receive mail from 'Keep on this device only' sources. Found in the slice 10 Task 6 review (src/renderer/packages/sources/model-check.ts).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A local-only source's text is sent only to a model whose host is this machine (localhost/loopback), or the user has explicitly marked the host as trusted
<!-- AC:END -->
