---
type: plan
status: draft
description: "Fix plan for the open findings of the 2026-10-31 monkey test (web and desktop): model choice first, then the desktop shell, chat sending and errors, Review, copy and accessibility, navigation, and two investigations"
generated: { by: claude/opus-5.5, at: 2026-11-01T01:30:00Z }
---
# Fixes from the monkey test (2026-11-01)

Source: [monkey test of the web build](../research/2026-10-31-monkey-test-web.md), findings 1–29 and its small notes. Finding numbers below are that report's. Planned in deep mode: phase 1 is scouted and written in detail; every later phase gets its own scout pass (read the cited code, confirm the cause, then refine the phase's tasks here) before any code changes. Two adversarial reviews changed phase 1 and the ground rules (see Red team review at the end).

## Ground rules

- **One fix per branch**, cut from `main` unless the task says otherwise, named in each task. Each branch is merged locally into `qa/monkey-all-fixes` for testing and pushed. No PRs (`gh` is not authenticated). Nothing is committed or merged without the maintainer.
- Leave alone, never commit: `src-tauri/gen/schemas/capabilities.json`, `vitest.config.mts`, `docs/plans/`, `docs/research/2026-10-26-mac-verification.md`.
- Test only with a disposable profile and the loopback fake provider. Never click Always on write, delete or command permissions. No real Gmail, Asana or MiMo requests. Web runs keep the guard that blocks every non-loopback host.
- Tasks marked **Ruling** wait for the maintainer's answer before code changes.
- Every task finishes with: its unit tests, `pnpm test`, `pnpm check` (no new errors beyond the 36 baseline), `pnpm lint` (no new beyond 9), and the named repro on web (`pnpm dev:web`) or on the QA desktop bundle. Rust changes also run `cargo test --lib` in `src-tauri`.
- **Overlapping files.** These tasks edit the same files and land in this order, each later branch rebased onto the earlier one's merge result before review: `InputBox.tsx`: 1.1b → 3.1 → 3.2 → 3.6. `generation.ts`: 1.1b → 3.3 → 3.4 → 3.5. Both files already differ between `main` and `qa/monkey-all-fixes`, so conflicts are resolved in the merge into `qa/monkey-all-fixes`, never by editing a fix branch for another fix.

## Progress (2026-11-01)

Each branch is pushed and merged into `qa/monkey-all-fixes`; nothing is on `main` yet.

