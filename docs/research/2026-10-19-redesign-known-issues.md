---
type: research
status: draft
description: "Running list of known issues, trade-offs and unverified checks left by the redesign slices, to review together once the slices are merged"
generated: { by: claude/opus-5.5, at: 2026-10-19T12:40:00Z }
---
# Redesign: known issues and trade-offs

The redesign slices keep this list up to date. Each slice adds what it leaves behind: things not verified, trade-offs accepted on purpose, and follow-ups. When the slices are done, we go through it together and decide what to fix, file or drop.

Cards marked `TASK-n` live on the Backlog.md board (`backlog task view TASK-n`).

## Not verified yet (needs a real machine)

| Slice | What | How to check |
|---|---|---|
| 06a | The plan card's live states (running, stopped, Continue) were not tried with a real streaming model. Slice 06b adds a plan-mode toggle and a scripted end-to-end test, but a real-model run is still manual. | Turn plan mode on in an agent chat and run a plan against a real model (TASK-16). |
| 07 | The Rust app crate is not compiled here, which covers draft bindings and the Codex threads reader. Only the reader's pure logic was tested, in a scratch crate. | `cargo check` and `cargo test --lib workspace::` on macOS and once on Windows. |
| 07 | The Windows-only file-identity check (`same_file` / `same_created`) has never run. | Same as above, on Windows. |
| 07 | The desktop manual walk has not been run. | PR #104's checklist. |
| 08 | The Quick Chat window, menu bar and notifications have not been compiled or walked on the desktop. | PR checklist for slice 08. |
| 06b | Agent Mode and Plan mode only appear on desktop, so the new Mode section in the Tools menu and the plan-mode toggle were not seen in a real window. The web build was walked headless in light and dark at 1280 and 375 px. | Desktop walk in the slice 06b PR. |
| 06b | No real model has run a plan end to end. A scripted-model test covers it. | TASK-16 AC #3. |
| 06c | The permission sheet in the Quick Chat window, real tool calls through MCP servers, and a live Swarm run with real agents were not exercised; the web build was walked headless (sheets triggered directly, Swarm runs seeded). | Desktop walk in the slice 06c PR. |
| 10 | Gmail and Asana have only been tested against mocks (msw). Nobody has signed in, received mail, or seen a draft land in a real mailbox. | The manual walk in the slice 10 PR (macOS, Trust Auto and Ask). |
| 10 | Asana's CORS was checked with curl from this container, not from the desktop webview. Whether a new comment updates a task's `modified_at` (the 90-day comment window relies on it) is unconfirmed. | Same walk: connect Asana in the desktop app, comment on an old task. |
| 10 | The CH6 chat opened from the Quick Chat window and the draft edit sheet's real modal path were not seen in a window. | Same walk. |
| 09 | First run with a real source (the "Reading your folder…" card), desktop sign-in with ChatGPT or Google, and the folder picker were not walked: on web every source kind needs the desktop app. | The slice 09 PR's desktop walk. |
| 09 | The three window sizes, the rail and the inspector were walked headless on web only. A real desktop resize, iOS (swipe, safe areas), Android (keyboard flag, rotation), tablets at 760 px or wider, VoiceOver/NVDA and macOS Reduce Motion were not run. | Same walk, plus one phone and one screen reader. |
| all | No CI runs the tests. The local gates are the only check. | — |

## Trade-offs accepted on purpose

- **Pre-existing errors.** Main already has 37 `pnpm check` errors and 9 `pnpm lint` errors. Each slice adds none but fixes none.
- **Flaky tests.** Some timing-dependent tests fail about one full run in several: `stream-text`, `format-chat-sensitive`, `approve.test` (TASK-17).
- **Codex threads (07).**
  - The reader stalls if an attacker swaps a thread file for a FIFO during a narrow window between the check and the open. Doing this already needs write access to the user's home folder.
  - The read cursor format changed while slice 07 was being built, so an older cursor reads every thread from the start again. That is harmless because nothing had shipped yet.
- **Background jobs (07).**
  - A job waiting in Needs you blocks new runs of that source until you press its fix.
  - After you press Stop, the source waits a full interval before it runs again.
  - Both are deliberate, so a failing source doesn't add a Needs you entry every 15 minutes.
- **First sync (07).** Every source that has never synced gets one sync at launch, even folders with Background review off.
- **Folder review (07).** It rotates through files instead of tracking each file's revision. In a very large folder, a changed file can wait weeks to be read (TASK-19).
- **Review empty state (07 corrects 05).** EM2, "no sources yet", shows only when there are no sources and nothing visible in Review.
- **Quick window (07, 08).** Any desktop window other than main sends setup to the main window and runs no jobs. This follows the maintainer's rule that anything to configure opens the big window.

