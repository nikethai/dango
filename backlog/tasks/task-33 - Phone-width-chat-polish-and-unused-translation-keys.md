---
id: TASK-33
title: Phone-width chat polish and unused translation keys
status: Ideas
assignee: []
created_date: '2026-10-19 18:31'
updated_date: '2026-10-21 05:31'
labels:
  - design
dependencies: []
ordinal: 51000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
At 375 px the last message's floating action row sits half behind the composer, the composer's model name truncates to one letter, and the sidebar drawer opens by itself on load. Slice 06b also left unused keys (Star, Unstar, Duplicate, Export Chat, Delete Current Session, old error tips) in translation.json; the copy mixes Summarise and Summarize. Left by slice 06b (docs/specs/2026-10-17-slice-06b-chat-actions-errors.md); see docs/research/2026-10-19-redesign-known-issues.md.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 At 375 px the action row, composer model name and sidebar behave
- [ ] #2 Unused 06b-era keys are removed and one spelling is used
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 06c review: five en keys used by 6b's ComposerToolsMenu Mode section are missing from en/translation.json (fallback shows English, harmless).

Slice 09 (phone layout): at 375 px the sidebar no longer opens on load (no sidebar at phone; bottom tab bar instead) and the action row clears the composer in a short chat. Still open: the composer's model name truncates to one letter, the thinking-level chevron overlaps its label, and the scope pill and model chips are under 44 px.
<!-- SECTION:NOTES:END -->
