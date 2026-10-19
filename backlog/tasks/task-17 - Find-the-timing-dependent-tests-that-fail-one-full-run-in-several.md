---
id: TASK-17
title: Find the timing-dependent tests that fail one full run in several
status: Ideas
assignee: []
created_date: '2026-10-19 05:40'
labels: []
dependencies: []
type: bug
ordinal: 35000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Full pnpm test runs have failed once and passed on rerun several times on 2026-10-18/19: once with an unidentified test (slices 05 and 06a), 9 failures in stream-text.test.ts and format-chat-sensitive.test.ts (slice 08 Task 3), and packages/knowledge/approve.test.ts (slice 08 final wave). Each passes in isolation. Likely load- or timing-dependent tests (real timers, shared module state, or ordering).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The flaky tests are identified by repeated full runs (e.g. vitest --sequence.shuffle, --repeat)
- [ ] #2 Each is made deterministic (fake timers, isolated state) without skipping it
<!-- AC:END -->
