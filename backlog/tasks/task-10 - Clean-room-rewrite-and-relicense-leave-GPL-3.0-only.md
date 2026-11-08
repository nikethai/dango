---
id: TASK-10
title: 'Clean-room rewrite and relicense: leave GPL-3.0-only'
status: Proposed
assignee: []
created_date: 2026-10-17 07:23
updated_date: '2026-10-28T08:14:00Z'
labels:
  - licensing
dependencies: []
documentation:
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-17-upstream-provenance.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign.md
type: chore
ordinal: 11000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Dango is GPL-3.0-only because it was forked from an upstream GPLv3 desktop AI client (see NOTICE). The maintainer wants the option of another license. That is only possible once no upstream-authored or upstream-derived code, copy or assets remain. The 2026-10-17 provenance audit found 799 of 1,804 files (about 80k lines) still upstream-derived. The redesign then edited most of that code in place rather than replacing it: the 2026-10-28 audit, after the last redesign merge, found 951 of 2,284 files in scope (about 79.7k lines). The Rust backend is still clean; i18n, tests and the chat UI hold the most. The plan splits the work into 16 work packages (WP00 to WP15) plus a scanner, a dependency gate and a final legal gate, and starts now that the redesign (TASK-8) has merged. Git history must not be squashed before the final gate; it is the evidence of who wrote what.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Every subtask is Done
- [ ] #2 A full provenance scan of main reports no upstream, mixed, identical or trace files outside the documented exceptions
- [ ] #3 A relicense ADR is accepted by the maintainer (status stable plus verified) after legal review
<!-- AC:END -->
