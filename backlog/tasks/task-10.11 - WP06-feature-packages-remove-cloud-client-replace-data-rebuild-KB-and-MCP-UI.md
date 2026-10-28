---
id: TASK-10.11
title: >-
  WP06: feature packages - remove cloud client, replace data, rebuild KB and MCP
  UI
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:14:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.7
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign/files.csv
parent_task_id: TASK-10
type: chore
ordinal: 22000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There are 76 files with upstream origin (about 6.5k lines). remote.ts is the upstream hosted-cloud client, which is already disabled, so it can be deleted with its callers and the stripChatboxPaidFeatures remnants. registries.ts and initial_data.ts are upstream-compiled data that need a new source or new content. The knowledge-base UI, web-search settings and MCP UI are rebuilt; the Rust KB backend is already clean (plan Task 11).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 remote.ts and its callers are removed in a separate commit, with check and test passing
- [ ] #2 The MCP registry list and the default sessions or copilots come from a new source or are new content
- [ ] #3 The old WP06 files are deleted; the provenance scan of changed files exits 0
<!-- AC:END -->
