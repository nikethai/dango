---
id: TASK-8
title: 'Total redesign: structure, then look'
status: Now
assignee: []
created_date: '2026-10-16 14:22'
updated_date: '2026-10-18 05:33'
labels:
  - design
dependencies: []
references:
  - docs/specs/2026-10-16-redesign-brief.md
type: feature
ordinal: 9000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Maintainer asked on 2026-10-16 to redesign before building the shared core: doesn't fit the new direction, cluttered, dated, PM must be able to use it. Brief: docs/specs/2026-10-16-redesign-brief.md. Steps: approve structure → wireframes → design system v2 → build in small PRs.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
2026-10-17 00:30: all 16 flows have clickable screens on the canvas (Screens page). Palette Thread, mascot and GPT app icon chosen. Next: design system v2 and restyle.

2026-10-17: Dango theme first slice built on feat/dango-theme (plan docs/specs/2026-10-17-dango-theme-first-slice.md): tokens in the app, colours/type/radii remapped onto Dango in CSS, Mantine and MUI, sidebar and composer to the design system, ReviewItem component and /dev/design-system gallery. Light/dark visual check done in the web build; fixes committed. Suite 1869 pass, tsc at main's 37. Next: Review page and scopes (out of this slice).

2026-10-17: slice 1b (shared foundations) built on feat/redesign-01b-shared-foundations: Sheet + focus rules, undo toast + ⌘Z, eight-state Mascot, Review entries store (Web Locks, loose schema) with openers/renderers/hooks, BackgroundJob types, new chat at /new with / redirecting. Suite 1979 pass, tsc 37 (= main), lint 9 errors (= main). Next: slice 03 scopes after this PR merges.

2026-10-18: slice 03 (scopes) built on feat/redesign-03-scopes: Scope type and store (myProjects canonical, immediate writes), migration 17→18, one writer for a chat's scope, Scopes sidebar with Everywhere and client chips, scope page (Overview/Knowledge/Sources/Files/Chats/Settings, EM1), Everywhere page, scope pill in the composer, readScopes() for reads outside React. Suite green, tsc 37, lint 9 errors (= main). Next: slice 04 after merge.

2026-10-18: slice 04 (knowledge) built on feat/redesign-04-knowledge: knowledge store with locked revertible commits, proposals with contradiction check (session model, 15 s timeout), approve/add/edit/remove/move with one undo each, conflicts (Keep this / Keep both), Review renderers, approved knowledge as the only chat context (1,500-token budget, framing sentence), chat proposer replacing memory auto-save, Knowledge tab + Everywhere lists, one-time move of old memory. Slice 2 note (C1): slice 2 must fill useDontSuggestEntries and add the Open Everywhere row on Memory and privacy itself, and hide the now-dead autoSaveFallbackPin / showMemoryUpdatedToast toggles. Slice 10 note: re-check entries use ref = use.ref and can merge with open draft entries.
<!-- SECTION:NOTES:END -->