| Task | Branch | Commit | Checked |
|---|---|---|---|
| 0.1 | `chore/fake-provider-modes` | `262c9f85` | — |
| 0.2 | QA bundle `io.github.nikethai.dango.qafix` | — | built from `qa/monkey-all-fixes` |
| 1.1a | `fix/no-model-no-send` | `e4377324` | unit tests; web repro (no request to OpenAI, removed provider skipped) |
| 1.1b | `fix/no-model-send-gate` | `31587ffa` | unit tests; web repro (send blocked until a model is picked) |
| 1.2 | `fix/first-run-default-model` | `0dfe38f0` | unit tests; web and desktop (default saved by itself); background review itself not run |
| 1.3 | `fix/quick-chat-model-name` | `5102e8fa` | cause confirmed on desktop; caption on web and desktop; after three minutes a new chat answers on the new default (B) |
| 2.1 | `fix/quick-navigate-main-only` | `5722991b` | unit tests, `cargo test --lib desktop_shell`; desktop: ⌘⇧Space, Esc, menu bar › Open Dango shows Review with the sidebar (twice) |
| 2.2 | `fix/desktop-min-width` | `7b43446c` | desktop: a 300 px request stops at 400 px; one pane with bottom tabs at 400, the rail at 800, three panes at 1300; title bar clear |
| 2.3 | `fix/quick-chat-shortcut-label` | `20a1c44a` | full suite |
| 2.4 | `fix/notification-permission-copy` | `091a2306` | unit tests, full suite; QA desktop: new copy shows, Send a test notification shows the toast and macOS then asks for notification permission (the first send asks the OS, left for the maintainer), Open System Settings opens the Notifications pane |
| 3.1 | `fix/send-current-text` | `84c73058` | source test, full suite (5,407); web: text set and Enter in the same task, after 0 ms and after 16 ms all save their text (the old build saved the first two empty); QA desktop: typing and Enter in one keystroke run sent all three messages |
| 3.2 | `fix/long-paste-attachment` (from 3.1) | `75bc664d` | unit tests, full suite; web: a 3,570-character paste shows `pasted_text_0.txt` and the sent message carries the file; QA desktop: a 3,601-character paste shows the `pasted_text_0.txt` chip and the provider receives the file |
| 3.3 | `fix/stop-before-first-word` (from 1.1b) | `82caf7de` | unit tests (the Stop test fails without the fix), full suite; web with `slow-15`: Stop after 3 s leaves the question with no error and no browser panel; screen readers hear "Stopped before answering." (nothing visible is added); QA desktop with `slow-15`: Stop leaves the question with no error and no browser panel |
| 3.4 | `fix/live-state-on-failure` (from 3.3) | `c6190906` | unit test (fails without the fix), full suite; web: after the Web Search refusal the composer shows Send throughout and no "Thinking…" (before: Thinking… stayed); not reachable on desktop: the refusal is web-only (`messages.ts` checks `platform.type === 'web'`), and a no-tools model with Web Search on just answers, Send showing |
| 3.5 | `fix/empty-reply-copy` (from 3.4) | `2b712443` | unit tests, full suite; web: `empty` mode shows "Fake E (fake-model) sent no reply." with Retry and no token count; `drop` details read "Error from Fake E", not "Custom OpenAI"; QA desktop: `empty` reads "Fake B (fake-model) sent no reply." with Retry and no token count |
| 3.6 | `fix/chat-offline-notice` (from 3.2) | `7f238163` | unit tests, full suite; web with a non-local custom provider: offline shows "You're offline. Remote Model needs a connection to answer." with Retry, Enter keeps the draft and sends nothing, Retry once online clears it |
| 3.8 | `fix/desktop-idle-stream` (from 3.5) | `806d5532` | unit tests, full suite; web: `drop` mode reads "Couldn't reach Fake E." with Retry ; QA desktop: `drop` and `slow-65` (WebKit cuts it at about 60 s) both read "Couldn't reach Fake B." with Retry, details "Error from Fake B: … Load failed" |
| 3.7 | `fix/web-search-tools-copy` (from 3.8) | `8440c76c` | unit test, full suite; web: the refusal reads "Fake F (fake-model) can't search the web because it doesn't use tools. Turn off Web Search in the + menu, or choose a model that uses tools."; web-only refusal, so no desktop check (see 3.4) |
| 4.2 | `fix/superseded-not-done` | `9d67f078` | unit tests (fail without the fix), full suite; web: a second failed review run dismisses the first one's entry, and Review shows only the newest failure, nothing under Done |
| 4.1 | `fix/no-model-item-clears` (from 1.2) | `2e17bf81`, `fd83301b` | unit tests (fail without the fix), full suite; web: with two failed runs, making the default model ready closes the newest "no model is set up" entry by itself and re-runs its review, opening nothing; the superseded one stays hidden. The first web run found the watcher also re-ran the superseded job and showed it under Done again, fixed in `fd83301b` |
| 4.3 | `fix/resolved-conflict-subline` | `0f722166` | unit tests (fail without the fix), full suite; web: Keep this on the new statement leaves Done with the new statement and `Replaced: "…"`; on the saved one, Done reads the saved statement with no sub-line. Undo not rechecked in the UI |
| 4.4 | `fix/conflict-button-width` | `b0671962` | CSS test, full suite; web with a long statement and source: Keep this is 82 px on one line at 1440, 1024 and 390 px, the text wraps, no sideways scroll |
| 5.2 | `fix/status-bar-provider-name` | `973fa4d6` | unit test, full suite; web: the status bar reads "Fake W · Fake Model" (was the provider id) |
| 5.4 | `fix/add-provider-dialog` | `b3648338` | unit tests, full suite; web at 800×768 and 800×420: the Add footer ends at the window's bottom (before: 41 px below it), Default models and General still scroll to their end; Name is labelled and focused on open, Enter with an empty name shows "Name is required", Enter with a name saves and opens the new provider, Escape on the Add menu returns focus to Add |
| 5.1 | `fix/control-names` | `6ae338ef`, `8a3c825a`, `028a60f7`, `d978df0e` | unit tests, full suite; web: dialog close buttons read "Close", the four Default models pickers read "<setting>: <value>", the version arrows read "Previous version" / "Next version", the + menu's Web Search switch and the dev theme toggle are named. The web pass found three more unnamed buttons of the same kind, named in the later commits: Auto compaction in the token menu, Thread History's close, and a sidebar chat row's menu ("More") |
| 5.3 | `fix/hide-unavailable-workspace-tabs` | `7418b91c`, `24d2db4d` | unit tests (Files only when features are off or capabilities can't be read; a tab per ready feature; Export safe snapshot only when export is ready), project-workspace integration test, full suite. Not run on desktop: the QA desktop app copy was lost with the scratchpad, and the web build has no workspace folder |
| 6.3 | `fix/agent-picker-ranking` | `de32ed0b`, `6bdcf3e7` | unit tests, full suite; web: `@Task` lists Task Planner first and Enter adds it. The web pass found a second cause, fixed in the later commit: the half-typed `@Task` counted as a mention of Task Planner (mentions match by prefix), so the picker left Task Planner out entirely |
| 6.1 | `fix/first-question-fork` | `c1d9bf61` | unit test, full suite; web: editing a chat's first question shows ‹ 2 / 2 › under it, and ‹ brings back the old question and answer |
| 6.2 | `fix/settings-close-returns` | `650781c0` | unit tests, full suite; web: × and Escape return to a scope's Knowledge tab (also after moving to General inside Settings), and from a chat, home or a scope's Overview to that page |
| 7.3 | `fix/no-search-without-tools` | `8bacc830` | unit tests (the menu's tests fail without the change), full suite; web with Web Search configured (Bing): the + menu shows Web Search off and disabled with "This model can't search the web", and a send that the old build refused answers in 1 s from one request, no outside host reached; QA desktop app built from `6523d3b5` (profile Web Search on Bing, Fake B): the + menu shows the same, and a send is answered from one request in 1.1 s, with the title and post-answer calls only after it |

7.3 merged result: `qa/monkey-all-fixes` at `6523d3b5` passes the full suite (470 files), with type check and lint at baseline. The merge kept 5.1's name on the Web Search switch.

Phase 6 merged result: `qa/monkey-all-fixes` at `16cf5d07` passes the full suite (470 files), with type check and lint at baseline.

Phase 5 merged result: `qa/monkey-all-fixes` at `5f04da77` passes the full suite (469 files), with type check and lint at baseline. The run before it had `WorkspacePanel.test.tsx` fail one test under load; it passes alone and in the rerun.

Phase 4 merged result: `qa/monkey-all-fixes` at `2beac0d7` passes the full suite (5,481), with type check and lint at baseline. Two earlier full runs each had one different file fail under load (`format-chat-sensitive.test.ts` timing out at 10 s, `useMenuBarSync.test.tsx`). Both pass alone, and the first takes 7–8 s alone at the phase 3 head too.

Phase 3 merged result: `qa/monkey-all-fixes` at `17b3e9ee` passes the full suite (5,473), `pnpm check` 36 and `pnpm lint` 9. Not rerun yet: the desktop QA bundle for phase 3 (3.8's `slow-65`, 3.1–3.7 on desktop).

Dev note: three times today the web dev profile lost its settings (custom providers, default model, first run) right after `src/renderer/i18n/locales/en/translation.json` changed while the app was open (an edit, or a branch checkout under a running `pnpm dev:web`). Edits to other files never did. Hot reload only; a built app never reloads that file. Not traced further.

Test notes: `knowledge/approve.test.ts` ("a second approve of the same proposal…") failed once under the full suite on the merged branch and passed three times alone (timing-sensitive, untouched by these fixes).

## Phase 0: Test setup (before any fix)

- **0.1 Fake provider on its own branch.** `scripts/fake-provider.mjs` is not on `main` (it came in with `ba7e4f7a`, only on `fix/slash-tokens-keep-paths`), and its `slow`, `empty`, `drop` and `drip` modes and the fact-extraction answers are uncommitted. A branch cut from `main` cannot run the repros, and switching branches with this file modified is refused. Commit the current script on `chore/fake-provider-modes` cut from `main` (maintainer ruling 2026-11-01: yes), merge it into `qa/monkey-all-fixes`, and run the provider from that branch's copy. Start it with `PORT=8787 node scripts/fake-provider.mjs`.
- **0.2 A clean QA desktop profile.** The existing QA bundle (`io.github.nikethai.dango.qafirst`) still holds the MiMo test key, and the desktop app has no guard against outside hosts (that is how finding 25 reached MiMo). Use a new identifier with an empty profile and only fake-provider custom providers: `pnpm tauri build --debug --bundles app --config '{"identifier":"io.github.nikethai.dango.qafix"}'`, built from `qa/monkey-all-fixes`. Before each desktop repro quit the real Dango: `legacy_rename.rs:26,112–124` hard-codes the real identifier and runs on every launch, the keychain service `dango.integrations` is shared across identifiers (`secret-store.ts:16`), and ⌘⇧Space is a system-wide hotkey.

## Phases

| # | Phase | Findings | Severity | Status |
|---|---|---|---|---|
| 0 | Test setup | — | Blocks repros | Ready |
| 1 | Model choice: nothing goes to a provider the user did not choose | 17, 6, 13, 25 | High (core promise) | Scouted, reviewed |
| 2 | Desktop shell | 22, 400 px ruling, 15, 24 | High (22) | Outline |
| 3 | Chat sending and errors | 12, 27, 1, 4, 5, 18, 2, 26 | High (12, 27 lose input) | Done (3.8's local-host streaming is a ruling) |
| 4 | Review and knowledge | 14, 29, 20, 19 | Medium | Done |
| 5 | Copy, labels and accessibility | 3, 10, 23, small notes | Medium | Done |
| 6 | Navigation and pickers | 8, 11, 21 | Low | Done |
| 7 | Investigations | 7, 28 | Unknown | Investigated |

Out of scope: 9 (fixed on `fix/publish-webpage-asks`), 16 (came from Xiaomi's MiMo API, not Dango), the header's 900 px breakpoint versus the 760 px layout breakpoint (noted with the 400 px ruling, not a finding), VoiceOver, real offline, Windows and signed builds (still open in the [testing plan](2026-10-31-desktop-testing-after-codex-walk.md), on `docs/desktop-testing-plan`).

## Phase 1: Model choice

**Goal:** a chat, Quick Chat or model call only ever uses a model whose provider the user has set up; with none, Dango asks the user to choose and sends nothing. Background work keeps its rule that it never switches models on its own (`pm-pilot/background-model.ts:4–6`).

### What the scout and the reviews found

- **Silent OpenAI fallbacks.**
  - Chat defaults: `defaults.chatSessionSettings()` returns OpenAI `gpt-4o` (`src/shared/defaults.ts:236`). `mergeDefaultSessionSettings` spreads it under every chat session's settings (`src/renderer/stores/chatStore.ts:370`), so a chat without `provider`/`modelId` becomes OpenAI `gpt-4o` at send time (finding 17). The chat page still shows "Select Model", because it reads the raw `session.settings` (`routes/session/$sessionId.tsx:247–255`).
  - Legacy remap: the ChatboxAI remap below that also sends to `gpt-4o` without checking that OpenAI is set up (`chatStore.ts:383–398`).
  - Picture chats default to OpenAI `gpt-image-1` (`defaults.ts:244–250`), and Image Creator starts on OpenAI (`routes/image-creator/index.tsx:233`).
- **Stale models put into new chats.**
  - `initEmptyChatSession` copies the default chat model or the raw last-used model (`stores/sessionHelpers.ts:838–857`).
  - `createSession` then spreads the last-used model under every new session again (`chatStore.ts:188–194`).
  - Neither checks that the provider still exists (finding 6).
- **Send gates.**
  - The composer already blocks a send for `setup-required`, `provider-unavailable` and `model-unavailable`, but only on the mobile layout (`InputBox.tsx:746–749`, tip at `:1607–1619`).
  - Redo and edit-and-resend go through with no model (`components/chat/before-send.ts`, `requestBeforeSend`).
  - `getModel` only checks that a provider id is set and throws the raw string "Model provider must not be empty." (`src/shared/providers/index.ts:106–117`). It is the one call every model use goes through: naming, compaction, memory, contradictions, summaries, review, follow-ups, writing and generation (16 renderer callers).
- **"Usable" means three different things.**
  - `isProviderListedInSettings` counts every custom provider and the built-in OpenClaw and ComfyUI (an image model) as usable (`src/shared/providers/provider-credentials.ts:19–50`).
  - `needEditSetting` (`stores/settingActions.ts:7–31`) and `getModelReadiness` (`utils/modelReadiness.ts:54`) are stricter. `getModelReadiness` also requires the model to be in the provider's list.
- **First run** saves a default only in `ModelStep.finish` (`components/first-run/ModelStep.tsx:77–87`). `resolveFirstRun` is a pure function computed in `useFirstRun.ts`, and upgrading users are marked completed and never run it. Any other way of setting up a provider leaves no default, so background review finds no model (finding 13).
- **Quick Chat** picks its open chat's model, then the default, then the last used, without checking either (`components/quick-chat/useQuickChat.ts:169–175`). It reopens the same chat within three minutes (`loadSnapshot`, `:109–140`, as flow 2 specifies). Most likely finding 25 was such a reopen. The second possibility: Enter was pressed before `reloadSharedState` (`:67`) finished.

### Task 1.1a: choose the model once, when the chat is created (17, 6) — branch `fix/no-model-no-send`

**Files:**
- `src/renderer/utils/modelReadiness.ts`
- `src/renderer/stores/sessionHelpers.ts`
- `src/renderer/stores/chatStore.ts`
- `src/shared/defaults.ts`
- `src/renderer/components/quick-chat/useQuickChat.ts`
- `src/renderer/routes/image-creator/index.tsx`
- Tests beside each.

1. **One usable check, one resolver.** Add `usableChatModel(settings, lastUsedChat, providers): SelectedModel | null` beside `getModelReadiness`. It returns the default chat model if `getModelReadiness` says `ready`, else the last-used model if `ready`, else null. Image-only providers (ComfyUI) are never `ready` for chat.
2. **Choose at creation, and save the choice.**
   - `initEmptyChatSession` and `createSession` take the model from `usableChatModel`; `createSession` no longer spreads the raw last-used model.
   - A new picture session takes the last-used picture model only if it is `ready`.
   - The chosen model is saved in `session.settings`, so every reader sees the same one. These readers use the raw settings: the chat page, naming, compaction, Redo and Quick Chat.
3. **No model filled in later.**
   - `mergeDefaultSessionSettings` keeps only non-model defaults. `chatSessionSettings()` and `pictureSessionSettings()` lose `provider` and `modelId`, after checking each caller found by `grep -rn "chatSessionSettings\|pictureSessionSettings" src`.
   - The ChatboxAI remap keeps the model only if OpenAI is `ready`; otherwise the session has no model and asks.
4. **Quick Chat uses the resolver.** Its model is the open chat's model, else `usableChatModel`, instead of the unchecked default and last used.
5. **Image Creator** starts on the last-used picture model if `ready`, otherwise on no provider (the picker asks).
6. **Labels:** `getModelDisplayName` (`packages/model-setting-utils/index.ts:25`) named a chat without a model "OpenAI API ()"; it now returns no name. Found in the web repro (2026-11-01): no request left, but the footer claimed OpenAI.

**Tests:**
- `usableChatModel`, one case each:
  - the default is ready;
  - the default's provider was removed and the last-used model is ready;
  - both are gone, so it returns null;
  - ComfyUI is never chosen;
  - a custom provider whose model list does not include the model is not ready.
- `initEmptyChatSession` and `createSession` with a removed provider.
- `mergeDefaultSessionSettings` never adds a provider.
- The ChatboxAI remap without OpenAI set up.
- Quick Chat's `model` with an unusable default.

### Task 1.1b: nothing sends without a ready model (17, 6) — branch `fix/no-model-send-gate`, cut from `fix/no-model-no-send`

**Files:**
- `src/renderer/components/InputBox/InputBox.tsx`
- `src/renderer/components/chat/before-send.ts`
- `src/shared/providers/index.ts`
- The error copy where `errorExtra` kinds are mapped (next to the `fix/no-raw-internals` mapping).
- Tests beside each.

1. **Composer:** block the send for `setup-required`, `provider-unavailable` and `model-unavailable` on every layout, not only mobile (`InputBox.tsx:746–749`). Show the existing tip there with "Choose a model to send this", and keep the typed text. This also covers an existing chat whose provider was deleted.
2. **Redo and edit-and-resend:** `requestBeforeSend` returns false when the chat has no ready model, and opens the picker.
3. **Model calls:** in `getModel`, refuse a provider that is not set up in `globalSettings`, with a typed error (`errorExtra` kind `model-not-set-up`, copy "Choose a model in Settings › Models and keys"). Use the provider-level check from `needEditSetting` here, not the model-list check, so typed-in custom model ids keep working. This replaces the raw "Model provider must not be empty." and covers naming, compaction, memory, contradictions, summaries, review and follow-ups in one place.

**Tests:**
- The composer does not call `submitNewUserMessage` for each blocked status, on the desktop layout.
- `requestBeforeSend` with no model.
- `getModel` with a provider that is not set up throws `model-not-set-up`.
- An existing chat on a deleted provider cannot send.

**Repro** (covers 1.1a and 1.1b):
- Web, fresh origin, guard on.
- Set up the fake provider via **Ollama and other providers**, finish first run, ⌘N, and send `hi` without touching the picker. It either answers on the fake provider (the one usable model) or asks. Nothing reaches `api.openai.com`.
- Delete a provider that was last used, then:
  - open a new chat: it uses the other provider, or asks;
  - in an old chat on the deleted provider, the send is blocked, and so are Redo and edit-and-resend.

**Risk:** chats saved without a model, and legacy ChatboxAI chats, used to answer through OpenAI. Now they ask. That is the intended change, and the log line says so.

### Task 1.2: first run leaves a default when the choice is obvious (13) — branch `fix/first-run-default-model`, cut from `fix/no-model-no-send`

**Files:**
- `src/renderer/packages/first-run/` (a new `ensureDefaultChatModel.ts`)
- `ModelStep.tsx`
- The main window's startup, where other settings subscriptions are registered.
- Tests beside them.

1. Add `ensureDefaultChatModel()`. When there is no default chat model, no ready last-used model, and exactly one provider has a `ready` chat model, it saves that provider's first chat model as the default. With two or more usable providers it does nothing, and the Review item asks the user to choose (phase 4.1). It uses the same readiness check as 1.1a.
2. `ModelStep.finish` calls it in place of its own logic.
3. A settings-store subscription in the main window calls it too. That covers provider setup through the **Ollama and other providers** link, Settings, and upgrading users. The quick window does not subscribe.

**Tests:**
- One usable custom provider added outside step 1 → a default is saved.
- Two usable providers → none is saved.
- An existing usable default is never replaced.
- ComfyUI or OpenClaw defaults alone → none is saved.

**Repro:**
- Web, fresh origin.
- Follow the route from finding 13: a custom provider via **Ollama and other providers**, connect the throwaway folder, finish.
- Settings now hold a default, and the first review raises no "no model is set up" item.

### Task 1.3: Quick Chat's model (25) — confirm, then **Ruling**

1. Reproduce on the phase 0 QA bundle with two fake-provider custom providers, A and B (no MiMo):
   - ask in Quick Chat on A;
   - change the default to B;
   - reopen within three minutes and ask;
   - repeat after more than three minutes;
   - repeat, pressing Enter the moment the panel opens.
2. If only the reopen within three minutes uses A, that is flow 2 as written. **Ruling needed:**
   - show the model's name in Quick Chat;
   - start a new chat when the default changed since the reused chat began;
   - or leave it.
3. If the instant Enter uses A, Quick Chat waits for `reloadSharedState` before sending: the send stays disabled until the reload settles. No ruling is needed for that.

**Result (2026-11-01, QA bundle `qafix` with the phase 1 fixes, fake providers A and B on 127.0.0.1:8789):** Quick Chat answered on A while A was the default. After the default was switched to B, a question asked within three minutes reopened the same chat (both questions in the request) and was answered on A again. So finding 25 is flow 2's three-minute reopen, invisible because Quick Chat shows no model name; it is not a stale-settings bug. The after-three-minutes and instant-Enter cases were not run: a scripted paste landed in another app that was in front, so desktop keyboard driving stopped there. The three-minute reuse is covered by `useQuickChat.test.ts`.

## Phase 2: Desktop shell (outline)

- **2.1 Main window stuck on Quick Chat (22)** — branch `fix/quick-navigate-main-only`.
  - Cause: `show_quick` emits `shell:navigate "/quick"` with `window.emit`, which reaches every window (`src-tauri/src/desktop_shell.rs:151`, `:161`). The payload is only a path.
  - Rust: send it with `emit_to(QUICK_LABEL, …)` at both lines.
  - Renderer: `onShellNavigate` (`useDesktopShell.ts:122–124`) ignores `/quick` unless this window's label is `quick`, as `:130–134` already does for `navigate-to`.
  - The scout checks that the quick window's listener is registered before the first emit at `:151`.
  - Repro on the QA bundle: Review, ⌘⇧Space, Esc, then menu bar › Open Dango shows Review.
- **2.2 Desktop minimum width 400 px (maintainer ruling 2026-11-01)** — branch `fix/desktop-min-width`.
  - Change `src-tauri/tauri.conf.json:19` from `minWidth: 1000` to `400`.
  - Repro on the QA bundle: resize to 400, 800 and 1300 px. The one-pane layout with bottom tabs, the rail and the three panes appear in turn, nothing scrolls sideways, and the native title bar stays clear.
- **2.3 Quick Chat hotkey label (15)** — branch `fix/quick-chat-shortcut-label`. `Shortcut.tsx:112` labels `quickToggle` "Show/Hide the Application Window". Rename it to "Show or hide Quick Chat" and update the locale files that carry the key.
- **2.4 "Permission granted" before macOS is asked (24)** — branch `fix/notification-permission-copy`. Maintainer ruling 2026-11-01: both options below. Done: on desktop the row reads "macOS decides whether these show: System Settings › Notifications › Dango." with Open System Settings and Send a test notification; web and mobile keep Request permission.
  - `tauri-plugin-notification` 2.3.3 reports Granted on desktop for both the check and the request, so Dango cannot know macOS's answer.
  - Option 1: replace the status line with "macOS decides whether these show: System Settings › Notifications › Dango", with a button that opens that pane.
  - Option 2: add a "Send a test notification" button.
  - Scout: whether a small native call can read the `UNUserNotificationCenter` settings on macOS.

## Phase 3: Chat sending and errors

Scouted 2026-11-01 (three read-only passes over `qa/monkey-all-fixes`); causes below are confirmed at the cited lines unless marked.

- **3.1 A message sent the instant its text lands is empty (12)** — branch `fix/send-current-text`, cut from `fix/no-model-send-gate`.
  - Cause: an effect (`InputBox.tsx:560–583`) rebuilds `preConstructedMessage` after each `messageInput` change, and its atom write lands a render later. `handleSubmit` sees the new `messageInput` (so the empty check passes) but sends the old message (`:1657–1664`). The voice path already waits out this gap (`:2224–2231`).
  - Fix: `handleSubmit` builds the message itself with `constructUserMessage(messageInput, …)` (pure and synchronous) and uses it for the cost estimate and the send.
  - Test: a source test on `handleSubmit`; on web, set the text and press Enter in one task, and the request carries the text.
- **3.2 Pastes over 3,000 characters vanish (27)** — branch `fix/long-paste-attachment`.
  - Cause (reproduced on web): `decideClipboardPaste` returns `plainText: null` for long text and prevents the default (`clipboardImages.ts:146,150–152`). `onPaste` then measures that null as `''` (`InputBox.tsx:2722–2725`), so no `pasted_text_N.txt` file is made and nothing is inserted.
  - Fix: let the decision say the paste is long text and carry the raw text, and build the file from it.
  - Test: `clipboardImages.test.ts`; on web a 3,500-character paste shows a chip and sends.
- **3.3 Stop before the first word reads as a provider error and opens a browser panel (1)** — branch `fix/stop-before-first-word`.
  - Error: an aborted stream returns an empty result instead of throwing (`stream-text.ts:1177–1178`), so `generation.ts:1592` builds the empty-reply error without checking `stoppedDuringStream` (`:1442`). Fix: no empty-reply error when the turn was stopped. Screen readers already hear "Stopped before answering."; nothing visible is added.
  - Panel: every Stop calls `stopBrowserSession` (`generation-cancel.ts:51–54`), which always writes a `session:stop` status (`browser.ts:483–492`) even when Rust reports `not_running`, and any status shows the panel (`BrowserAgentPanel.tsx:24`). Fix: write the status only when something was stopped or the chat already has a browser status.
  - Noted, not fixed here: a Stop before the abort is registered (`stream-text.ts:786`) finds nothing to cancel and the answer streams anyway.
- **3.4 Error notice and Stop shown together (4)** — branch `fix/live-state-on-failure`.
  - Stop shows while a message is `generating`, the turn is in the live map or the cancel map (`$sessionId.tsx:69–93`).
  - Leaks: `messages.ts:215–216` marks the turn live but its catch (`:294–327`) never clears it (errors from `getModel`, model dependencies, the web-browsing check); `generation.ts:693–704` returns early without clearing it. The main catch and the empty-reply path do clear it.
  - Fix: clear the live mark on those paths; repro with 429 and drop to see whether anything else leaves a message `generating`.
- **3.5 Empty and dropped replies (5)** — branch `fix/empty-reply-copy`.
  - An empty reply gets the generic provider sentence (its specific text is behind Show details); a failed turn still shows a token count (`MessageActionRow.tsx:74`, `messageMeta.ts:21–29`); prefixes vary ("API Error: ", "Network Error: ", "Error from …"); a dropped stream is sorted as a provider error; the details say "Custom OpenAI" (`custom-openai.ts:29`, used at `abstract-ai-sdk.ts:470,478`) though the notice sentence already uses the custom name.
  - Fix: an `empty` error kind with "{model} sent no reply."; no token count when the message has an error; the custom provider's name in the details. Dropped-stream sorting is in 3.8. The mixed prefixes ("API Error: ", "Error from …") stay in Show details only and are not changed.
- **3.6 Chat offline message (18)** — branch `fix/chat-offline-notice`.
  - Quick Chat: `online` from `navigator.onLine` plus window events (`useQuickChat.ts:97,150–159`), `reachableOffline` (`quickChatState.ts:29–35`, host passes `isLocalHost`), notice and Retry in `QuickChatPanel.tsx:291–301`.
  - Fix: move the online listener into a `useOnline()` hook used by both; the composer shows the same notice next to `ModelReadinessNotice` and blocks the send while offline with a non-local model; Retry re-reads `navigator.onLine`.
- **3.7 Web Search copy for models without tool use (2)** — branch `fix/web-search-tools-copy`. Maintainer ruling 2026-11-01: keep Web Search on by default and fix only the copy.
  - The notice is error 20022, thrown only on web (`messages.ts:276–277`; desktop falls back to prompt-based search). Its key is missing from `en`, so English shows the raw key with "Supported models: gemini-2.0-flash(API), perplexity API" (`ModelErrorNotice.tsx:52`).
  - Fix: a new English key ("{{model}} can't search the web because tool use is off for it…" with the settings link), mapped from 20021/20022; drop the hardcoded list.
- **3.8 A stream silent for about 60 s fails with "Load failed" on desktop (26)** — branch `fix/desktop-idle-stream`.
  - Path: desktop sends non-local hosts through Rust (`request.ts:66`, `invoke('http:request')`, reqwest with no timeouts, whole body buffered) and local or LAN hosts through WKWebView fetch (`request.ts:102`). The fake provider is on 127.0.0.1, so the 60 s cut is WebKit's idle timeout; no JS timer exists. "Improve Network Compatibility" (`useProxy`) does nothing on desktop.
  - So the drop hits local providers (Ollama, LM Studio) with a first token or pause over 60 s, not cloud ones. Changing the local path (a streaming Rust request) is a **Ruling** and out of this branch.
  - Fix here: "Load failed", "Failed to fetch", "NetworkError" and "network connection was lost" are sorted as `network` (`classify.ts:109`), so the notice reads "Couldn't reach {{host}}." with Retry.

## Phase 4: Review and knowledge (scouted 2026-11-01)

- **4.1 "No model is set up" stays after a model works (14)** — branch `fix/no-model-item-clears`, after 1.2. Maintainer ruling 2026-11-01: the item closes by itself as soon as `hasUsableModel` turns true.
  - Cause: nothing re-runs the job when a model becomes usable. The entry closes only through `runJobFix` (pressing **Choose a model** again, `connect.ts` `choose-model` handler) or when a newer run supersedes it.
  - `hasUsableModel` (`sources/model-check.ts`) checks only that the provider is listed. Move it onto `getModelReadiness` with the set-up providers (`chatProvidersFromSettings`), keeping `backgroundModelChoice`'s order (the default, or the last-used model only when no default is set). Review, the fix handler and `pm-pilot/background-model.ts` share it.
  - In `registerSourceFixHandlers`, watch the settings and last-used model stores. When a model becomes ready, call `runJobFix` for every needs-you job whose fix is `choose-model` and whose handler would succeed without opening anything (a usable model, and a local one for a local-only source). The handler's own check becomes one shared function, so the watcher never opens Settings.
  - Closing works as the manual fix does: the entry closes as `done` and the job runs again.
- **4.2 A superseded failure shows as Done (29)** — branch `fix/superseded-not-done`. Maintainer ruling 2026-11-01: hide superseded entries from Done; only the newest failure shows.
  - Cause: `closeSupersededEntry` (`background/runner.ts`) calls `closeEntry`, which sets the row `done`, and Review lists every row that isn't `dismissed`.
  - Fix: the superseded path sets the row `dismissed`. A fix that succeeds still closes its entry as `done`.
- **4.3 A resolved conflict still says the old statement is saved (20)** — branch `fix/resolved-conflict-subline`.
  - Cause: `review-sync.ts` only flips a resolved conflict's row to `done`. The row keeps the open conflict's text (the new statement) and sub-line `Saved: "<old>"`.
  - Fix: when the conflict is resolved, rewrite the row from the outcome in the committed state:
    - Keep the new statement: the row reads the new statement with `Replaced: "<old>"`.
    - Keep a saved statement: the row reads the kept statement with no sub-line. The item made from the proposal is `superseded`, and its `supersededBy` names the winner.
    - Keep both: unchanged, since `Saved: "<old>"` is still true.
  - Undo reopens the conflict, and the existing reopen path restores the open text.
- **4.4 Keep this buttons squeezed (19)** — branch `fix/conflict-button-width`.
  - Cause: `.dango-conflict__statement` (`dango-foundations.css:189`) is a flex row, and its `.dg-btn` can shrink.
  - Fix: give the button `flex-shrink: 0; white-space: nowrap`. Give the text column `min-width: 0; overflow-wrap: anywhere`, so a long statement or source label wraps instead.
  - Check at 1440, 1024 and 390 px with a long statement and source.

## Phase 5: Copy, labels and accessibility (scouted 2026-11-02, done 2026-11-02)

What changed from the scout below, found while fixing:

- 5.1 Web Search: Mantine's `Menu.Item` always sets `role="menuitem"`, so the item can't become a `menuitemcheckbox` without working around Mantine. The Web Search and Dango Browser switches are named instead, as Agent Mode and Plan mode already are. The theme toggle keeps its untranslated dev-only tooltip text as its name.
- 5.1 First run: the Trust and Model step tests already find their radios by name, and Scope uses Mantine's labelled `SegmentedControl`; no change.
- 5.4 The Add footer was not pushed down by the list's `flex-[1_0_auto]` (that sets width in a row). The provider page is `h="100%"` of the settings scroller and sits under the 41 px Providers / Default models tabs, so its bottom 41 px fell below the window. The settings content is now a column and the provider page fills what is left.
- 5.4 Focus: the Add menu's popover returned focus to its Add button 10 ms after closing, after the new dialog had focused Name. It no longer returns focus when it closes into a dialog.
- 5.3 Files' "Export safe snapshot": production builds compile `export` off too. Maintainer ruling 2026-11-02: hide it the same way, so it shows only when `export` is `ready`.

- **5.1 Unnamed controls (3)** — branch `fix/control-names`.
  - Theme toggle: `components/dev/ThemeSwitchButton.tsx` is an icon-only `ActionIcon`; its Tooltip doesn't name it. It renders only in dev builds (`Sidebar.tsx:295`, behind `FORCE_ENABLE_DEV_PAGES`), which is what the monkey test ran. Add `aria-label` with the tooltip's text, translated.
  - Default models: the four `ModelSelector` triggers (`routes/settings/default-models.tsx`, `ModelSelectContent`, ~191) are named only by their value ("None", "Auto (Use Chat Model)"), so two can share a name. Name each "<setting>: <value>".
  - Answer version arrows: `MessageList.tsx` `ForkNav` (~446, ~479), two unnamed `ActionIcon`s. Name them "Previous version" and "Next version".
  - Modal close buttons: `theme/mantineTheme.ts` `Modal.extend` sets no `closeButtonProps`, and Mantine's `CloseButton` has no name. Add `closeButtonProps: { 'aria-label': i18n.t('Close') }`. First focus stays Mantine's (the first tabbable control); dialogs with a field set `data-autofocus` themselves (5.4 does it for Add provider).
  - Web Search in the + menu (`ComposerToolsMenu.tsx`, mobile ~394 and desktop ~709) is a `menuitem` holding an unnamed `Switch`, so its on/off state is only on the unnamed switch. Make the item `role="menuitemcheckbox"` with `aria-checked`, and hide the switch from assistive tech. Browser (~430) has the same pattern; Plan mode instead names its switch (`aria-label`, tested).
  - First run's radios: the code already names them by their labels (`TrustStep` native labels, `ScopeStep` Mantine `SegmentedControl` labels, `ModelStep` `role="radio"` buttons); the report's "project", "auto", "ask" were most likely the `value` attributes. Check the accessibility tree in the running app; no change unless it confirms.
- **5.2 Internal provider id in the status bar (10)** — branch `fix/status-bar-provider-name`. `SessionStatusBar.tsx` `formatModelTitle` (~64) labels the model with `providerId`, and the session route passes `model?.provider`. Add a `providerName` prop from the route's `useProviders()` list and use it for the label; usage lookups keep the id.
- **5.3 Quick Local Run, Source Control and Change Review show internals (23)** — branch `fix/hide-unavailable-workspace-tabs`. Maintainer ruling 2026-11-01: hide the tabs on builds where they cannot work.
  - The panel is `components/project/ProjectContextPanel.tsx` (tabs ~175). Production builds compile `scm`, `staging`, `apply` and `wasi` off (`src-tauri` `policy.rs` `NativeRollout::compiled()`), and the renderer can read that from `platform.getWorkspaceSuiteCapabilities()` (async, desktop only), which nothing calls yet.
  - On mount, read the capabilities once. Show Source Control only when `scm` is `ready`, Change Review only when `staging` is `ready`, and Quick Local Run only when `wasi` is `ready`. Until they load, or if the call fails, show Files only. With Files alone, show its content without a tab row.
  - Quick Local Run prints the Rust `detail` verbatim (`QuickRunPanel.tsx`). Once hidden, that text no longer reaches users.
  - Source Control's `FEATURE_DISABLED` is already a sentence since `ca687fee`.
  - The tabs already have `role="tab"` and `aria-selected` but no CSS, so they render as native buttons in both themes. Style `.project-explorer-tabs button` like `.dg-insp__tabs` (`dango-components.css:130`), with the selected tab from `aria-selected`.
  - Keep the strings `test/integration/project-workspace` checks (`getStagedChangeSetId`, `changeSetId={changeSetId}`).
- **5.4 Add provider dialog** — branch `fix/add-provider-dialog` (`components/settings/provider/AddProviderModal.tsx`).
  - The Name field has no label at all: "Name" is a separate `Text`. The same goes for API Mode. Use the inputs' `label` props.
  - Focus Name on open with `data-autofocus`, except on small screens, which blur on open on purpose (`blurActiveElement`).
  - Today "Name is required" shows at once, and Add stays disabled while Name is empty. Instead, keep Add enabled and show the error only after a save with an empty name. Enter in Name saves.
  - Provider list (`ProviderList.tsx`): the list `Stack` is `flex-[1_0_auto]`, so it can't shrink, and the footer with **Add** is pushed below the window on short windows. Confirm in the browser, then let the list shrink so its scroll area scrolls and the footer stays visible.

## Phase 6: Navigation and pickers

Scouted 2026-11-02; each cause below is confirmed in the code. Done 2026-11-02; 6.3 had a second cause, found in the web pass (see its progress row).

- **6.1 Editing the first question hides its old answer (8)** — branch `fix/first-question-fork`.
  - Cause: `editAndResend` (`stores/session/edit-resend.ts`) forks at the message before the edited one. A new chat starts with a system message (`sessionHelpers.ts:855`), so for the first question that is the system message. `MessageList.tsx:137` drops system messages, and `forksMovedTo` (`:146`) only moves forks off messages hidden by a Swarm fold (it returns early when nothing is folded), so the switcher is never drawn.
  - Fix: `forksMovedTo` walks the full list (system messages included) and moves the fork of any hidden message to the next shown one, Swarm folds and system messages alike. The ‹ › switcher then shows under the first question. Saved data and `edit-resend.ts` are unchanged.
  - Test: a `MessageList` test with a fork on the system message shows the switcher on the first question; the Swarm fold test still passes.
- **6.2 Closing Settings goes to the last chat (11)** — branch `fix/settings-close-returns`.
  - Cause: by design, `closeSettings` (`modals/Settings.tsx:23`) returns to the current session id or home; nothing records where Settings was opened from.
  - Fix: a router `onResolved` subscription remembers the last location outside `/settings` (its full href, so a scope's `?tab=knowledge` is kept). The close button and Escape return there. A remembered chat that has since been deleted, and cold entry with nothing remembered, keep today's fallback (`resolveSettingsExit`).
  - Test: `settings-navigation.test.ts` covers return to a scope tab, a deleted chat and cold entry.
- **6.3 `@Task` picks Deep Researcher (21)** — branch `fix/agent-picker-ranking`.
  - Cause: `filterAgents` (`InputBox/AgentPicker.tsx:27`) scores name and description as one string, so any substring match scores the same and the tie breaks alphabetically ("Deep Researcher" before "Task Planner").
  - Fix: score the name and the description separately; a name match ranks above a description match, and a name that starts with the query ranks first. The composer's Enter, the picker list and the new-chat agent bar all use `filterAgents`, so one change covers all three.
  - Test: `filterAgents` ranks Task Planner first for `Task`.

## Phase 7: Investigations (outline)

- **7.1 Fetch models lists nothing on web (7)**; desktop works. Trace the web fetch of `/v1/models`, likely a parsing or CORS difference. Fix on `fix/web-fetch-models` once found.
  - Investigated 2026-11-02 on web (`qa/monkey-all-fixes` at `16cf5d07`, fake provider): **not reproduced.** Fetch on an existing provider and on a new one with no models both request `/v1/models` (200) and open the Models dialog with `fake-model`; the host without `/v1`, with `/v1` and with `/v1/` all list it. The fake provider already sent CORS headers, so a blocked read is ruled out. The only difference seen: on a cold dev server the dialog opened more than 3 s after the click (module loading), against about 100 ms warm, so the original run may have looked before it opened.
  - Two weaker problems found on the way, neither the reported symptom:
    - `getMergeOptionGroups` (`model-setting-utils/base-config.ts:40`) turns any failed models request into an empty list, so a 404, a CORS block or a bad key reads as "Provider returned an empty model list", without the real reason.
    - With API path set (host `http://127.0.0.1:8789`, path `/v1/chat/completions`), chat uses `/v1/chat/completions` but Fetch asks `/models` (`custom-openai.ts:72` passes no path), which 404s.
  - No fix made: the finding does not reproduce, and the two problems above are separate changes that need the maintainer's go-ahead.
- **7.2 Background answers finish about 74 s late (28)**.
  - On the QA bundle, trace whether WebKit throttles the hidden window's timers or its stream reader.
  - Candidates: Tauri 2's `backgroundThrottling` window option, and moving stream reading off timer-driven code.
  - Write the findings into the report before any fix (**Ruling** if the fix changes power use).
  - **Result (2026-11-02, QA bundle built from `16cf5d07`, `qafix` profile, Fake B on `drip-400` behind a loopback proxy that logged each request's body hash, first byte, end and any client disconnect): not background throttling.** The late finish is Web Search's hidden first step.
    - With Web Search on (profile provider Bing) and a model without tool use, `searchByPromptEngineering` (`model-calls/tools.ts:41`, called from `stream-text.ts:951`) first runs a full `generateText` call asking for a search action, then the answer. The fake provider echoes the whole message to both, so each takes the stream's length. The proxy showed the first request (11.3 KB) streaming and ending cleanly after 69 s; the answer's request (10 KB) started the moment it ended, and Dango marked the answer done 14 ms after that second stream ended. Meanwhile the chat shows only "Thinking…".
    - It happens with Dango in front: in front the whole time (sampled every 5 s), a 2,700-character run read first token 70.3 s and done 138.5 s, the same shape as the report's "2 m 28 s".
    - With Web Search off (provider set to Tavily with no key), the default policy shows no lag: in front, first token 1.08 s and done 69.3 s; behind Finder the whole time, 1.05 s and 69.2 s, done 12 ms after the stream ended; hidden with ⌘H the whole time, 1.03 s and 69.2 s. The planned run with `backgroundThrottling: disabled` was not needed.
    - So there is no power-use change to rule on. What the test exposes: for a model without tool use, every send with Web Search on waits for a whole hidden model call before the first visible word, with nothing on screen saying so. With a real model that call answers with a short search action, so the wait is one round trip rather than a doubled answer; how long it is with a real model was not measured. Changing it is a product decision, not part of this plan.
    - Test hazard noted: on desktop, which has no outside-host guard, a model that answers that first call with a search action would make Dango query Bing. The fake's echo never does, but a QA profile is safer with Web Search unconfigured.
  - Code reading before the test (kept for the record):
    - The stream loop (`abstract-ai-sdk.ts:647`) reads the network stream and never waits on a timer: screen updates go through `requestAnimationFrame` (`:613`), which does not fire in a background window, and the final flush emits without it. `generation.ts:857` coalesces UI writes with a 32 ms `setTimeout`, but the stream loop does not wait for those writes either. No `smoothStream` or other per-chunk delay is in the path.
    - So the lag is most likely WebKit throttling the whole background web view (its task delivery, not one timer). Tauri 2.8's window option `backgroundThrottling` (`disabled`, `throttle`, `suspend`; macOS 14+) controls exactly that, and `tauri.conf.json` sets none.
    - Planned test on the QA bundle (`qafix` profile, Fake B on `drip-400`): one run in front and one behind Finder with the default policy, then the same with `"backgroundThrottling": "disabled"` passed through `--config`, comparing the answers' stored `durationMs`. A fix that sets the policy changes background power use, so it waits for the maintainer's ruling.

- **7.3 Web Search with a model that cannot use tools (from 7.2)** — branch `fix/no-search-without-tools`. Maintainer ruling 2026-11-02: send without searching, on every platform, and say so in the composer; this narrows 3.7 (Web Search stays on for models that use tools).
  - Today web refuses the send (`messages.ts:276`, finding 2), while desktop and mobile run a hidden prompt-engineered search step first (`stream-text.ts:565`, `:943`): a whole extra model call before the first word, whose query the model writes from the conversation.
  - `streamText`: Web Search applies only when the model uses tools (`isSupportToolUse('web-browsing')`); otherwise the turn sends with no search. Drop the web and combined prompt-engineering paths (`searchByPromptEngineering`, `combinedSearchByPromptEngineering` and their prompts); the knowledge-base fallback (`knowledgeBaseSearchByPromptEngineering`) stays.
  - `submitNewUserMessage`: no refusal on web. The saved-error copy for `model_not_support_web_browsing_2` stays so old chats still read.
  - Composer: the + menu's Web Search switch shows off and disabled for such a model, with "This model can't search the web", using the composer's existing tool-use check (`InputBox.tsx:708`).
  - Tests: `streamText` with Web Search on and a model without tool use makes one model call and offers no search; with tool use it still offers `web_search`; the switch is disabled with the reason; the web send goes through.

## Rulings

Given 2026-11-01: 1.3 Quick Chat shows the model's name (reopen behaviour unchanged); 0.1 commit the fake provider on its own branch; 2.4 both the macOS pointer and a test notification button; 3.7 keep Web Search on, fix only the copy; 4.1 the "no model" item closes by itself; 4.2 superseded failures are hidden from Done; 5.3 hide the unavailable workspace tabs; 2.2 desktop minimum width 400 px.

Given 2026-11-02: 5.3 hide Export safe snapshot too when the build compiles export off; 7.3 a model that cannot use tools sends without Web Search on every platform and the composer says so (narrows 3.7).

Still needed, each after its scout or repro:

1. 3.8 Whether local-host streams on desktop move to a streaming Rust request (WebKit cuts a fetch silent for 60 s); cloud providers already go through Rust.
2. ~~7.2 Any fix that changes background power use.~~ Not needed: the 2026-11-02 desktop test found no background throttling lag (see 7.2).

## Backlog

The Backlog.md CLI (`backlog`) is not installed on this machine, so these phases are not on the board. Once it is, add one card per phase in Ideas with `backlog task create`, linking this plan.

## Red team review

Two adversarial reviews (assumptions and failure modes; security and scope) read the plan against the code on 2026-11-01. Each finding below was checked at its cited lines and accepted:

| Finding | Change made |
|---|---|
| Filling a model in `mergeDefaultSessionSettings` makes the send guard unreachable, and raw-settings readers (chat page, naming, compaction, Redo, Quick Chat) disagree with generation | Choose the model once at creation and save it (1.1a.2–3); keep only non-model defaults |
| `isProviderListedInSettings` counts ComfyUI, OpenClaw and any custom provider as usable | One check: `getModelReadiness` `ready`, image-only excluded (1.1a.1) |
| `createSession` re-spreads the last-used model; legacy ChatboxAI remap, picture default and Image Creator still use OpenAI | Added to 1.1a (steps 2, 3, 5) |
| A guard in `generation.ts` misses naming, compaction, memory, contradictions, summaries and review | The guard sits in `getModel`, with a typed error (1.1b.3) |
| The composer gate already exists but is mobile-only; Redo and edit-and-resend pass with no model | Widen the existing gate; `requestBeforeSend` refuses (1.1b.1–2) |
| Falling back to the last-used model for background work would switch models silently | Background order unchanged (Goal, 4.1) |
| `ensureDefaultChatModel` would pick an arbitrary or image provider, and its hook point does not exist | Exactly one usable provider, main-window settings subscription, cut from 1.1a (1.2) |
| `qafirst` profile holds a real MiMo key; the QA bundle shares the real app's rename step, keychain service and hotkey | Phase 0.2: new identifier, fake providers only, quit the real Dango |
| `fake-provider.mjs` is not on `main` and is modified, so `main`-based branches cannot run the repros | Phase 0.1 |
| More tasks overlap on `InputBox.tsx` and `generation.ts` than the plan said | Merge order in the ground rules |
| The window-label check in 2.1 had nothing to compare (payload is a path) | `emit_to` the quick label at both lines plus a label guard (2.1) |
