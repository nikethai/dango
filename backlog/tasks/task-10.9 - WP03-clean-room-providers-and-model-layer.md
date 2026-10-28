---
id: TASK-10.9
title: 'WP03: clean-room providers and model layer'
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
ordinal: 20000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
There are 86 files of provider and model code with upstream origin (about 6.9k lines): abstract-ai-sdk, errors, model-calls, ModelSelector, model-setting-utils and flagged provider definitions. minimax.ts and openai-responses.ts were ported from upstream after the fork. Vendor API docs and the Vercel AI SDK docs are the source. Provider IDs and settings field names are the compatibility boundary (plan Task 9).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A fixture test shows an existing OpenAI-compatible custom provider keeps its base URL, model IDs and key
- [ ] #2 The old WP03 files are deleted; pnpm check, lint and test pass; the provenance scan of changed files exits 0
<!-- AC:END -->
