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

## Per slice still to come

Slices 06b, 06c and 10 add their sections here when their PRs open.
