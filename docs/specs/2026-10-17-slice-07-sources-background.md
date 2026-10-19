---
type: plan
status: draft
description: "Slice 7 of the redesign: Settings › Sources, the add-source sheet (SR1–SR2), first sync and background review as background jobs with retries (SR3), Stop, and revoking a source"
generated: { by: claude/opus-5.5, at: 2026-10-17T19:00:00+07:00 }
---
# Slice 7: Sources and Background Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user can connect a folder, Gmail, Asana, Codex threads or Documents to one scope from Settings › Sources or a scope page, watch its first sync run as background work on the scope page with Stop, get a Done or Needs you entry in Review, opt each source into background review that proposes knowledge, and remove a source without losing approved knowledge.

**Architecture:** Two renderer packages. `packages/sources/` holds the connected-source records, a registry of source kinds (pick, attach, sync, read, revoke) and the background-review extractor; `packages/background/` holds a persisted job store and a runner that executes registered job handlers with `RETRY_DELAYS_MS` backoff and hands failures to Review as Needs you entries whose action is the fix. Picking and connecting are two calls (`pickSource` → `SourceDraft`, then `connectSource(draft, { scopeId, backgroundReview })`), so the sheet follows flow 6's order and first run (slice 9) can pick before its scope exists. Native work is two narrow additions in `src-tauri/src/workspace/`: draft folder bindings that a scope adopts, and a `codex:threads` broker.

**Tech Stack:** React 18, Zustand 5, Zod 4, TanStack Router, NiceModal, Vitest 4 (+ jsdom, Testing Library), Rust (Tauri 2), Biome.

**Spec:** `docs/specs/2026-10-16-ux-flows.md` (flow 6 Connect a source, flow 9 Background work, flow 15 errors, flow 16 undo, "Gaps closed on 2026-10-17"), `docs/specs/2026-10-17-redesign-roadmap.md` (Shared types, Contract register, Decisions), `docs/adr/0001`, `0002`, `0003`, `design/dango/README.md`.

## Global Constraints

- Names from the roadmap's Contract register are used exactly. This slice owns the slice-7 row: `registerSourceKind`, `registerSourceAdapter(kind, adapter)`, `listSourceKinds()`, `ConnectedSource` (with `connectedAt`, `localOnly?`), `openAddSourceSheet({ scopeId? })`, `SourceKindPicker`, `pickSource()`, `connectSource(draft, { scopeId, backgroundReview })`, `getBackgroundJob`, `useBackgroundJob`, `stopJob`, `runJobFix(id)`, and the `BackgroundJob` fields `sourceId?`, `progress?`, `outcome?`, `fix?`, `stoppedAt?` (a stopped job is `failed` with `stoppedAt`).
- Needs (import them; do not re-create): 1b `Sheet`, `pushUndo`, `useUndoHotkey`, `addReviewEntry`, `setReviewEntryState`, `registerReviewOpener`, `src/shared/types/background.ts`; 2 routes `/settings/sources` and the `backgroundPaused` setting (until slice 2 lands, read it as `false`); 3 `useScopes()`, `parseScopes`, `ScopeOverview.tsx`, `ScopeSourcesTab`, route `/scope/$scopeId`; 4 `proposeKnowledge(input: Omit<KnowledgeProposal, 'id' | 'createdAt'>)`, `markSourceRemoved(sourceId)`, `KnowledgeSource.sourceId?`.
- Background review switch: off by default, label "Background review", line under it verbatim: "Lets Dango read this source on a schedule to propose knowledge. Reading never makes anything authoritative." Review runs every 6 h (`REVIEW_INTERVAL_MS`, roadmap Decisions).
- Retry: a failed run is retried after 10 s, 1 min, 5 min (four runs in all). After the fourth failure the job becomes `needs-you`, one Needs you entry is added, and nothing retries until its fix runs. Errors retrying cannot fix (expired sign-in, missing folder, no model) skip the retries and go straight to Needs you (roadmap Decisions). Entry text `"{job label} stopped: {reason}"` (spec: "Gmail sync stopped: sign in again"); `actionLabel` is the fix label; no retry count is shown anywhere.
- Fix labels: `reconnect` → "Sign in again", `relink-folder` → "Find the folder", `choose-model` → "Choose a model", `try-again` → "Try again".
- `backgroundPaused: true`: no run starts (first syncs, retries, scheduled syncs and reviews wait); a run already in progress finishes; turning it off resumes waiting jobs at once.
- Revoking a source keeps approved knowledge and calls `markSourceRemoved(sourceId)`. It never deletes an Integrations account the user already had or the Documents collection; it unbinds a folder.
- Cancel at any step of the sheet leaves nothing connected: no source record, no new integration account, no folder binding, no job.
- Connect, Stop and Remove call `pushUndo({ message, undo, group: 'other' })` (5 s toast plus ⌘Z).
- Copy: sentence case, buttons name the action, no emoji, no exclamation marks. Colours, spacing and radii only from `--dango-*` and `dg-*` (`dg-switch`, `dg-btn`, `dg-btn--primary`, `dg-btn--ghost`, `dg-menu`, `dg-insp__row`); sheets are 1b's `Sheet`, with notes in its `hint` prop.
- Jobs run only in the main window (`platform.getWindowLabel?.()` !== `'quick'`). Closing the window with Keep in tray on (the default) keeps them running; quitting pauses them; launch resumes them.
- Storage: new keys `sources`, `background-jobs`, `source-cursor:{id}`, all immediate writes, IndexedDB on desktop (not `needStoreInFile`), no migration (no prior data). Corrupt rows are dropped one by one, never the whole list.
- Renderer paths are never trusted for folders: binding stays native-picker-only (`docs/project-workspaces.md`); a folder dropped on a scope opens the picker.
- Out of this slice: Gmail and Asana read/sync adapters and the PM pipeline (slice 10); the first-run steps (slice 9, built on `pickSource`/`connectSource`); the scope page shell, tabs and Files tab FS1 (slice 3); Change items from folder edits (flow 11); notifications (slice 8); Swarm and plan jobs (slice 6); Documents retrieval in chat (slices 4, 6); a local-only switch in the UI (the field exists; slice 10 sets it).

