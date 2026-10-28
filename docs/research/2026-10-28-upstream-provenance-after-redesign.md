---
type: research
status: draft
description: "Upstream-derived code left on main after the redesign merged, with a work package for every flagged file"
generated: { by: claude/opus-5.5, at: 2026-10-28T15:40:00+07:00 }
---
# Upstream provenance after the redesign

**Date:** 2026-10-28
**Ref audited:** `origin/main` at `2e3a77ce` (PR #110, the last redesign merge, 2026-10-22)
**Upstream baseline:** `fe801920` (release 1.19.0, the fork point), `40cbd874` (upstream `main` used on 2026-10-17) and `0ac6385a` (upstream `main` on 2026-09-24, the newest at the time of this scan)
**Per-file data:** [`files.csv`](2026-10-28-upstream-provenance-after-redesign/files.csv), 951 rows, one per file that is not clean
**Earlier audit:** [2026-10-17 upstream provenance](2026-10-17-upstream-provenance.md), on `3f7c2725` before the redesign
**Plan that uses this:** [clean-room rewrite and relicensing plan](../specs/2026-10-17-clean-room-relicense.md)

## Why

The relicensing plan starts once every redesign slice has merged. It leaves the redesign free to edit old files and then cleans whatever is left. All twelve slices and the blockers fix are now on `main`, so this note measures what is left and maps it to work packages.

## Method

The four checks are the same as in the [earlier audit](2026-10-17-upstream-provenance.md#method), with these changes:

- **Team authors now include Claude.** `noreply@anthropic.com` is the author of 352 commits made on the fork for the team. Upstream has no commits from that address, and every other fork author already matched the team pattern. The pattern is now `/thong|nikethai|canvilled|huyminh|huynguyen|noreply@anthropic\.com/i`. Without that address, the scan would credit about 90,000 Claude-written lines to upstream. It would then flag 1,449 files and about 170,000 lines instead of the 951 files and 79,700 lines below.
- **Pinned upstream refs.** The copy check uses the trees of all three refs above. The identical-file check uses every blob in the history of `fe801920` and `0ac6385a`. The refs are pinned so the numbers can be reproduced later, even after upstream moves on.
- **Exclusions are unchanged:** lock files, `LICENSE`, `NOTICE` and `docs/archive/`.

## Findings

**Overall.** `main` has 2,437 files, and 2,284 of them are in scope. Of those:
- 951 are not clean, and hold an estimated 79,700 upstream-derived lines.
- Blame credits 252,463 lines to the team and 78,850 lines to upstream (23.8%).

On 2026-10-17 the figures were 799 files and about 80,100 lines. The upstream line count is almost unchanged. The file count rose mainly because new tests copy boilerplate from older tests.

| Class | Rule | Files in scope | All files (`--all`) |
|---|---|---:|---:|
| identical | blob equals an upstream blob | 263 | 268 |
| upstream | share ≥ 80% | 225 | 226 |
| mixed | share 10–80% | 168 | 169 |
| trace | share < 10%, but at least 1 upstream blame line or 4 matched lines | 295 | 297 |
| clean | none of the above | 1,333 | 1,477 |
| **total** | | **2,284** | **2,437** |

**The redesign edited old files more than it replaced them.** Only 14 files from the 2026-10-17 list are gone, and only 4 more are now clean. Settings, chat UI and modals (WP07, WP09 and WP10) went from 206 files and 15,430 lines to 244 files and 14,343 lines:
- 192 of the old files are still there, with 13,933 lines between them. 12 old files dropped off: deleted, now clean, or moved to WP00.
- 52 new files joined, almost all of them traces, with 410 lines between them.

| Work package | Files | Est. upstream lines | New since 10-17 | Change from 10-17 |
|---|---:|---:|---:|---|
| WP00 dead code and unused assets (delete) | 65 | 2,955 | 0 | 76 → 65 files |
| WP01 i18n: locales, changelogs, English copy | 20 | 14,166 | 0 | ≈ |
| WP02 token estimation and context management | 19 | 3,138 | 0 | +1 file from WP00 |
| WP03 providers and model layer | 86 | 6,919 | 2 | ≈ |
| WP04 stores, storage, migration, types | 62 | 6,573 | 7 | ≈ |
| WP05 platform, bootstrap, app shell (now includes `theme/`) | 39 | 3,084 | 2 | +2 theme files, +3 from WP00 |
| WP06 feature packages | 76 | 6,546 | 16 | ≈ |
| WP07 settings UI | 56 | 3,369 | 10 | 46 → 56 files |
| WP08 image creator | 12 | 1,707 | 0 | unchanged |
| WP09 chat UI and components (includes dev routes) | 168 | 9,574 | 41 | 10,606 → 9,574 lines |
| WP10 modals | 20 | 1,400 | 1 | 22 → 20 files |
| WP11 shared utilities and hooks | 53 | 3,495 | 1 | ≈ |
| WP12 tests and fixtures | 155 | 13,449 | 90 | 69 → 155 files |
| WP13 build config and tooling | 18 | 1,073 | 0 | unchanged |
| WP14 images, icons, fonts | 75 | binary | 0 | 68 → 75 files (+20 from WP00, −13 to WP00) |
| WP15 docs, repo meta, templates | 27 | 2,171 | 0 | unchanged |
| **total** | **951** | **79,699** | **170** | |

**How work packages were assigned.**
- A file that was on the 2026-10-17 list keeps its work package.
- A new file gets the same path rules the earlier audit used, plus one new rule: `theme/` goes to WP05.
- WP00 was rebuilt from a fresh usage check that resolves `@/`, `@shared/` and relative imports:
  - 30 files from the old WP00 list are in use, so they moved to their topic package. 20 of them are assets (logos and icons) that code refers to by file name, which the earlier check missed. The other 10 are code, such as `setup/global_error_handler.ts` and `token-estimation/types.ts`.
  - 19 files that the redesign stopped importing joined WP00: 13 assets, 3 chat components including `components/ui/command.tsx`, 2 store files and one i18n file.

**New files that copy upstream code.** The redesign added 170 new files that are not clean. 152 of them are trace only, 17 are mixed and 1 is identical. 8 of the mixed ones are tests whose render setup was copied from an older test. The other 9 are app code, and these seven carry the most:

| File | Est. lines | Closest upstream file |
|---|---:|---|
| `src/renderer/theme/mantineTheme.ts` | 270 | `routes/__root.tsx` |
| `src/renderer/routes/new.tsx` | 131 | `routes/index.tsx` |
| `src/renderer/components/settings/agents/AgentsSettings.tsx` | 114 | `routes/copilots.tsx` |
| `src/renderer/theme/muiTheme.ts` | 27 | (blame only) |
| `src/renderer/packages/model-errors/classify.ts` | 20 | `components/chat/MessageErrTips.tsx` |
| `src/renderer/components/chat/ChatDropOverlay.tsx` | 4 | (blame only) |
| `src/renderer/lib/startNewChat.ts` | 2 | (blame only) |

There are also two settings files with 1–2 blame-only lines (`settingsNavAvailability.ts`, `routes/settings/privacy.tsx`), and `src/core-js-actual.d.ts`, which is identical to an upstream file.

**Trace files doubled.** There are 295 trace files (155 before), holding 1,532 lines. Most hits are the same few render helpers, copied into new tests from `components/session/ThreadHistoryDrawer.test.tsx` and `chat/MessageList.test.tsx`. Allowlisting or rewriting these helpers once in Task 15 clears most of them.

**Unchanged from 2026-10-17:**
- **Rust backend.** Everything under `src-tauri/` is clean.
- **Still present:** the hosted-cloud client `packages/remote.ts`, the dev routes and the image creator.
- **Dependencies and brand strings.** These were not re-checked; Task 16 covers both.

## Health of `main` at `2e3a77ce`

- **Tests.** 5,362 passed, 74 skipped. The first run failed one file, `tray-icons.test.ts`, because the scan's install skipped `sharp`'s native build. It passed after `pnpm rebuild sharp`.
- **Type-check and lint.** `pnpm check` reports 36 errors and `pnpm lint` 9. The [known issues](2026-10-19-redesign-known-issues.md) baseline is 37 and 9.
- **Not checked:** CI results and open PRs on GitHub.

## Limits

These are the same as in the [earlier audit](2026-10-17-upstream-provenance.md#limits): blame cannot see by-hand or AI rewrites, the copy check over-matches boilerplate, and the usage check is a heuristic. The work package for a new file is assigned by path, so a reviewer may move a file to a better-fitting package. This audit is engineering evidence, not a legal opinion.
