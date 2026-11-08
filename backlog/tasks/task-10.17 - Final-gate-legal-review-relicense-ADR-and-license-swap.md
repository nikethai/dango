---
id: TASK-10.17
title: 'Final gate: legal review, relicense ADR and license swap'
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:13:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.15
  - TASK-10.16
documentation:
  - docs/research/2026-10-17-upstream-provenance.md
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign.md
parent_task_id: TASK-10
type: chore
ordinal: 28000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
The last step needs evidence and a human decision. A full provenance scan proves the code is clean. An ADR names the target license and records contributor consent and the treatment of docs/archive. A lawyer reviews it before the maintainer accepts it. Only after the swap is the git history decision taken (collapse pre-fork history or not); a private archive of the full history is kept either way. Releases already published under GPL-3.0 stay available under GPL-3.0 (plan Task 17).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The final provenance scan CSV is committed under docs/research and shows no non-clean files outside the documented exceptions
- [ ] #2 The relicense ADR is accepted (status stable plus verified) after legal review
- [ ] #3 LICENSE, NOTICE, the package.json license and the Cargo.toml license are updated, and a release is tagged
<!-- AC:END -->
