---
id: TASK-42
title: 'Local-model check: tell remote Ollama/LM Studio from local'
status: Done
assignee: []
created_date: 2026-10-20 18:24
updated_date: '2026-11-08T15:34:00Z'
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
- [x] #1 A local-only source's text is sent only to a model whose host is this machine (localhost/loopback), or the user has explicitly marked the host as trusted
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in #110 (redesign blockers, task 4). Verified 2026-11-08 on main da41b5f: sources/model-check.test.ts and toolsets/pm-pilot-history.test.ts pass.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Fixed in #110. isLocalModel now requires Ollama or LM Studio, a loopback host (localhost, 127.0.0.1, ::1) as the request actually resolves it, and a model id that is not an Ollama cloud model, and every local-only gate uses it. The 'user marks a host as trusted' alternative in the AC was not built: Ollama on another machine counts as cloud (accepted trade-off in the known-issues register).
<!-- SECTION:FINAL_SUMMARY:END -->
