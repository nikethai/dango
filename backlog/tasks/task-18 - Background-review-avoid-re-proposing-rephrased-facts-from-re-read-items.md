---
id: TASK-18
title: 'Background review: avoid re-proposing rephrased facts from re-read items'
status: Ideas
assignee: []
created_date: '2026-10-19 10:53'
labels:
  - sources
  - knowledge
dependencies: []
ordinal: 36000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Background review drops proposals whose text exactly matches known knowledge, but an item read again (an edited file, a Codex thread that comes back into view, a retry after quit) can yield the same fact in new words. Matching by item ref alone would hide genuinely new facts from edited files, so this needs design. Found in the slice 07 final review (docs/specs/2026-10-17-slice-07-sources-background.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A re-read item whose facts are unchanged produces no new proposals, even when the model words them differently
- [ ] #2 New facts from an edited item are still proposed
<!-- AC:END -->
