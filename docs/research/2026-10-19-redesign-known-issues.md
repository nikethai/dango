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
  - No list of dangerous commands is complete, so tools that run shell commands or code always ask and never take an Always grant ([ADR 0015](../adr/0015-command-tools-always-ask.md)). A command tool that hides its purpose in its name and description is only caught for CRITICAL calls.
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
- TASK-33: phone-width polish (action row behind the composer, model name truncation, sidebar opening on load) and unused translation keys.

## Per slice still to come

Slice 10 adds its section here when its PR opens.
