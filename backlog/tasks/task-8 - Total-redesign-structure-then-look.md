---
id: TASK-8
title: 'Total redesign: structure, then look'
status: Now
assignee: []
created_date: '2026-10-16 14:22'
updated_date: '2026-10-18 15:43'
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

2026-10-18: slice 02 (settings) built on feat/redesign-02-settings: five sections plus Advanced (nav model settingsNavModel.ts), section tabs, Sources and Memory and privacy pages (real Don't-suggest list from slice 4, Open Everywhere, dead memory toggles removed), Trust sheet (useTrustSheet; Auto never approves knowledge), Agents replaces Copilots (redirects kept), Image studio under Advanced, cost heads-up and thinking display controls; new settings fields trustLevel/costWarningUsd/showThinking/backgroundPaused with readX() normalisers. Next: slice 05 and 06a after merge.

Slice 05 (Review home) built on feat/redesign-05-review-home. Follow-ups: for slice 10 (first real Auto applier) — (a) the Undo button on an Auto-arrived Done row may render before the arrival map is set and miss a re-render; (b) when an Auto arrival loses a cross-window race, addReviewEntry returns the open input entry instead of the stored Done row. For 1b's UndoToast — at 390 px the toast is narrow and covers a row. Minor: getOS() matches Mac before iPhone and Linux before Android, so the New chat shortcut hint's phone check never fires (CSS hides it under 640 px).

Slice 06a (chat thread) built on feat/redesign-06a-chat-thread. Follow-ups: plan mode has no UI control (TASK-16); 'Continue remaining work' for task lists outside plans went with the task dock; the copy-reasoning action from ReasoningContentUI is gone (6b could restore); Android's pending line has never shown a reasoning summary; a later plan in the same chat merges into the open Change for the same change set (clear changeSetsBySession on apply/discard); a failed plan run files no Change; Stop pressed between the main stream's end and the continue stream's first update doesn't abort the continue (Stop registry); step titles show raw Markdown; post-turn failures are logged, not reported to Sentry.
<!-- SECTION:NOTES:END -->