## Review Focus

1. Closing the sheet while the browser sign-in or folder picker is open, or on the scope step after picking, must leave nothing behind: a late OAuth callback creates no account, a picked folder's draft binding is removed (Task 5 `aborting pick…`, `discard removes…`; Task 7 `cancel after pick…`).
2. Quitting during a 5 min retry wait must resume at the stored `nextRetryAt` after launch, not restart the count or run at once (Task 2 `resumes a waiting retry…`).
3. Removing a source while its sync is running or waiting to retry must stop it for good: no later Done or Needs you entry (Task 3 `revoke stops the source's jobs…`).
4. A background-review answer that is not JSON, or cites an item the batch did not contain, must create no proposal, and a failed run must not advance the read cursor (Task 6 tests).
5. Pressing Sync now twice, or the review timer firing while a sync runs, must not start a second job for the same source and kind; and nothing starts while `backgroundPaused` (Task 2 `one job per source and kind`, `paused…`).

---

### Task 1: Extend the shared types and add storage keys

**Files:**
- Modify: `src/shared/types/background.ts` and `src/shared/types/background.test.ts` (created by 1b: append, do not change the two roadmap lines)
- Create: `src/shared/types/sources.ts`
- Modify: `src/renderer/storage/StoreStorage.ts` (enum after 1b's `ReviewEntries`; `StorageKeyGenerator` at `:43-71`; `immediateKeys` at `:74-83`)

**Interfaces:**
- Produces, `background.ts`: `BackgroundJob` gains `sourceId?: string; progress?: string; outcome?: string; fix?: JobFix; stoppedAt?: number`; `type JobFixAction = 'reconnect' | 'relink-folder' | 'choose-model' | 'try-again'`; `type JobFix = { action: JobFixAction; label: string }`; `JOB_FIX_LABELS: Record<JobFixAction, string>`; `retryDelayAfter(failedRuns: number): number | null`; `JOB_HISTORY_PER_SCOPE = 50`; `REVIEW_INTERVAL_MS = 6 * 60 * 60 * 1000`; `BackgroundJobSchema` (Zod, for storage).
- Produces, `sources.ts`: `SOURCE_KINDS = ['folder', 'gmail', 'asana', 'codex-threads', 'documents'] as const`; `type SourceKind`; `ConnectedSourceSchema = z.object({ id, kind: z.enum(SOURCE_KINDS), scopeId, label, backgroundReview: z.boolean().default(false), localOnly: z.boolean().default(false), config: z.record(z.string(), z.unknown()).default({}), connectedAt: z.number(), lastSyncAt: z.number().optional(), lastReviewAt: z.number().optional() })`; `type ConnectedSource`; `parseSources(raw: unknown): ConnectedSource[]` (drops invalid rows one by one); `type SourceDraft = { kind: SourceKind; label: string; ref?: string; config: Record<string, unknown>; draftBindingId?: string; createdAccountId?: string }` (`ref`: folder = display path, documents = collection name, gmail/asana = account address or name); `type SourceItem = { ref: string; label: string; text: string; updatedAt?: number }`; `KNOWLEDGE_SOURCE_KIND: Record<SourceKind, KnowledgeSource['kind']>` = folder `file`, gmail `email`, asana `task`, codex-threads `chat`, documents `file`; `type CodexThreadsDetection = { found: boolean; threadCount: number; displayPath: string }`; `type CodexThreadSummary = { id: string; title: string; updatedAt: number }`; `type CodexThread = CodexThreadSummary & { text: string; truncated: boolean }`.
- Produces, storage: `StorageKey.Sources = 'sources'`, `StorageKey.BackgroundJobs = 'background-jobs'` (both in `immediateKeys`), `StorageKeyGenerator.sourceCursor(id) => \`source-cursor:${id}\``.

- [ ] **Step 1: Write the failing tests** (append to `background.test.ts`): `retryDelayAfter(1) === 10_000`, `(2) === 60_000`, `(3) === 300_000`, `(4) === null`, `(0) === null`; the four `JOB_FIX_LABELS`; `parseSources([valid, { id: 'x' }, valid2])` returns two rows; a row without `backgroundReview`/`localOnly` parses with `false`; `parseSources('nope')` returns `[]`.
- [ ] **Step 2: Run** `pnpm test -- src/shared/types/background.test.ts`. Expected: FAIL on the new cases only.
- [ ] **Step 3: Implement** the additions, `sources.ts` and the storage keys.
- [ ] **Step 4: Run** the test and `pnpm check`. Expected: PASS, no new type errors.
- [ ] **Step 5: Commit**: `feat(sources): add source types and background job fields`.

### Task 2: Job store and runner with retries

**Files:**
- Create: `src/renderer/packages/background/jobs-store.ts`, `runner.ts`, `errors.ts`, `index.ts`, `runner.test.ts`

**Interfaces:**
- Consumes: Task 1; `addReviewEntry`, `setReviewEntryState`, `registerReviewOpener`, `setLastCheckedAt` (`@/packages/review`); `settingsStore` (`backgroundPaused`, `?? false`); `router` (`@/router`) for opening a scope.
- Produces:
  - `class NeedsUserError extends Error { constructor(reason: string, readonly fix: JobFix) }` (`reason` is the lower-case clause after "stopped:", e.g. `'sign in again'`).
  - `type JobContext = { job: BackgroundJob; signal: AbortSignal; progress(text: string): void }`; `type JobOutcome = { summary: string; addDoneEntry: boolean }`; `type JobHandler = (ctx: JobContext) => Promise<JobOutcome>`.
  - `registerJobHandler(kind: BackgroundJob['kind'], handler: JobHandler): void`; `registerFixHandler(action: JobFixAction, run: (job: BackgroundJob) => Promise<boolean>): void` (false = user cancelled).
  - `startJob(input: { scopeId: string; kind: BackgroundJob['kind']; label: string; sourceId?: string; sourceLabel?: string }): BackgroundJob` — returns the existing job when one with the same `sourceId` and `kind` is `running`.
  - `stopJob(id: string): Promise<void>`; `runJobFix(id: string): Promise<void>`; `resumeJobs(now?: number): Promise<void>`; `getBackgroundJob(id: string): BackgroundJob | undefined`; `useBackgroundJob(id: string): BackgroundJob | undefined`; `listJobs(filter?: { scopeId?: string; sourceId?: string }): BackgroundJob[]` (newest first); `useBackgroundJobs(scopeId?: string): BackgroundJob[]`; `registerJobReviewOpener(): () => void`.

Rules: a `needs-you` job stores its reason in `error`; every surface shows it as `"{label} stopped: {error}"`. A run throwing `NeedsUserError` → `needs-you` with that fix; any other error → `attempts += 1`, `nextRetryAt = now + retryDelayAfter(attempts)`, status stays `running`; when `retryDelayAfter` is `null` → `needs-you`, fix `try-again`, reason = the error's message. Success → `done`, `outcome = summary`, a `done` entry when `addDoneEntry`, and, for `sync` and `review` jobs only, `setLastCheckedAt(Date.now())` (never on failure, needs-you or stop). Entries: `addReviewEntry({ kind, scopeId, source: sourceLabel, text, actionLabel: fix?.label, ref: { type: 'job', id: job.id } })`. `stopJob` aborts, sets `status: 'failed'`, `stoppedAt`, clears `nextRetryAt`, adds no entry; an abort never counts as a failure. `runJobFix` runs the fix handler; when it returns true, `setReviewEntryState({ ref: { type: 'job', id } }, 'done')` and the same job runs again with `attempts: 0`. `registerJobReviewOpener` registers the `'job'` opener: a `needs-you` entry → `runJobFix(ref.id)`; a `done` entry → navigate to `/scope/$scopeId`. No renderer is registered: slice 5's default renderer already shows `actionLabel` and calls the opener, and a renderer keyed by kind would also catch slice 10's `needs-you` questions. While `backgroundPaused` is true, a run that is due waits; a `settingsStore` subscription calls `resumeJobs()` when it turns false. Persist on every status change; `progress` stays in memory. Keep at most `JOB_HISTORY_PER_SCOPE` finished jobs per scope.

- [ ] **Step 1: Write the failing tests** in `runner.test.ts` (fake timers, `vi.mock('@/packages/review')`, in-memory storage stub):
  - `a failing handler runs four times, then one needs-you entry`: handler always throws `new Error('Gmail did not answer')`; advance 10 s, 60 s, 300 s; handler called 4 times; job `status === 'needs-you'`, `fix.label === 'Try again'`; `addReviewEntry` called once with `kind: 'needs-you'`, `text: 'Gmail sync stopped: Gmail did not answer'`, `actionLabel: 'Try again'`, `ref: { type: 'job', id }`; advancing another hour calls the handler no more.
  - `NeedsUserError skips the retries`: throws `new NeedsUserError('sign in again', { action: 'reconnect', label: 'Sign in again' })`; one call; entry text `'Gmail sync stopped: sign in again'`, `actionLabel: 'Sign in again'`.
  - `success adds one done entry with the summary`; `addDoneEntry: false` adds none.
  - `a finished sync or review sets last checked`: `setLastCheckedAt` called once with the fake now after a `sync` and after a `review` finish as done; not called after a failure, a needs-you, a stop, or a done `swarm` job.
  - `one job per source and kind`: two `startJob` calls with the same `sourceId`/`kind` while running return the same id and call the handler once (Review Focus 5).
  - `paused: nothing starts until unpaused`: with `backgroundPaused: true`, `startJob` and a due retry do not call the handler; setting it false runs both (Review Focus 5).
  - `stop aborts and adds nothing`: `stopJob` during a run → `status 'failed'`, `stoppedAt` set, no entry, no retry after 10 s.
  - `resumes a waiting retry at its time`: persisted job `{ status: 'running', attempts: 2, nextRetryAt: now + 120_000 }`; `resumeJobs(now)`; handler not called at 119 s, called at 120 s; `attempts` still 2 before that run (Review Focus 2).
  - `resumes an interrupted run at once` (status `running`, no `nextRetryAt`).
  - `runJobFix closes the entry and re-runs with attempts reset`; a fix handler returning false leaves the job `needs-you` and the entry open.
  - `the job opener runs the fix for needs-you and opens the scope for done`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/background/runner.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the store (Zustand, `StorageKey.BackgroundJobs` through `BackgroundJobSchema`, invalid rows dropped) and the runner.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(background): run jobs with retries and hand failures to Review`.

### Task 3: Sources store, kind registry and revoke

**Files:**
- Create: `src/renderer/packages/sources/store.ts`, `src/renderer/packages/sources/kinds.ts`, `src/renderer/packages/sources/store.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 (`listJobs`, `stopJob`); `markSourceRemoved` (`@/packages/knowledge`); `EVERYWHERE_SCOPE_ID`.
- Produces, `kinds.ts` (types and registry; the kinds come in Task 5):
  - `type SourceAdapter = { pollMs?: number; sync?(source: ConnectedSource, ctx: { signal: AbortSignal; progress(text: string): void }): Promise<{ summary: string }>; read?(source: ConnectedSource, ctx: { signal: AbortSignal; cursor: string | null }): Promise<{ items: SourceItem[]; cursor: string | null }> }`
  - `type SourceChoice = { accountId?: string; kbId?: number }`
  - `type SourceKindDefinition = SourceAdapter & { kind: SourceKind; name: string; hint: string; supportsBackgroundReview: boolean; isAvailable(): boolean; unavailableHint?: string; pick(ctx: { signal: AbortSignal; choice?: SourceChoice }): Promise<SourceDraft | null>; attach?(draft: SourceDraft, scopeId: string): Promise<Record<string, unknown>>; discard?(draft: SourceDraft): Promise<void>; reconnect?(source: ConnectedSource): Promise<boolean>; revoke?(source: ConnectedSource): Promise<void> }`
  - `registerSourceKind(def)`, `getSourceKind(kind)`, `listSourceKinds(): SourceKindDefinition[]` (order: Folder, Gmail, Asana, Codex threads, Documents), `registerSourceAdapter(kind: SourceKind, adapter: SourceAdapter): void` (merges into the registered kind; slice 10 uses it for Gmail and Asana).
- Produces, `store.ts`: `listSources(filter?: { scopeId?: string; kind?: SourceKind }): ConnectedSource[]`; `useSources(filter?)`; `getSource(id)`; `addSource(input: Omit<ConnectedSource, 'id' | 'connectedAt'>): Promise<ConnectedSource>`; `updateSource(id: string, patch: Partial<Omit<ConnectedSource, 'id' | 'kind' | 'connectedAt'>>): Promise<void>`; `revokeSource(id: string): Promise<void>`; `adoptExistingFolderBindings(scopeIds: string[]): Promise<number>`; `class SourceRuleError extends Error { code: 'folder-everywhere' | 'folder-taken' | 'documents-taken'; scopeId?: string }`.

`addSource` rejects with `SourceRuleError`: a folder on `EVERYWHERE_SCOPE_ID` (`folder-everywhere`, copy "Folders belong to a project or client."); a second folder on one scope (`folder-taken`, "This scope already has a folder."); a Documents collection (`config.kbId`) already attached to another scope (`documents-taken` with that `scopeId`, "These documents already belong to {scope name}."). `revokeSource` order: stop the source's running jobs, `kind.revoke?.(source)`, `markSourceRemoved(id)`, delete the record and `sourceCursor(id)`. `adoptExistingFolderBindings` calls `platform.restoreProjectBinding?.(scopeId)` for scopes with no folder source and adds one (label = last segment of `displayPath`, `backgroundReview: false`, no job) unless the call throws or returns status `chat-only` or `unsupported`.

- [ ] **Step 1: Write the failing tests** (mock `@/platform`, `@/packages/knowledge`, `@/packages/background`):
  - `adds, lists by scope and by kind, and survives a reload`.
  - the three `SourceRuleError` codes.
  - `revoke stops the source's jobs, marks knowledge and deletes the record`: call order `stopJob` → `revoke` → `markSourceRemoved('s1')`; afterwards `getSource('s1')` is undefined (Review Focus 3).
  - `revoke never deletes the integration account`: `integrationsStore.removeAccount` not called.
  - `registerSourceAdapter adds sync to a registered kind`; `listSourceKinds keeps the fixed order whatever the registration order`.
  - `adopts an existing folder binding without a job`; `skips chat-only and thrown bindings`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/sources/store.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `kinds.ts` and `store.ts` (Zustand, `StorageKey.Sources`, rows through `parseSources`).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(sources): store connected sources and revoke them safely`.

### Task 4: Native pieces: draft folder bindings and Codex threads

**Files:**
- Modify: `src-tauri/src/workspace/authority.rs` (beside `bind_picker_result` `:270-310` and `unbind` `:408-417`), `src-tauri/src/workspace/mod.rs:3-21` (`mod codex_threads;`), `:75-84` (allow `codex:threads`), `:88-406` (dispatch), `src-tauri/src/workspace/tests.rs`
- Create: `src-tauri/src/workspace/codex_threads.rs`
- Modify: `src/renderer/platform/interfaces.ts:115-175`, `src/renderer/platform/desktop_platform.ts:521-523`, `src/renderer/platform/capabilities.ts:9-28,45-62`, `src/renderer/platform/capabilities.test.ts`

**Interfaces:**
- Rust, `authority.rs`: `pub fn adopt_draft_binding(&self, draft_id: &str, project_id: &str, window_label: &str) -> Result<Value, WorkspaceError>` — main window only; `draft_id` must start with `draft:`, `project_id` must not and must be non-empty; the draft binding must exist and `project_id` must have none ("This scope already has a folder."); re-keys the binding to `project_id` with a fresh checksum, revokes the draft's capabilities, persists, returns `restore(project_id)`'s descriptor. `pub fn discard_draft_bindings(&self, window_label: &str) -> Result<usize, WorkspaceError>` removes every `draft:` binding. Channels `workspace:adopt-draft-binding` (`draftId`, `projectId`) and `workspace:discard-draft-bindings`. Picking still goes through `workspace:pick-and-bind` with the draft id: no renderer path is ever accepted.
- Rust, `codex_threads.rs`: `pub fn sessions_root() -> Option<PathBuf>` (`$CODEX_HOME/sessions`, else `~/.codex/sessions`); `pub fn detect(root: &Path) -> Value` → `{ found, threadCount, displayPath }` (`displayPath` uses `~`, never the full home path; counts `rollout-*.jsonl`, reads no contents); `pub fn list(root: &Path, after: Option<After>, limit: usize) -> Vec<Value>` → `{ id, title, updatedAt }` oldest first, strictly after the `(sinceMs, sinceId)` cursor so tied timestamps page without gaps or repeats, `id` = path relative to root with `/` (changed while building: a newest-first list capped at 200 never reached older threads); `pub fn read(root: &Path, id: &str, max_chars: usize) -> Result<Value, String>` → `{ id, title, updatedAt, text, truncated }`. Channel `codex:threads`, `args[0]` = `{ op: 'detect' } | { op: 'list', sinceMs?, sinceId?, limit? } | { op: 'read', id }`; `limit` default 200, `max_chars` 20,000. Thread text: one line per message, `user: …` / `assistant: …`, from JSONL lines whose `payload.type` (or top-level `type`) is `message` with role `user` or `assistant`, joining content items that carry `text`; skip texts starting with `<environment_context>` or `<user_instructions>`. Title = first kept user text, first 80 characters.
- Platform: `adoptDraftFolderBinding?(draftId: string, scopeId: string): Promise<WorkspaceDescriptor>`, `discardDraftFolderBindings?(): Promise<number>`, `detectCodexThreads?(): Promise<CodexThreadsDetection>`, `listCodexThreads?(opts?: { sinceMs?: number; sinceId?: string; limit?: number }): Promise<CodexThreadSummary[]>`, `readCodexThread?(id: string): Promise<CodexThread>`; capability `supportsCodexThreads` (= `isDesktopRuntime`).

- [ ] **Step 1: Write the failing tests.** In `tests.rs` (fixture folder as in its `:15` helper, bound with `__testBindProjectFolder`'s Rust path): `adopt_moves_a_draft_binding_to_the_scope`, `adopt_rejects_non_draft_ids_and_taken_scopes`, `discard_removes_only_draft_bindings`. In `codex_threads.rs` `#[cfg(test)]` with a `std::env::temp_dir()` fixture `2026/10/01/rollout-a.jsonl` (a `session_meta` line, an `<environment_context>` user line, a user line, an assistant line): `detect_counts_without_reading`, `list_titles_from_first_real_user_message`, `read_formats_roles_and_truncates`, `read_rejects_parent_and_absolute_ids` (`../x.jsonl`, `/etc/passwd`, `a.txt` → `Err`), `read_rejects_symlink_escaping_root` (unix only). Add `supportsCodexThreads` expectations to the three cases in `capabilities.test.ts`.
- [ ] **Step 2: Run** `cargo test --manifest-path src-tauri/Cargo.toml --lib workspace::` and `pnpm test -- src/renderer/platform/capabilities.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the two Rust pieces, the channels and the platform methods.
- [ ] **Step 4: Run** both commands and `cargo check --manifest-path src-tauri/Cargo.toml`. Expected: PASS. (Without GTK, report the Rust run as not executed and run it on macOS.)
- [ ] **Step 5: Commit**: `feat(workspace): draft folder bindings and a Codex threads broker`.

### Task 5: Built-in kinds, pickSource and connectSource

**Files:**
- Create: `src/renderer/packages/sources/kinds/folder.ts`, `kinds/documents.ts`, `kinds/oauth.ts`, `kinds/codex-threads.ts`, `connect.ts`, `index.ts`, `connect.test.ts`, `kinds/codex-threads.test.ts`

**Interfaces:**
- Consumes: Tasks 2–4; `startConnectorOAuth`, `completeConnectorOAuth` (`@/packages/integrations`); `integrationsStore` (`removeAccount`); `waitForLocalOAuthCallback`, `canUseLocalOAuthCallback` (`@/utils/oauth-local-callback`); `getConnector` (`@shared/integrations`); `platform.pickAndBindProject`, `unbindProject`, `relinkProject`, `restoreProjectBinding`, `listWorkspaceChildren`, `readWorkspaceFile`, `getKnowledgeBaseController()`; `platformCapabilities`.
- Produces:
  - `pickSource(kind: SourceKind, opts?: { signal?: AbortSignal; choice?: SourceChoice }): Promise<SourceDraft | null>` — runs the picker or sign-in, connects nothing; `null` when cancelled.
  - `connectSource(draft: SourceDraft, opts: { scopeId: string; backgroundReview: boolean }): Promise<{ sourceId: string; jobId?: string }>` — `attach`, then `addSource`, then, when the kind has `sync`, `startJob({ kind: 'sync', label: \`${name} sync\`, scopeId, sourceId, sourceLabel: label })`. On a `SourceRuleError` it calls `discardSourceDraft(draft)` and rethrows.
  - `discardSourceDraft(draft: SourceDraft): Promise<void>` — the kind's `discard`.
  - `registerSourceFixHandlers(): void` — `reconnect` → the source's kind `reconnect`, `relink-folder` → folder `reconnect`, `try-again` → `true`, `choose-model` → navigate to `/settings/provider` and return `true`.
  - `useCodexDetection(): CodexThreadsDetection | null`.
  - `MCP_SOURCE_OPTION = { name: 'MCP server', badge: 'Advanced', hint: 'Tools and data from an MCP server. Set up in Advanced.', to: '/settings/mcp' }`.
  - `index.ts` registers the five kinds on import and re-exports the package.

| kind | name | hint | review | pick / attach | available |
|---|---|---|---|---|---|
| folder | Folder | A folder on this computer. Dango reads the files in it. | yes | pick: `pickAndBindProject('draft:' + uuid)`, `null` → cancelled; label = last path segment, `ref` = display path. attach: `adoptDraftFolderBinding(draftBindingId, scopeId)` → `{ displayPath }`. discard: `unbindProject(draftBindingId)` | `supportsProjectWorkspace` |
| gmail | Gmail | Your mail. Opens Google sign-in in your browser. | yes | OAuth below, connector `google_workspace`, scopes `scopePacks.mail`, config `{ scopePack: 'mail' }` | `canUseLocalOAuthCallback()` |
| asana | Asana | Tasks and comments. Opens Asana sign-in in your browser. | yes | OAuth below, connector `asana` | same |
| codex-threads | Codex threads | found: `Found {threadCount} threads in {displayPath}. Dango reads them only after you connect.`; not found: `No Codex threads on this computer.` (row disabled) | yes | pick resolves a draft with label "Codex threads" without reading anything | `supportsCodexThreads` |
| documents | Documents | Files Dango searches when answering. Never treated as approved knowledge. | no | pick needs `choice.kbId`; label and `ref` = collection name, config `{ kbId }` | `supportsKnowledgeBase` |

Unavailable hint for all: "Needs the desktop app." OAuth (`kinds/oauth.ts`): `choice.accountId` of an active account for that connector → reuse it, no browser. Otherwise `startConnectorOAuth` → `waitForLocalOAuthCallback({ port: <port of connector.oauth.redirectUri>, signal })` → if `signal.aborted`, return `null` without calling `completeConnectorOAuth` → else `completeConnectorOAuth({ session, redirectOrCode: redirectUrl, config })`; draft label = account hint or connector name, config `{ accountId }`, `createdAccountId` set. Discard removes only `createdAccountId`. "OAuth client ID is required…" from `startConnectorOAuth` propagates to the sheet. Gmail and Asana `reconnect` runs the OAuth hook again and stores the new `accountId`; they have no `sync`/`read` until slice 10 registers adapters. Folder: `revoke` = `unbindProject(scopeId)`, `reconnect` = `relinkProject(scopeId)`; `sync` walks `listWorkspaceChildren` breadth-first, paging on `cursor`, stops at 5,000 files, `progress('Reading your folder · {n} files')`, summary `"Read {n} files from {label}"`; a `restoreProjectBinding` status other than `ready` → `NeedsUserError('the folder moved or was deleted', relink-folder)`; `read` takes files ending `.md .txt .rst .org` under 200 KB whose `revision` differs from the cursor (JSON map path → revision), up to 40 per run. Documents `sync`: summary `"{n} documents ready to search"` from `countFiles`, plus `", {k} still indexing"` when file statuses are not done. Codex threads: `sync` summary `"Found {n} Codex threads"`; `read` returns threads with `updatedAt` after the cursor (ms as string), up to 40, `ref` = thread id.

- [ ] **Step 1: Write the failing tests** in `connect.test.ts`:
  - `folder pick binds a draft id; connect adopts it, adds the source and starts one sync job` (`startJob` with `label: 'Folder sync'`).
  - `cancelled folder picker returns null and binds nothing`.
  - `aborting pick while waiting for the browser creates no account`: abort before `waitForLocalOAuthCallback` resolves → `completeConnectorOAuth` never called, returns `null` (Review Focus 1).
  - `discard removes the draft binding and only a newly created account` (Review Focus 1); a reused account is kept.
  - `an existing account is reused without the browser`.
  - `Gmail with no adapter registered starts no job`; after `registerSourceAdapter('gmail', { sync })` it does.
  - `connect stores backgroundReview as given`.
  - `a rule error discards the draft and rethrows` (folder on Everywhere → `unbindProject('draft:…')`).
  - `folder sync raises a relink fix when the binding is missing`; `Documents does not support background review`.
  In `kinds/codex-threads.test.ts`: `detection alone never creates a source or reads a thread` (`listCodexThreads`/`readCodexThread` not called, `listSources()` empty); `connect then sync lists threads`; `read returns only threads newer than the cursor`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/sources`. Expected: FAIL.
- [ ] **Step 3: Implement** the five kinds, `pickSource`, `connectSource`, `discardSourceDraft`, `registerSourceFixHandlers`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(sources): pick and connect folder, Gmail, Asana, Codex threads and Documents`.

### Task 6: Background review and the scheduler

**Files:**
- Create: `src/renderer/packages/sources/review.ts`, `jobs.ts`, `review.test.ts`, `src/renderer/setup/background_jobs.ts`
- Modify: `src/renderer/index.tsx:199-203` (after the memory sync bootstrap: `void import('./setup/background_jobs').then(({ initBackgroundJobs }) => initBackgroundJobs())`)

**Interfaces:**
- Consumes: Tasks 2–5; `proposeKnowledge` (`@/packages/knowledge`); `getModel` (`@shared/models`), `generateText` (`@/packages/model-calls`), `createModelDependencies` (`@/adapters`) as in `packages/memory/extract.ts:66-92`; `parseScopes` (slice 3) over `storage.getItem(StorageKey.MyProjects, [])`.
- Produces:
  - `parseProposalDraft(raw: string, batchRefs: Set<string>): Array<{ kind: KnowledgeKind; text: string; ref: string }>` — strips code fences and `<think>` blocks; keeps entries with a valid `kind`, non-empty `text` (≤ 280 chars) and `ref` in `batchRefs`; at most 8 per batch; anything unparsable → `[]`.
  - `buildReviewPrompt(sourceLabel: string, items: SourceItem[]): { system: string; user: string }` — items listed with their `ref`; asks for JSON `{ "proposals": [{ "kind", "text", "ref" }] }`; only durable facts, decisions and preferences stated in the items; same language as the items; nothing when unsure.
  - `syncJobHandler: JobHandler` (kind's `sync`, then `updateSource(id, { lastSyncAt })`, `addDoneEntry: true`).
  - `reviewJobHandler: JobHandler` — no model configured → `NeedsUserError('no model is set up', choose-model)`; a `localOnly` source with a provider other than `ModelProviderEnum.Ollama` or `LMStudio` → `NeedsUserError('this source stays on this device; choose a local model', choose-model)` before reading; reads with the stored cursor, batches items to ≤ 12,000 characters per model call, calls `proposeKnowledge({ scopeId, kind, text, origin: 'background-review', sources: [{ kind: KNOWLEDGE_SOURCE_KIND[source.kind], label: item.label, ref: item.ref, sourceId }] })` per kept entry, then saves the cursor and `lastReviewAt`; summary `"Read {n} items from {label}: {k} proposals"`, `addDoneEntry: k > 0`.
  - `dueReviews(sources: ConnectedSource[], jobs: BackgroundJob[], now: number): string[]` — `backgroundReview`, a kind with `read`, `lastSyncAt` set when the kind has `sync`, no running `review` job, `lastReviewAt` absent or ≥ `REVIEW_INTERVAL_MS` ago. `dueSyncs(sources, jobs, now): string[]` — kinds with `pollMs`, no running `sync` job, `lastSyncAt` ≥ `pollMs` ago.
  - `initBackgroundJobs(): Promise<void>` — returns at once in the quick window; registers both job handlers, `registerSourceFixHandlers()` and `registerJobReviewOpener()`; `discardDraftFolderBindings()`; `resumeJobs()`; `adoptExistingFolderBindings(scope ids)`; checks `dueSyncs` and `dueReviews` at start, every 15 minutes and when a sync finishes, starting jobs labelled `"{name} sync"` and `"Background review of {label}"`.

- [ ] **Step 1: Write the failing tests** in `review.test.ts`:
  - `parseProposalDraft drops refs outside the batch`, `…returns [] for prose or broken JSON`, `…drops unknown kinds and empty text`, `…keeps at most 8` (Review Focus 4).
  - `review proposes with the source id and origin background-review` (mock model returns two valid proposals; `proposeKnowledge` called twice with `sources[0].sourceId === 's1'`).
  - `a failed review does not advance the cursor`: `proposeKnowledge` rejects → handler throws, `sourceCursor('s1')` unchanged (Review Focus 4).
  - `no model raises choose-model`; `a local-only source on a cloud model raises choose-model without reading`.
  - `dueReviews` table: switch off → none; never synced → none; synced, never reviewed → due; reviewed 5 h ago → none; 7 h ago → due; running review job → none. `dueSyncs`: no `pollMs` → none; `pollMs: 60_000`, synced 2 min ago → due.
  - `initBackgroundJobs does nothing in the quick window`; `it discards draft bindings at start`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/sources/review.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `review.ts`, `jobs.ts`, `setup/background_jobs.ts` and the `index.tsx` import.
- [ ] **Step 4: Run** the test, then `pnpm test -- src/renderer/packages`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(sources): background review proposes knowledge on a schedule`.

### Task 7: Add-source sheet (SR1, SR2)

**Files:**
- Create: `src/renderer/components/sources/AddSourceSheet.tsx`, `SourceKindPicker.tsx`, `AddSourceSheet.test.tsx`
- Modify: `src/renderer/modals/index.tsx:25-46` (`NiceModal.register('add-source', AddSourceSheet)`)

**Interfaces:**
- Consumes: Task 5 (`listSourceKinds`, `MCP_SOURCE_OPTION`, `pickSource`, `connectSource`, `discardSourceDraft`, `useCodexDetection`), Task 3 (`revokeSource`, `SourceRuleError`), 1b `Sheet` and `pushUndo`, slice 3 `useScopes()`.
- Produces: `openAddSourceSheet(opts?: { scopeId?: string; kind?: SourceKind }): Promise<{ sourceId: string } | null>`; `SourceKindPicker({ onPick, onMcp }: { onPick(kind: SourceKind, choice?: SourceChoice): void; onMcp(): void })` (one row per kind with name and hint, unavailable rows disabled with their hint, Gmail/Asana with active accounts expanding to "Use {accountHint}" and "Another account", Documents expanding to its collections or "No documents yet" with an "Add documents" button to `/settings/knowledge-base`, then "MCP server" with an "Advanced" chip).

Step SR1 (`Sheet` title "Add a source"): `SourceKindPicker`; a pick calls `pickSource` with an `AbortController` signal; while it runs the sheet shows "Waiting for the browser…" (OAuth) or "Choose a folder in the window that opened." (folder) and only Cancel. A `null` draft returns to SR1. MCP navigates to `MCP_SOURCE_OPTION.to` and closes. `opts.kind` starts the pick at once. Step SR2 (title "Connect {name}"): the draft's label, "Scope" select from `useScopes().scopes` with Everywhere first (preselected from `opts.scopeId`; hidden for Folder), the Background review switch (`role="switch"`, `className="dg-switch"`, `aria-checked="false"` initially; hidden for Documents) with the verbatim line passed as the `Sheet`'s `hint` prop (no `dg-sheet*` classes in the children). Actions: "Cancel" (ghost), primary "Connect". Cancel or Esc at SR2 calls `discardSourceDraft(draft)`; Cancel during a pick aborts the signal. Errors show as one line above the actions; a `SourceRuleError` uses the copy from Task 3; the client-ID error adds "Open Integrations" (`/settings/integrations`). Success closes the sheet and calls `pushUndo({ message: 'Connected {label} to {scope name}', undo: () => revokeSource(sourceId) })`.

- [ ] **Step 1: Write the failing tests** (`@vitest-environment jsdom`, mock `@/packages/sources`, `@/packages/undo`):
  - `lists the six options in order` (Folder, Gmail, Asana, Codex threads, Documents, MCP server).
  - `preselects the scope it was opened from`.
  - `background review is off by default and shows the line` (exact sentence).
  - `cancel during sign-in aborts`: click Gmail, then Cancel → the signal passed to `pickSource` is aborted, `connectSource` never called, sheet resolves `null`.
  - `cancel after pick discards the draft`: pick resolves a folder draft, click Cancel at SR2 → `discardSourceDraft(draft)` once, `connectSource` never called (Review Focus 1).
  - `connect passes scope and switch, then pushes an undo` with message `Connected chaeboxi to Dango`.
  - `Codex threads shows the detected count`; `folder hides Everywhere from the scope list`; `the client-ID error offers Open Integrations`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/sources/AddSourceSheet.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the sheet on 1b's `Sheet` and the picker.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(sources): add-source sheet`.

### Task 8: Settings › Sources page

**Files:**
- Create: `src/renderer/components/sources/SourcesSettings.tsx`, `SourceRow.tsx`, `SourcesSettings.test.tsx`
- Modify: `src/renderer/routes/index.tsx` (slice 5's Review route: render `<ReviewHome sourceCount={useSources().length} />`, replacing slice 5's stand-in), and slice 2's `/settings/sources` route file (its component becomes `SourcesSettings`). If slice 2 is not merged, create `src/renderer/routes/settings/sources.tsx` with `createFileRoute('/settings/sources')` and add `{ key: 'sources', label: 'Sources', icon: <IconPlugConnected className="w-full h-full" /> }` to `ITEMS` in `src/renderer/routes/settings/route.tsx:42-…` before `integrations`; slice 2 replaces it.

**Interfaces:**
- Consumes: Tasks 2, 3, 5, 7; `useScopes()`; `pushUndo`; slice 5's `ReviewHome(props: { sourceCount?: number })`.
- Produces: `SourcesSettings(): JSX.Element`; `SourceRow({ source, scopeName }: { source: ConnectedSource; scopeName?: string }): JSX.Element` (reused by Task 9); `sourceStatusLine(source: ConnectedSource, jobs: BackgroundJob[], now: number, paused: boolean): { text: string; fix?: JobFix; jobId?: string }`.

Page: heading "Sources", primary "Add a source" (opens the sheet with no scope). Rows grouped by scope name: kind name and label, status line, the Background review switch (kinds that support it), and a menu with "Sync now" (kinds with `sync`) and "Remove". Status lines: paused with a waiting job → "Paused"; running → the job's `progress`, else "Syncing…" or "Reviewing…"; latest job `needs-you` → `"{label} stopped: {error}"` plus the fix button calling `runJobFix`; else `"Synced {relative time}"`; never synced → "Connected". Remove hides the row at once and calls `pushUndo({ message: 'Removed {label}. Approved knowledge stays.', undo })`; `revokeSource` runs after 5 s unless undone. Empty state: "No sources yet." and "Connect a folder, Gmail, Asana, Codex threads or documents so Dango can learn about your work.", with "Add a source".

- [ ] **Step 1: Write the failing tests** (`jsdom`, fake timers):
  - `sourceStatusLine` cases: paused, running with progress, needs-you with fix, synced 5 min ago, connected.
  - `turning the switch on saves backgroundReview`.
  - `remove waits 5 s and Undo keeps the source`: Remove then undo → `revokeSource` never called; Remove and 5 s → called once.
  - `a needs-you row shows the fix as its button and no retry count` (no text matching `/attempt|retry|\d+ of \d+/i`).
  - `empty state copy`.
  - `Review gets the source count` (in `src/renderer/routes/index.test.tsx`, jsdom, `ReviewHome` mocked): with two stored sources the route renders `ReviewHome` with `sourceCount: 2`; with none, `sourceCount: 0`, so slice 5's EM2 shows even when Review has a done row.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/sources/SourcesSettings.test.tsx src/renderer/routes/index.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the page and route wiring.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(settings): Sources section lists and manages connected sources`.

### Task 9: Background work and Sources on the scope page (SR3)

**Files:**
- Create: `src/renderer/components/sources/BackgroundWork.tsx`, `BackgroundWork.test.tsx`
- Modify: `src/renderer/components/scope/ScopeOverview.tsx` (slice 3: add the Background work section after "Recent chats"), `src/renderer/components/scope/ScopeSourcesTab.tsx` (slice 3's placeholder: replace the body), `src/renderer/components/scope/ScopePage.tsx` (folder drop)

**Interfaces:**
- Consumes: Task 2 (`useBackgroundJobs`, `stopJob`, `startJob`, `runJobFix`), Task 8 (`SourceRow`), Task 7 (`openAddSourceSheet`), `pushUndo`.
- Produces: `BackgroundWork({ scopeId }: { scopeId: string }): JSX.Element | null`; `ScopeSourcesTab({ scope })` body.

Background work: section label "Background work". Running jobs first, each with label, a progress line (`progress`, else "Starting…"; while waiting for a retry "Trying again shortly"; while paused "Paused"; never a count) and a "Stop" button. Then the five newest finished jobs: done → `outcome`; needs-you → `"{label} stopped: {error}"` with the fix button; stopped → "Stopped". Stop calls `pushUndo({ message: 'Stopped {label}', undo })`, whose undo starts the same job again. Renders `null` when the scope has no jobs. The list is a live region (`aria-live="polite"`) announcing status changes, not progress ticks. Sources tab: the scope's `SourceRow`s, "Add a source…" (`openAddSourceSheet({ scopeId })`), and `BackgroundWork`; empty: "No sources yet." Folder drop: a `drop` on the scope page whose `dataTransfer` holds a directory calls `openAddSourceSheet({ scopeId, kind: 'folder' })`; the dropped path is ignored (the native picker opens).

- [ ] **Step 1: Write the failing tests** (`jsdom`): `shows a running sync with Stop`; `Stop calls stopJob and its undo restarts the job`; `a waiting retry says Trying again shortly and no count`; `needs-you shows the fix button that calls runJobFix`; `renders nothing for a scope without jobs`; `the Sources tab lists only this scope's sources and opens the sheet preselected`; `dropping a folder opens the sheet at Folder without passing a path`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/sources/BackgroundWork.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the component, the tab body, the overview section and the drop handler.
- [ ] **Step 4: Run** the test and `pnpm test -- src/renderer/components/scope`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(scopes): background work, sources tab and folder drop on the scope page`.

### Task 10: Verify the slice

**Files:**
- Modify: `docs/log.md` (one line under the implementation date), `docs/system-architecture.md` (narrow brokers: add `codex:threads`, `workspace:adopt-draft-binding`)

- [ ] **Step 1: Run** `pnpm test`, `pnpm check`, `pnpm lint`, `cargo check --manifest-path src-tauri/Cargo.toml`. Expected: no new failures against `main`.
- [ ] **Step 2: Manual check** (`pnpm dev`, macOS): add a folder to a project scope from Settings › Sources with Background review on; the scope page shows "Folder sync" with a progress line and Stop; a Done entry "Read {n} files from {folder}" lands in Review; then "Background review of {folder}" runs and its proposals appear in Review. Rename the folder in Finder and press Sync now: one Needs you entry "Folder sync stopped: the folder moved or was deleted" with "Find the folder". Set `backgroundPaused` and press Sync now: the row says "Paused" until it is cleared. Remove the source: approved knowledge from it stays and shows "source removed". Quit during a sync and relaunch: the job resumes. Pick a folder, then Cancel on the scope step: no binding remains after relaunch. Start Gmail and close the sheet before signing in: Sources and Integrations show nothing new.
- [ ] **Step 3: Commit**: `docs: record sources and background work`.

## Contract questions

None open: `connectSource` returns `{ sourceId, jobId? }` (in the register); slice 10 uses this plan's adapter names; Review gets a `'job'` opener only (a job row look, if ever needed, registers `('needs-you', C, { refType: 'job' })`); slice 5 calls `listSources()` to know whether any source is connected.
