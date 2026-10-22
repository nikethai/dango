---
type: research
status: draft
description: "Running list of known issues, trade-offs and unverified checks left by the redesign slices, to review together once the slices are merged"
generated: { by: claude/opus-5.5, at: 2026-10-19T12:40:00Z }
---
# Redesign: known issues and trade-offs

The redesign slices keep this list up to date. Each slice adds what it leaves behind: things not verified, trade-offs accepted on purpose, and follow-ups. When the slices are done, we go through it together and decide what to fix, file or drop.

**Verified against main c68899d on 2026-10-21.** Three read-only code reviews checked every entry against the code. Probe tests ran the permission claims, `cargo check` ran on the Rust crate, the full test suite ran once, and the `pnpm check` and `pnpm lint` baselines were counted again. Wrong entries are corrected in place below, and entries that turned out worse say "Worse than noted:". New findings carry an id (B for blockers, S for should-fix) and are sorted in the triage below.

Cards marked `TASK-n` live on the Backlog.md board (`backlog task view TASK-n`).

## Triage (2026-10-21)

### Fix now: the [blockers plan](../specs/2026-10-21-redesign-blockers.md)

- B1: MCP tools named like a Dango built-in (`list_tasks`, `web_search`, `memory_*`…) skip the permission sheet, whatever they do. New card. **Fixed** (#110). Low risk now comes from Dango's own toolset, never from the name.
- S1: an Always grant at a raised tier covers other secret files, and many secret paths rate only MEDIUM. New card. **Fixed** (#110). A secret path always rates at least HIGH and never takes a grant, for built-ins too.
- S2: the read-only command shortcut reads secrets through relative paths (`cat .zshrc` in an MCP shell running in `~`). New card, with S1. **Fixed** (#110). Read-only commands with a file or folder operand now ask.
- S3: the permission audit log is never trimmed, and a full store silently stops grant and revoke writes, so a revoked grant can come back. New card. **Fixed** (#110). The log keeps the newest 500; a failed grant or revoke write says so, and a failed Always is rolled back.
- B2: "local" is decided by provider id only, so remote Ollama or LM Studio hosts and Ollama `-cloud` models get raw local-only content. TASK-42. **Fixed** (#110). Local now means Ollama or LM Studio on a loopback host and not a `-cloud` model, at every gate.
- B3: legacy memory sends local-only content to the global model. New card, or folded into TASK-45. **Fixed** (#110). Saving, updating and reflecting are off in chats that hold local-only text.
- S13: the rest of TASK-45 (follow-up suggestions, web search next to `client_recall`, PostToolUse hooks, chats in export, "Save as knowledge" on a recall answer). TASK-45. **Fixed** (#110). Follow-ups, web search and link reading, PostToolUse hooks and Save as knowledge keep local-only text out; chats in export stay TASK-13's decision.
- B4: knowledge goes out in settings export and comes back approved on import; an unreadable key can't recover. TASK-13. **Fixed** (#110). Knowledge, its migration record and sources stay out of settings export and import; an unreadable store offers Start over.
- B5: deleting an imported source asks nothing. TASK-46. **Fixed** (#110). It asks first; TASK-46 keeps the other confirm dialogs.
- B6: Gmail ignores "Background review off". New card; the plan uses the recommended default (see decisions). **Fixed** (#110). Review off means Gmail only syncs and stores mail; a running review stops when the switch goes off. The maintainer may still choose to hide the switch for Gmail.
- S11: a source removal in its undo window is lost on quit, so a removed Gmail source comes back and keeps drafting. TASK-22. **Fixed** (#110). The removal is stored and finishes at the next launch before any sync.

### Left open by the blockers PR

- **MCP read tools run without asking.** Decided and fixed (#110, [ADR 0016](../adr/0016-outside-tools-and-device-only-chats.md)): every MCP tool asks once and offers Always in this scope; read-only shell commands ask once too, and their reason text must be short and plain. Was: An MCP tool whose name or description reads like a read (`list_issues`, `read_email`, `search_code`) rates LOW and runs unasked; 13 of 19 realistic read tools did in a probe. A MEDIUM floor for every MCP tool would make about 2 in 3 of them ask. Maintainer decision, possibly ADR 0016, together with the next item.
- **Other tools on a local-only turn.** Decided and fixed (#110, ADR 0016): MCP, browser, video-URL and image tools are off on device-only turns, computer use stays, and a quiet line says so. Was: MCP tools, `read_video_url`, the browser agent, computer use and `generate_image` are still offered when a chat holds local-only text, and their arguments could carry it. MCP write tools (memory-style servers included) too. Maintainer decision.
- **Hooks.** PreToolUse hooks see every tool's arguments, PostToolUse sees tools other than `client_recall`/`client_answer`, and PostTurn sees the whole answer (shell hooks are off for it).
- **Knowledge filed from a local-only source.** On a local model it sits in the prompt without making the turn local-only, so web and MCP stay available beside it; once its source is removed or stops being local-only, it reaches cloud models (the existing knowledge rule).
- **Text the user carries over.** A follow-up suggestion a local model wrote from local-only mail, once clicked, and a user message that quotes local-only text are the user's own words to later turns and to Save as knowledge.
- **Settings export (TASK-13).** Decided and fixed (#110): accounts and their tokens, Review entries, jobs, source cursors and sync state stay on the device; chats that quote device-only mail are left out unless the user ticks a box. "Export Chat History for Transfer" follows the same rule, with its own box (maintainer, 2026-10-22). Encrypted history sync keeps uploading every chat, since it is encrypted with the user's passphrase and the device-only mark travels with it ([ADR 0016](../adr/0016-outside-tools-and-device-only-chats.md), maintainer 2026-10-22). History and memory sync tokens leave the export unless API Keys is ticked; the passphrase never goes (both export screens). Was: Chats that quote mail, `integrations`, `imported-history` and `review-entries` (both can hold mail or chat text), `background-jobs` and `source-cursor:*` are still exported; importing a cursor without its source makes it sync again from earlier.
- **Secret paths.** `~/.gitconfig` asks but can take Always; `cat 5` reads a file named `5`; `grep -fFILE` reads a pattern file without printing it; a path split across more than 64 values is only partly checked; `git log -p` can print secrets committed to the repository.
- **Grants.** A revoke that failed to save can come back early if another window saves; a failed audit-entry write is silent.
- **Gmail.** With review off, an old draft is never marked sent. Decided and fixed (#110): Background review defaults on for new Gmail sources with the caption "Dango reads new mail with your model to draft replies.", and turning it back on acts only on mail that arrives afterwards (threads still waiting when it was turned off are dropped). TASK-47 is the idea for a one-time "last 3 days" offer.
- **Source removal.** A removal whose revoke keeps failing stays hidden and silent, and blocks adding a folder to that scope ("This scope already has a folder." with none listed); a failed Undo write is only logged.
- **Knowledge store.** A failed Start over is only logged; desktop settings export fails when any IndexedDB value is corrupt (pre-existing); a desktop file-backed key reads as "nothing stored" (knowledge is in IndexedDB, so not affected).
- **Smaller.** The read-only prose check also matches words like "tokenizer" (it asks); first run starts every source kind with review on while Add a source starts non-Gmail kinds off; Needs you chats are refused for saving even if no longer local-only (fails closed); a failed imported-source delete shows nothing (TASK-46); the phone drawer of AdaptiveModal never takes focus on open (TASK-46); `memory_reflect` now runs on the chat's model in every chat; a lowered message limit can drop the recall message while later answers that repeat it stay unmarked; the writing assistant sends only text the user typed and has no local-only gate.

### Should fix next

- S4: Quick Chat permission requests are hidden after Esc, time out after 120 s and tell the model "The user chose Not now". TASK-37, TASK-39.
- S5: a Stop pressed before Swarm's live status is set is lost, and one global live slot means a Swarm in another chat makes Stop miss. TASK-38, plus a new card for the Stop gap.
- S6: failed Swarm tasks fold away and are still listed as work done. TASK-40.
- S7: Quick Chat offers only Retry for every error, and runs no ability or cost checks. New card.
- S8: unknown capabilities mean tools dropped at send but present in the readiness check; pictures to unknown models pass the pre-send check, then fail. TASK-30.
- S9: rooms ignore @-mentions in room size, price every agent at the composer model, and plan Continue has no room gate. TASK-31.
- S10: dismissing a Needs-you entry leaves its job blocking the source, which silently stops. New card.
- S12: Gmail on Everywhere downloads and discards every new thread each poll. TASK-43 (decision below).
- S14: folder review takes about 31 days for a full pass of 5,000 files, and new files starve changed ones. TASK-19.
- S15: clicking a desktop notification does nothing. New card.
- S16: first run holds users the model check misses (OpenClaw gateway, no models listed). New card.

### Minor (backlog as is)

- Drafts: a failed write still uses a daily draft; the 5-minute Apply block also follows network and 5xx errors; replies go to From, not Reply-To; a deleted Dango label recovers on token refresh (about an hour). Slice 10 list.
- Quick Chat recall never reports sign-in gaps. TASK-44.
- Editing the first question overwrites it and drops extra text parts; cost estimate prices one call per run; dead Chat Display atoms. Existing trade-offs.
- Search: chats with no scope show only under All; the 8-hit folder cap is cut after all scopes are merged. New card.
- `getWindowLabel`'s catch returns `'main'`, the opposite of the documented "a failed lookup is other". New card.
- Codex FIFO race: the open happens before the type check, and the reader runs synchronously inside async IPC, pinning a tokio worker. Needs write access to home.
- Importing settings resets first run.
- Confirmed still open as filed: TASK-18, 21, 24, 25, 26, 27, 28, 29, 34, 35, 36, 39, 41; TASK-33 partly (most unused keys are gone).

### Accepted (no action)

- An old Codex cursor in plain milliseconds is still parsed.
- After Stop, a source waits a full interval (6 h for reviews) before it runs again.
- After a local-only recall, cloud turns in that chat lose later answers. By design.
- First sync at launch with review off, for folders and Codex: they only list names.
- Hidden chats are left out of search; Everywhere knowledge shows only with its chip.
- The quick window sends setup to the main window and runs no jobs.
- The 09 blank-screen case: not reproduced.

### Decisions for the maintainer

- B6, Gmail and Background review. Recommended: review off means Gmail stores mail only, with no model calls. Alternative: hide the switch for Gmail and say that connecting means processing. The blockers plan assumes the recommended default.
- TASK-32, Redo after "Answer without tools". Recommend yes: Redo on a tool-capable model turns tools back on.
- Picture chats regenerate images when a question is edited. Recommend accepting it.
- TASK-43, Gmail on Everywhere. Recommend that Add a source refuses it, and that Add a source stops defaulting to Everywhere when it isn't opened from a client.

## Cards to file

The `backlog` CLI isn't installed here (`pnpm exec`, `npx --no-install` and `which` all fail), so file these in the board's Proposed column with the CLI where it is installed:

- **Permission bypass by tool-name collision** (B1): an MCP tool whose last name segment matches a built-in low-risk tool auto-runs; decide low risk by Dango's own toolset, never for `mcp__` tools, and move `computer_ax_query` out of low.
- **Secret paths always ask** (S1, S2): no grant covers a secret path, every secret path rates at least HIGH, and the read-only shortcut checks relative operands and is off when the working folder is unknown.
- **Cap the permission audit log** (S3): trim to about 500 entries and show write failures for grants and revokes.
- **Legacy memory leaks local-only content** (B3): memory tools and consolidation use the global model in a local-only chat. Or fold into TASK-45.
- **Swarm Stop lost before live status** (S5): a Stop between the placeholder removal and the live status finds nothing and the run goes on.
- **Quick Chat errors offer only Retry** (S7): give each error its fix, and run the ability and cost checks.
- **Dismissed Needs-you blocks its source** (S10): dismissing should retire the job, or not be offered.
- **Desktop notification click does nothing** (S15): `onAction` needs a listener that the notification plugin only has on mobile.
- **First run holds OpenClaw users** (S16): users the model check misses can't leave first run.
- **Gmail ignores Background review** (B6): Gmail syncs run the full model pipeline with review off.
- **Search scope gaps**: chats with no scope show only under All; folder hits are capped after all scopes are merged.
- **getWindowLabel falls back to main**: a failed lookup should count as other, as documented.

## Core promises

All three hold, with caveats.

- **Dango never sends email.** The one Gmail client refuses send and import paths. Caveat: the OAuth scope is `gmail.modify`; the token reaches an MCP server only if the user links it, and a send there goes through the permission sheet, which B1 can skip.
- **No fact is approved without the user.** Only drafts apply, and `client_answer` takes only the user's own words or option. Exception: settings import brings knowledge in approved (B4).
- **Approval is bound to the content hash.** It holds against edits outside Dango. The hash is plain sha256, not a signature, so it proves nothing about who approved (B4).

## Not verified yet (needs a real machine)

CI runs `pnpm test` on pull requests and on main (`.github/workflows/ci.yml`); lint and tsc run report-only.

| Slice | What | How to check |
|---|---|---|
| 06a | The plan card's live states (running, stopped, Continue) were not tried with a real streaming model. Slice 06b adds a plan-mode toggle and a scripted end-to-end test, but a real-model run is still manual. | Turn plan mode on in an agent chat and run a plan against a real model (TASK-16). |
| 07 | `cargo check --locked --lib --tests` passes on the app crate (2026-10-21), which covers draft bindings and the Codex threads reader. Its tests were not linked here (no onnxruntime); the reader's tests pass in a scratch crate. | `cargo test --lib workspace::` on macOS and once on Windows. |
| 07 | The Windows-only file-identity check (`same_file` / `same_created`) has never run. | Same as above, on Windows. |
| 07 | The desktop manual walk has not been run. | PR #104's checklist. |
| 08 | The Quick Chat window, menu bar and notifications compile (`cargo check` passes, IPC names match their callers, capabilities cover both windows) but have not been run or walked on the desktop. | PR checklist for slice 08. |
| 06b | Agent Mode and Plan mode only appear on desktop, so the new Mode section in the Tools menu and the plan-mode toggle were not seen in a real window. The web build was walked headless in light and dark at 1280 and 375 px. | Desktop walk in the slice 06b PR. |
| 06b | No real model has run a plan end to end. A scripted-model test covers it. | TASK-16 AC #3. |
| 06c | The permission sheet in the Quick Chat window, real tool calls through MCP servers, and a live Swarm run with real agents were not exercised; the web build was walked headless (sheets triggered directly, Swarm runs seeded). | Desktop walk in the slice 06c PR. |
| 10 | Gmail and Asana have only been tested against mocks (msw). Nobody has signed in, received mail, or seen a draft land in a real mailbox. | The manual walk in the slice 10 PR (macOS, Trust Auto and Ask). |
| 10 | Asana's CORS was checked with curl from this container, not from the desktop webview. Whether a new comment updates a task's `modified_at` (the 90-day comment window relies on it) is unconfirmed. | Same walk: connect Asana in the desktop app, comment on an old task. |
| 10 | The CH6 chat opened from the Quick Chat window and the draft edit sheet's real modal path were not seen in a window. | Same walk. |
| 09 | First run with a real source (the "Reading your folder…" card), desktop sign-in with ChatGPT or Google, and the folder picker were not walked: on web every source kind needs the desktop app. | The slice 09 PR's desktop walk. |
| 09 | The three window sizes, the rail and the inspector were walked headless on web only. A real desktop resize, iOS (swipe, safe areas), Android (keyboard flag, rotation), tablets at 760 px or wider, VoiceOver/NVDA and macOS Reduce Motion were not run. | Same walk, plus one phone and one screen reader. |

## Trade-offs accepted on purpose

- **Read-only commands name no file (blockers PR).** `ls`, `cat`, `grep`, `find`, `du`, `head`, `tail`, `wc` and `stat` count as read-only only with flags and numbers, because Dango doesn't know the MCP server's working folder. `cat README.md` asks.
- **MCP shell read-only shortcut (decided, maintainer 2026-10-22).** Read-only commands on an MCP shell tool no longer run unasked on first use: they ask once with an Always that covers only that tool's read-only commands in that scope ([ADR 0015](../adr/0015-command-tools-always-ask.md)). After that grant, the model's `reason` text reaches the server unasked with each read-only command.
- **No trusted host (blockers PR).** Ollama or LM Studio on another machine counts as cloud for local-only sources, which get the "choose a local model" fix. A trusted-host setting can come later if wanted.
- **Exports (blockers PR).** Settings export of chats that quote mail stays TASK-13's decision; Review entries and background jobs are still exported.
- **Pre-existing errors.** Main has 37 `pnpm check` errors, and 9 `pnpm lint` errors plus 1,076 warnings (CI's "~400" is Biome's diagnostic cap). Each slice adds none but fixes none.
- **Flaky tests.** Some timing-dependent tests fail about one full run in several: `stream-text`, `format-chat-sensitive`, `approve.test` (TASK-17). Not reproduced in one full run on 2026-10-21 (4,994 passed); TASK-17 stays open.
- **Codex threads (07).**
  - The reader stalls if an attacker swaps a thread file for a FIFO during a narrow window between the check and the open. Doing this already needs write access to the user's home folder.
  - The read cursor format changed while slice 07 was being built, so an older cursor reads every thread from the start again. That is harmless because nothing had shipped yet.
- **Background jobs (07).**
  - A job waiting in Needs you blocks new runs of that source until you press its fix. Worse than noted: dismissing the entry leaves the job blocking, so the source silently stops (S10).
  - After you press Stop, the source waits a full interval before it runs again.
  - Both are deliberate, so a failing source doesn't add a Needs you entry every 15 minutes.
- **First sync (07).** Every source that has never synced gets one sync at launch, even with Background review off. That is fine for folders and Codex, which then only list names. Gmail runs its full model pipeline (B6). Fixed (#110): with review off Gmail only stores mail.
- **Folder review (07).** It rotates through files instead of tracking each file's revision. In a very large folder, a changed file can wait weeks to be read (TASK-19).
- **Review empty state (07 corrects 05).** EM2, "no sources yet", shows only when there are no sources and nothing visible in Review.
- **Quick window (07, 08).** Any desktop window other than main sends setup to the main window and runs no jobs. This follows the maintainer's rule that anything to configure opens the big window.

- **Settings › Chat Display removed (06b).** Its six toggles (token count, model name, token speed, word count, timestamp, first-token time) had no effect any more. The saved values stay, so nothing needed migrating.
- **Picture chats (06b).** Editing a question in a picture chat now resends it, so changing only the wording means generating new images.
- **Editing a question (06b).** Editing the first question of a chat overwrites its old wording. The old answer is kept as a branch.
- **Cost estimate (06b).** It prices one model call per run at the uncached price, so an Agent Mode turn with many tool calls can cost more than the sheet says. Quick Chat and plan runs never show the sheet.
- **Quick Chat (06b).** Model errors are summarised now, but only Retry is offered, even for sign-in, too-long or vision errors. It still runs no ability or cost checks (S7).
- **Desktop vision block (06b).** A model known to lack vision is now blocked on desktop when a picture is attached, unless an OCR model is set. Video is always blocked.
- **Permissions (06c).**
  - "Always" grants are per scope (per chat when a chat has no scope) and apply only at the exact risk tier they were given at. Send, delete, pay, file-change and critical calls never offer Always.
  - In scoped chats, older per-chat approvals are no longer read, so those chats ask once more and offer "Always in this scope".
  - A grant given when a call's arguments raised its tier (for example MEDIUM to HIGH for a read of `~/.aws`) is stored at that tier and then covers other calls of the same tool at that tier. Worse than noted: one Always on `~/.aws/credentials` then read `~/.env` and `~/.netrc` unasked, and many secret paths rate only MEDIUM (S1). Fixed (#110): a secret path never takes a grant.
  - Built-in low-risk tools skip the argument checks. The old "session and knowledge data only" was wrong: the list includes network tools and `computer_ax_query`, which reads screen text, and any MCP tool with the same name skips the sheet (B1). Fixed (#110): only Dango's own toolsets get low risk, `computer_ax_query` is MEDIUM, and dangerous or secret arguments still ask.
  - Each window keeps its own permission queue; grants and revokes sync across windows, the audit log is last-writer-wins. The audit log is never trimmed (S3). Fixed (#110): it keeps the newest 500.
  - No list of dangerous commands is complete, so simple read-only commands (`ls`, `df`, `git status`…) ask once and then run without asking in that scope (decided 2026-10-22; first use ran unasked before) and every other shell command or code run asks every time with no Always grant ([ADR 0015](../adr/0015-command-tools-always-ask.md)). A command tool that hides its purpose in its name and description is only caught for CRITICAL calls. The read-only shortcut also reads secrets through relative paths when the shell runs in `~` (S2). Fixed (#110): commands that name a file or folder ask.
  - `chmod`/`chown` of a path one level below a system directory (`chmod 644 /etc/hosts`) asks every time.
  - Read-only tools with a payment word in their name (`get_payment_intent`) ask every time; reading `/dev/urandom` or `/dev/zero` and `chmod -rwx ~` ask every time (TASK-41).
- **Swarm (06c).**
  - Swarm is one toggle per chat. Chats saved with the old discuss or work modes keep their data but now answer as their first agent; room members show only when Swarm is on.
  - A Stop pressed in the first seconds of a run, before the planning turn has registered, lets planning finish; the run still ends in one answer marked "Stopped early". A Redo of a stopped-early answer keeps the mark. Worse than noted: a Stop before the live status is set finds nothing, and the full run, with tools, goes on (S5).
  - Plan mode can still show for a one-agent room whose message @-mentions two more agents with Swarm on.
  - The new-chat agent bar and a single agent's header still show with Swarm off.
- **Search (06c).**
  - Hidden chats are left out of search. "Search in current conversation" from the old dialog is gone.
  - A scoped search shows no Everywhere knowledge unless the Everywhere chip is chosen. Folder search returns at most 8 hits across all scopes, cut after the scopes are merged. Chats with no scope show only under All.
  - TASK-15 (`#root` aria-hidden on web) is fixed: the ⌘K overlay renders nothing while closed.

- **First run (09).**
  - Users whom the model check misses (for example OpenClaw-only, no token) are now held in first run on every page except Settings; they used to get a dismissable Welcome dialog (S16).
  - Importing settings replaces the first-run record, so an old export without keys sends an experienced user through all five steps.
  - The FR3 lead ("Everything Dango learns from this source stays inside it.") still shows after Skip, when there is no source.
  - A Gmail or Asana account created during step 2 is kept if the app quits during step 3 (reused on the next pick, not duplicated).
  - The "Connect a source" item from a skipped step stays open after a source is connected some other way; dismiss it.
  - A source job stuck "running" (background work paused) keeps the "Reading…" card up until Stop.
- **Window sizes (09).**
  - At 390 px the composer's model name still truncates to one letter and the thinking-level chevron overlaps its label; the scope pill and model chips are under 44 px (TASK-33 stays open; its sidebar-on-load part is fixed).
  - With a 500 px custom sidebar and the project explorer at 1200 px, the explorer shrinks to nothing so the inspector fits.
  - Opening an old chat no longer opens its artifact by itself; the card's Open button does.
  - ⌘\ opens the rail peek without moving focus into it.
  - Scope row actions overlay the client chip while hovered, and stay reachable by keyboard only through the row menu.
- **Accessibility (09).**
  - Quick Chat keeps its own announcement of the finished answer and gets no "Thinking, N seconds" updates.
  - Errors in chat are announced by the error notice, which may re-announce when the list remounts it on scroll; a Swarm "could not plan" note is not announced.
  - Older colour transitions longer than 150 ms still run under Reduce Motion; everything that moves is stopped.
  - Six confirm dialogs (discard edit, compression, imported-source delete, summary delete, knowledge base delete, clear memories) still use the old modal; deleting an imported source asks nothing (TASK-46). Worse than noted: one click deletes the whole import and rewrites every chat made from it, with no undo, and it is reachable from ⌘K (B5). Fixed (#110): it asks first.
  - At phone width the password field's show/hide icon is 44 px inside a 38 px field; it is transparent, so it looks right.
  - A blank screen when the desktop window-role lookup never answers was not reproduced: the label is read synchronously. Minor: `getWindowLabel`'s catch returns `'main'`, not "other" as documented.
  - The Mantine theme's input focus style is ignored by the styles API (a console warning, pre-existing).

## Follow-ups filed

- TASK-13: the knowledge store can't recover from an unreadable `knowledge` key, and knowledge leaks into settings export and import. Worse than noted: import overwrites this device's knowledge and brings it in approved, so it governs answers without the user approving it (B4). Fixed (#110): knowledge stays out of export and import, and an unreadable store offers Start over.
- TASK-14: the knowledge search tool. The plan is merged; nobody has been asked to build it yet.
- TASK-15: in the web build, `#root` is `aria-hidden` because a hidden MUI dialog stays mounted.
- TASK-16: the plan-mode control (taken by slice 06b).
- TASK-17: the flaky tests above.
- TASK-18: background review can suggest the same fact again in new words when it reads an item a second time.
- TASK-19: folder review should read size-changed files first.
- TASK-20: the "Choose a model" fix should honour `localOnly`, once slice 10 sets it.
- TASK-21: replace Tailwind numeric spacing with `--dango-space` tokens.
- TASK-22: a source removal still in its 5 s undo window is lost when you quit. A removed Gmail source comes back and keeps drafting (S11). Fixed (#110).
- TASK-23: design pass on the folder drop target and the scope select.
- TASK-24: Redo with another model should size the context for the picked model.
- TASK-25: locale-aware durations, numbers and currency.
- TASK-26: new chat with a summary should summarise only the part that fits.
- TASK-27: an OCR fix button, and plain copy for Dango's own error codes.
- TASK-28: rate-limit waits lost to a reload should still reach Review.
- TASK-29: the usage service treats a Gemini per-minute limit as an exhausted plan.
- TASK-30: models with unknown capabilities silently lose their tools.
- TASK-31: multi-agent rooms have gaps in the ability, cost and plan-mode checks.
- TASK-32: decide whether Redo on a tool-capable model turns tools back on after "Answer without tools".
- TASK-34 to TASK-41: from slice 06c — search more source kinds, remove the unreachable Team room discuss/work code, name the requester on the permission sheet, hidden Quick Chat permission requests, per-chat live Swarm status, grant cleanup on scope delete and timeout wording, failed Swarm tasks on the card, risk-engine false positives.
- TASK-46: from slice 09 — move the last confirm dialogs onto Sheet.
- TASK-42 to TASK-45: from slice 10 — remote local-model hosts, Gmail on Everywhere, PM pilot side effects on ordinary chats, local-only gaps outside the chat path.
- TASK-33: phone-width polish (action row behind the composer, model name truncation, sidebar opening on load) and unused translation keys.

## Slice 10: PM pilot sources

Never sending mail, never approving a fact the user didn't give, and keeping local-only mail off cloud models are enforced in code and tested. The first two hold (see Core promises); the third has gaps (B2, B3). What is left:

- **Local model check (TASK-42).** "Local" means the provider is Ollama or LM Studio, so one running on another machine, or an Ollama cloud model, counts as local. Worse than noted: the same check gates recall, chat history, the background model, reviews and knowledge, so such a host gets raw local-only records (B2). Fixed (#110): local means a loopback host, and Ollama on another machine counts as cloud.
- **Local-only gaps outside chat (TASK-45).** Follow-up suggestions after a model switch, legacy memory tools, a local model's web search query, PostToolUse hooks and settings export or history sync of chats that quote mail. Worse than noted: legacy memory, on by default, sends local-only content to the global model and saves it into every later cloud chat's prompt (B3); "Save as knowledge" on a recall answer saves it as ordinary knowledge, which goes to cloud models (S13). Fixed (#110); export and transfer leave such chats out unless ticked, and encrypted history sync keeps them by decision ([ADR 0016](../adr/0016-outside-tools-and-device-only-chats.md)).
- **Side effects on ordinary chats (TASK-44).**
  - Gemini's built-in Google search is off in nearly every desktop chat. The PM pilot isn't the real cause: the image tool and the video-URL tool already turn it off. This is an older, separate problem.
  - After a local-only recall, cloud turns in that chat lose all later answers, not only the recalled part.
  - Quick Chat doesn't warn that a source needs signing in again.
- **Gmail on Everywhere (TASK-43).** It doesn't store anything: each poll downloads every new thread and throws it away, silently. Everywhere is the default scope when Add a source isn't opened from a client. Should Add a source refuse it?
- **No model set up.** Gmail keeps the mail but pauses that account's syncing until a model is chosen.
- **Mail reading.**
  - Mobile replies that quote without `>` keep the quoted text as new text.
  - If the PM deletes the Dango label in Gmail, adding it fails (logged) until the token refreshes (about an hour) or the app restarts.
  - Replies always go to From, never Reply-To.
- **Drafts.**
  - A draft that fails to write still uses one of the day's drafts.
  - After a crash mid-write, Apply on that draft is refused for 5 minutes. The same block also follows network and 5xx errors.
  - Undo removes the Dango label thread-wide, unless another Dango draft is still written there.
  - The Done line shows the model's answer even after the PM edited the draft.
  - The "unexplained link" check misses bare domains and phone numbers.
  - A Re-check of knowledge can merge over a waiting draft after an undo (slice 4).
- **Facts from sent replies.**
  - A proposed fact's ordinary words are not checked against the reply; only its dates, numbers and names are. It is still only a proposal.
  - A crash between proposing and saving can propose the same change twice.
  - The "the draft said…" note is missing if Review wasn't loaded in the jobs window.
- **Asana.**
  - After an expired sync token, tasks deleted meanwhile stay until the next change.
  - One sign-in problem shows one Needs you per source.
- **Questions.**
  - A question is saved before its Review entry; if that write fails, the email has no visible entry.
  - Overlapping option names ("Acme", "Acme Labs") need the number.
  - "Which client is this?" answered outside the main window is applied on the next Gmail check.
  - A failed draft after an answer is not retried.
- **Housekeeping.** `mcp-inject.ts` has pre-existing biome errors.