- **Settings › Chat Display removed (06b).** Its six toggles (token count, model name, token speed, word count, timestamp, first-token time) had no effect any more. The saved values stay, so nothing needed migrating.
- **Picture chats (06b).** Editing a question in a picture chat now resends it, so changing only the wording means generating new images.
- **Editing a question (06b).** Editing the first question of a chat overwrites its old wording. The old answer is kept as a branch.
- **Cost estimate (06b).** It prices one model call per run at the uncached price, so an Agent Mode turn with many tool calls can cost more than the sheet says. Quick Chat and plan runs never show the sheet.
- **Quick Chat (06b).** It still shows raw model errors and runs no ability or cost checks.
- **Desktop vision block (06b).** A model known to lack vision is now blocked on desktop when a picture is attached, unless an OCR model is set. Video is always blocked.
- **Permissions (06c).**
  - "Always" grants are per scope (per chat when a chat has no scope) and apply only at the exact risk tier they were given at. Send, delete, pay, file-change and critical calls never offer Always.
  - In scoped chats, older per-chat approvals are no longer read, so those chats ask once more and offer "Always in this scope".
  - A grant given when a call's arguments raised its tier (for example MEDIUM to HIGH for a read of `~/.aws`) is stored at that tier and then covers other calls of the same tool at that tier.
  - Built-in low-risk tools (session and knowledge data only) skip the argument checks.
  - Each window keeps its own permission queue; grants and revokes sync across windows, the audit log is last-writer-wins.
  - No list of dangerous commands is complete, so simple read-only commands (`ls`, `df`, `git status`…) run without asking and every other shell command or code run asks every time with no Always grant ([ADR 0015](../adr/0015-command-tools-always-ask.md)). A command tool that hides its purpose in its name and description is only caught for CRITICAL calls.
  - `chmod`/`chown` of a path one level below a system directory (`chmod 644 /etc/hosts`) asks every time.
  - Read-only tools with a payment word in their name (`get_payment_intent`) ask every time; reading `/dev/urandom` or `/dev/zero` and `chmod -rwx ~` ask every time (TASK-41).
- **Swarm (06c).**
  - Swarm is one toggle per chat. Chats saved with the old discuss or work modes keep their data but now answer as their first agent; room members show only when Swarm is on.
  - A Stop pressed in the first seconds of a run, before the planning turn has registered, lets planning finish; the run still ends in one answer marked "Stopped early". A Redo of a stopped-early answer keeps the mark.
  - Plan mode can still show for a one-agent room whose message @-mentions two more agents with Swarm on.
  - The new-chat agent bar and a single agent's header still show with Swarm off.
- **Search (06c).**
  - Hidden chats are left out of search. "Search in current conversation" from the old dialog is gone.
  - A scoped search shows no Everywhere knowledge unless the Everywhere chip is chosen. Folder search returns at most 8 hits across all scopes.
  - TASK-15 (`#root` aria-hidden on web) is fixed: the ⌘K overlay renders nothing while closed.

- **First run (09).**
  - Users whom the model check misses (for example OpenClaw-only, no token) are now held in first run on every page except Settings; they used to get a dismissable Welcome dialog.
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
  - Six confirm dialogs (discard edit, compression, imported-source delete, summary delete, knowledge base delete, clear memories) still use the old modal; deleting an imported source asks nothing (TASK-46).
  - At phone width the password field's show/hide icon is 44 px inside a 38 px field; it is transparent, so it looks right.
  - If the desktop window-role lookup never answers, a new user stays on a blank screen instead of first run (no timeout; a failed lookup is handled).
  - The Mantine theme's input focus style is ignored by the styles API (a console warning, pre-existing).

## Follow-ups filed

- TASK-13: the knowledge store can't recover from an unreadable `knowledge` key, and knowledge leaks into settings export and import.
- TASK-14: the knowledge search tool. The plan is merged; nobody has been asked to build it yet.
- TASK-15: in the web build, `#root` is `aria-hidden` because a hidden MUI dialog stays mounted.
- TASK-16: the plan-mode control (taken by slice 06b).
- TASK-17: the flaky tests above.
- TASK-18: background review can suggest the same fact again in new words when it reads an item a second time.
- TASK-19: folder review should read size-changed files first.
- TASK-20: the "Choose a model" fix should honour `localOnly`, once slice 10 sets it.
- TASK-21: replace Tailwind numeric spacing with `--dango-space` tokens.
- TASK-22: a source removal still in its 5 s undo window is lost when you quit.
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

Never sending mail, never approving a fact the user didn't give, and keeping local-only mail off cloud models are enforced in code and tested. What is left:

- **Local model check (TASK-42).** "Local" means the provider is Ollama or LM Studio, so one running on another machine, or an Ollama cloud model, counts as local.
- **Local-only gaps outside chat (TASK-45).** Follow-up suggestions after a model switch, legacy memory tools, a local model's web search query, PostToolUse hooks and settings export or history sync of chats that quote mail.
- **Side effects on ordinary chats (TASK-44).**
  - While any client has Gmail or Asana, Gemini's built-in Google search is off in every desktop chat.
  - After a local-only recall, cloud turns in that chat lose all later answers, not only the recalled part.
  - Quick Chat doesn't warn that a source needs signing in again.
- **Gmail on Everywhere (TASK-43).** It stores and does nothing, silently. Should Add a source refuse it?
- **No model set up.** Gmail keeps the mail but pauses that account's syncing until a model is chosen.
- **Mail reading.**
  - Mobile replies that quote without `>` keep the quoted text as new text.
  - If the PM deletes the Dango label in Gmail, adding it fails (logged) until restart.
  - Replies always go to From, never Reply-To.
- **Drafts.**
  - A draft that fails to write still uses one of the day's drafts.
  - After a crash mid-write, Apply on that draft is refused for 5 minutes.
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
