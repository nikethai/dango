---
id: TASK-10.16
title: Dependency license gate and brand cleanup
status: Proposed
assignee: []
created_date: 2026-10-17 07:24
updated_date: '2026-10-28T08:13:00Z'
labels:
  - licensing
dependencies:
  - TASK-10.4
documentation:
  - docs/research/2026-10-17-upstream-provenance.md
  - docs/specs/2026-10-17-clean-room-relicense.md
  - docs/research/2026-10-28-upstream-provenance-after-redesign.md
parent_task_id: TASK-10
type: chore
ordinal: 27000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A new license is only possible if every dependency allows it. The audit found mostly MIT and Apache npm packages. For jszip, node-forge, dompurify and harmony-reflect the permissive option has to be chosen and recorded. Seven packages declare no license (cohere-ai is direct), two @trapezedev packages say SEE LICENSE, and two packages use FSL-1.1-MIT. Cargo crates were not checked. Separately, chatbox still appears in 271 files (plan Task 16).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 scripts/licenses/check.mjs fails on any npm license outside the allowlist and passes on main
- [ ] #2 cargo deny check licenses passes in src-tauri
- [ ] #3 rg -il chatbox finds only NOTICE and the fallback env reads
<!-- AC:END -->
