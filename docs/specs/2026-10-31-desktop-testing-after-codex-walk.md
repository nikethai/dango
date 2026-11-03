---
type: plan
status: draft
description: How to test the Dango desktop app after the Codex walk — regression tests for its findings, Claude-driven checks in the browser and the real app, and the core-promise checks with exact channels.
---

# Desktop testing after the Codex walk

## Why

Codex walked the real macOS app with computer use on 2026-10-29/30 and ran out of tokens, because a model looked at a screenshot for every click. It still found real bugs and left 13 of 24 flows unreached. This plan finishes the job more cheaply:

- Bugs that live in renderer code become Vitest regression tests: no app, no tokens.
- Claude Code checks flows in its browser against `pnpm dev:web`, reading the page as text and accessibility tree instead of screenshots.
- Only the few things that exist only in the native app are checked in the real app with computer use.

No separate triage model and no Playwright harness are needed while Claude does the testing. A zero-token random monkey loop is listed under Later.

Flow numbers and `ux-flows.md:N` references are to [UX flows](2026-10-16-ux-flows.md). Evidence from the walk: `~/.codex/visualizations/2026/10/29/01a18838-9b6c-7ba3-867b-f765a4b005bf/dango-walk-evidence/report.md` (with screenshots).

## Ground rules for every test run

- Use the disposable test profile, disposable scopes and folders, and the loopback fake provider (below). Never a real Gmail or Asana account.
- Never click Always on a write, delete or command permission. Never run a plan that sends, books or invites.
- Computer Use and the browser-host sidecar stay off.
- Restore anything toggled for a test (Tool use, notifications, provider selection) and say so in the PR.

### Loopback fake provider

The walk's most useful technique. A small OpenAI-compatible server on `127.0.0.1` that, per test, returns canned success, 401, 402 `insufficient_quota`, 429 with `Retry-After: N` (and `Access-Control-Expose-Headers: Retry-After`), or 400 `context_length_exceeded`. It logs each request and reports only booleans for marker strings ("is `UNIQUE-MARKER` in a system message?"), never full bodies. Add it as a script (for example `scripts/fake-provider.mjs`) so every test run uses the same one.

## Step 1: regression tests for the walk's renderer bugs

Each gets a failing test first, then the fix, one PR each.

| # | Bug (walk finding) | Cause found in source | Test |
|---|---|---|---|
| 1 | Paths change on send: `/tmp/alpha-beta` arrives as `/alpha-beta`, `/usr/local/bin` as `/local/bin` | `stripCommandSlashTokens` (`src/renderer/packages/commands/slash-tokens.ts`) removes every `/word`, whether or not a command has that name; `InputBox.tsx:1707` runs it on every send | Paths, URLs and `5/7` survive; only names of real commands are stripped; a `/word` followed by `/` is never a command |
| 2 | ⌘K + Enter on the last-open chat leaves Review on screen | `search/providers/chats.ts:35` only calls `switchCurrentSession` when the session differs from `currentSessionIdAtom`, and does not navigate otherwise | Selecting the current chat from another page navigates to it |
| 3 | The file-write permission sheet offers "Always in this chat" | Permission sheet options vs. risk tier ([ADR 0015](../adr/0015-command-tools-always-ask.md), flow 7) | Write, delete and command tiers never offer Always |
| 4 | 429 shows "Trying again in 38 s" when the provider said `Retry-After: 2` | Provider error handling (where the header is lost is not established) | With `Retry-After: N`, the retry waits about N seconds |
| 5 | A saved agent's prompt is absent from the model request | Agent request building (confirmed with the fake provider's marker check) | The mentioned agent's prompt is in the request's system content |
| 6 | The plan card lists only the first section's steps ("3 steps" of 5) | Plan card step extraction | Every section's steps are in the numbered list |
| 7 | "Stopped before answering" is in the accessibility tree while Thinking and Stop show | Chat live state; Swarm's `foldSwarmRuns.ts:169` uses the same label whenever there is no answer id | The stopped label appears only after a stop or failure |
| 8 | Raw internals shown: `FEATURE_DISABLED: scm is disabled`; raw tool-call XML in an answer | Files tab error text; answer rendering | User-facing copy for disabled features; tool-call markup never rendered as answer text |

Also from the walk, design fixes rather than tests: unstyled project panel tabs (`ProjectContextPanel.tsx:175`, no `project-explorer-tabs` rule), the 24 px `Export safe snapshot` button (`globals.css:364`), the artifact header not shrinking (`globals.css:7837`), and unnamed redo arrows.

Needs a maintainer ruling, not a fix: flow 16 says deleting a scope asks nothing first, while the screen rule calls for a Delete scope sheet (`ux-flows.md:156` vs `:209`).

## Step 2: Claude-driven checks in the browser (`pnpm dev:web`)

Claude Code runs `pnpm dev:web` and walks the flows the walk did not finish, using page text and the accessibility tree. A screenshot only when layout is the point. For each flow, record pass, fail (with repro) or blocked in the PR.

Flows to finish: 1 First run, 3 Review (all item types), 4 Approve knowledge, 9 Background work, 11 What changed (if built), 12 Knowledge conflict, 13 Trust, 16 Undo (full set), 17 Message actions, 18 Manage chats, 19 Artifacts, 22 Window sizes (1280, 960, 390 px), 23 Dark mode, 24 Accessibility. Re-check 5, 6, 7, 8, 14 and 15 after the step 1 fixes.

Checks to apply on every page Claude visits:

- **Input fidelity:** what was typed is what the bubble shows and what the fake provider received.
- **Blank transcript:** an open chat with stored messages must render message rows within 5 seconds.
- **Contradictory state:** no "Stopped before answering" while Thinking or Stop is visible.
- **Raw internals:** no `FEATURE_DISABLED`, `<tool_call`, `<invoke` or raw error codes in visible text.
- **Console:** no uncaught errors (`read_console_messages`, errors only).

## Step 3: native-only checks in the real app (`pnpm dev`)

Only what the browser cannot reach. Use the Tauri dev app with computer use, reading the accessibility tree where possible:

1. Global shortcut (Option-Shift-Space) opens the Quick Chat window; Esc closes it; a message there reaches the fake provider. (The walk could not get the window to appear.)
2. Menu bar item opens and its actions work.
3. A qualifying notification is delivered (permission was granted in the walk; delivery was not seen).
4. Native window sizes, including the native minimum, with the Files panel and an artifact open.
5. Artifact Download: the save dialog appears and completes without freezing the app (the walk saw a timeout here).
6. Quit with ⌘Q and relaunch: chats, the selected provider and background work come back. (The walk saw a new chat pick a stopped test provider after relaunch.)
7. **Blank chat panes:** after a long session in the debug bundle, previously filled chats and even a new chat rendered blank until restart. Try to reproduce: open many chats via search, switch back and forth, check message rows. Suspect: the virtualized list and cached scroll state in `MessageList.tsx:280`. If it reproduces, capture console output and the session id before restarting.

## Core-promise checks, with exact channels

Run these during steps 2 and 3. Watching the network tab on web, and the `http:request` channel on desktop, where renderer HTTP is sent through `ipc_invoke` to Rust (`src-tauri/src/lib.rs`).

- **Never send email.** No request to `gmail.googleapis.com` other than the allowlist in `src/renderer/packages/pm-pilot/gmail-http.ts` (GET profile, messages, history, labels, threads, drafts; POST labels, drafts, thread modify; DELETE drafts). Any `send` or `import` segment is a failure. `gmailRequest` already refuses these; the check guards against a second client.
- **Nothing approved without the user.** `approve`/`approveProposal`/`addKnowledge` (`packages/knowledge/approve.ts`), `applyReviewEntry` (`packages/review/trust.ts`) and `approveAndExecutePlan` (`stores/session/generation.ts`) must follow a user action, except where Trust is set to Auto, which may only create drafts under the daily cap.
- **Device-only data stays on the device.** Content from a device-only chat or a "Keep on this device only" source must not appear in requests to non-local model providers, web search, link reading or MCP tools ([ADR 0016](../adr/0016-outside-tools-and-device-only-chats.md)). Encrypted history sync does upload device-only chats by design (ADR 0016), so it is not a failure. Settings export leaves them out unless ticked.

## Later: zero-token random monkey loop

If longer unattended runs are wanted later, a scripted loop can drive the same checks with no model in the loop: seeded random actions from the accessibility tree, replayable runs, a model only to write up a failure. On desktop it needs a WebDriver plugin in debug builds (`tauri-plugin-webdriver` or `tauri-plugin-webdriver-automation`), because macOS has no WebDriver for its webview. Not part of this plan.

## Done when

- Step 1 bugs each have a merged test and fix.
- Every flow 1–24 is pass, fail with a backlog card, or excluded with a reason (10 Client email stays excluded).
- Step 3 items are recorded, and the blank-pane bug is either reproduced with a trace or noted as not reproduced.
- The three core-promise checks were watched during the runs and no violation was seen.
