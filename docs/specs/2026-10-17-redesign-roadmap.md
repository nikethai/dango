---
type: plan
status: draft
description: "The whole Dango redesign as thirteen plans: order, dependencies, the shared types every slice codes against, and how to run the plans"
generated: { by: claude/opus-5.5, at: 2026-10-17T18:20:00+07:00 }
---
# Dango redesign roadmap

The redesign is specified in [the brief](2026-10-16-redesign-brief.md), [the UX flows](2026-10-16-ux-flows.md) (25 flows, every screen ID), [ADR 0011](../adr/0011-maintainer-first-shared-core.md), [ADR 0012](../adr/0012-rename-to-dango.md), [ADR 0013](../adr/0013-everywhere-layer.md) and the design system copied in `design/dango/`. This page splits it into thirteen plans (slices 1, 1b, 2–5, 6a–6c, 7–10). Each slice has its own plan, written with the superpowers writing-plans skill, and ends in software that can be merged on its own.

## Slices

| # | Slice | Plan | Needs | Screens |
|---|---|---|---|---|
| 1 | Theme, sidebar, composer, ReviewItem | [theme first slice](2026-10-17-dango-theme-first-slice.md) | — | done (PRs #87, #89) |
| 1b | Shared foundations: Sheet, undo + ⌘Z, Mascot, Review entries store, `/new` route | [slice 01b](2026-10-17-slice-01b-shared-foundations.md) | 1 | used by every later slice |
| 2 | Settings: five sections + Advanced, Agents replaces Copilots | [slice 02](2026-10-17-slice-02-settings.md) | 1b | Settings, AGS1, TR1 |
| 3 | Scopes: projects become scopes, Everywhere, client scopes, scope pill | [slice 03](2026-10-17-slice-03-scopes.md) | 1b | EV1, EV2, FS1, EM1, Scope |
| 4 | Knowledge: proposals, approve, conflicts, undo, Knowledge tab, memory migration | [slice 04](2026-10-17-slice-04-knowledge.md) | 3 | KN1–KN3, RV2–RV4, RV6, RV7, CH0 card |
| 5 | Review home: the feed, Trust, keys, empty states | [slice 05](2026-10-17-slice-05-review-home.md) | 2, 4 | Main, RV1, RV3, RV5, EM2, TR1 |
| 6a | Chat thread: thinking line, tool blocks, plan card, artifacts in the inspector | [slice 06a](2026-10-17-slice-06a-chat-thread.md) | 1b, 2 | CH0, CH1, CH7, CH8, AG1, AG2, AR1 |
| 6b | Chat actions: answer row, edit/branch, chat menu, model errors, cost sheet, / menu, drop, first chat | [slice 06b](2026-10-17-slice-06b-chat-actions-errors.md) | 6a, 3 (Move to scope) | MA1, CM1, ER1–ER5, CS1, CO1–CO3, EM3 |
| 6c | Tool permission sheet, Swarm card, Search | [slice 06c](2026-10-17-slice-06c-permission-swarm-search.md) | 1b; 3 and 4 for Search | CH2, CH3, CH4, SE1 |
| 7 | Sources and background work: connect a source, background review, first sync, retries | [slice 07](2026-10-17-slice-07-sources-background.md) | 3, 4 | SR1–SR3, FR2, FS1 |
| 8 | Quick Chat with Rewrite (Writing assistant goes), menu bar, notifications | [slice 08](2026-10-17-slice-08-quick-chat-menu-bar.md) | 1b | QC1–QC3, QuickChat, MB1 |
| 9 | First run, window sizes, accessibility pass | [slice 09](2026-10-17-slice-09-first-run-responsive-a11y.md) | 2–8 | FR1–FR5, RS1–RS3, A11Y1, DK1, DK2 |
| 10 | PM pilot: Gmail and Asana as sources of client scopes | [slice 10](2026-10-17-slice-10-pm-pilot-sources.md) | 3, 4, 5, 7 | flow 10, CH6 |

**Order.** 1b first: it holds the pieces several slices share. Then two lines that can run at the same time:

- Main line: 3 → 4 → 5 → 7 → 10. Slice 5 also needs 2 (the Trust sheet), so merge 2 before 5.
- Side line: 2 → 6a → 8 → 6b → 6c. 6a needs 2 (`ShowThinking`), 8 needs only 1b; 6b waits for 3 (Move to scope); 6c's Search waits for 3 and 4.
- Last: 9, because it checks every screen.

A slice whose Needs are not merged yet does not start; plans give small fallbacks only where they say so.

## Shared types

Every plan codes against these names (and the register below). A plan may add fields; it may not rename these or change their meaning. The slice that introduces a type owns its file.

**Slice 3, `src/shared/types/scope.ts`**

```ts
export const EVERYWHERE_SCOPE_ID = 'everywhere'
export type ScopeKind = 'project' | 'client'
export const ScopeSchema = ProjectSchema.extend({
  kind: z.enum(['project', 'client']).default('project'),
  readsEverywhere: z.object({ facts: z.boolean(), documents: z.boolean() }).optional(), // absent = defaults below
})
export type Scope = z.infer<typeof ScopeSchema>
export function everywhereDefaults(kind: ScopeKind): { facts: boolean; documents: boolean } // project: both true; client: facts true, documents false
```

A scope is the existing Project (`src/shared/types/session.ts`, `ProjectSchema`), renamed in the interface and extended; sessions keep `projectId`. Everywhere is not stored as a Project: it is synthesised from `EVERYWHERE_SCOPE_ID` and always listed first.

**Slice 4, `src/shared/types/knowledge.ts`**

```ts
export type KnowledgeKind = 'fact' | 'decision' | 'preference'
export type KnowledgeSource = { id: string; kind: 'file' | 'commit' | 'chat' | 'email' | 'task' | 'url' | 'user'; label: string; ref?: string; removed?: boolean } // id: stable within its item (s1, s2…, never reused); the OKF source id
export type KnowledgeSourceInput = Omit<KnowledgeSource, 'id'> & { id?: string } // what other slices pass; the store assigns ids
export type KnowledgeEvent = { at: number; by: 'user' | 'background-review' | 'chat' | 'migration'; action: 'proposed' | 'approved' | 'edited' | 'superseded' | 'removed' | 'moved' | 'kept-both'; note?: string }
export type KnowledgeRevision = { id: string; text: string; condition?: string; parentId?: string; by: KnowledgeEvent['by']; createdAt: number; approval?: { by: 'user'; at: number; contentHash: string } }
export type KnowledgeItem = { id: string; scopeId: string; kind: KnowledgeKind; text: string; sources: KnowledgeSource[]; status: 'approved' | 'superseded' | 'removed'; supersededBy?: string; condition?: string; history: KnowledgeEvent[]; revisions: KnowledgeRevision[]; approvedRevisionId: string; staleAfter?: string; createdAt: number; updatedAt: number }
export type KnowledgeProposal = { id: string; scopeId: string; kind: KnowledgeKind; text: string; sources: KnowledgeSourceInput[]; origin: 'chat' | 'background-review'; conflictsWith?: string[]; createdAt: number }
```

Per [ADR 0014](../adr/0014-okf-knowledge-document-format.md) these records are OKF-ready. `text` and `condition` mirror the approved revision, so readers of those fields keep working. `contentHash = sha256hex(kind + '\n' + text + '\n' + (condition ?? ''))` (WebCrypto). Only a user action writes a revision with `approval`; everything else creates proposals. `staleAfter` is ISO 8601 with an offset; other values are kept and treated as unknown.

The knowledge API lives in `src/renderer/packages/knowledge/` and is the only way other slices read or change knowledge: `listKnowledge(scopeId, opts?)`, `proposeKnowledge(p)`, `approveProposal(id)`, `dismissProposal(id, opts?: { dontSuggestAgain?: boolean })`, `editKnowledge(id, text)`, `removeKnowledge(id)`, `moveKnowledge(id, toScopeId)`, `resolveConflict(conflictId, choice: { keep: string } | { keepBoth: string })`, undo through slice 1b's `pushUndo`. Retrieval for chat: `knowledgeForTurn(scopeId): KnowledgeItem[]` (the scope's own items, then Everywhere's facts and preferences per `readsEverywhere`; scope wins on a clash).

**Slice 5, `src/shared/types/review.ts`**

```ts
export type ReviewKind = 'proposal' | 'done' | 'needs-you' | 'conflict' | 'change' | 're-check' // same union as components/review/ReviewItem.tsx
export type ReviewEntry = { id: string; kind: ReviewKind; scopeId: string; source?: string; text: string; sub?: string; ref: { type: 'proposal' | 'conflict' | 'change' | 'job' | 'draft' | 'question'; id: string }; state: 'open' | 'done' | 'dismissed'; createdAt: number; undoUntil?: number }
```

The type and the entries store ship in slice 1b (see the register); slice 5 builds the feed on them.

**Slice 7 (file created by 1b), `src/shared/types/background.ts`**

```ts
export type BackgroundJob = { id: string; scopeId: string; kind: 'sync' | 'review' | 'swarm' | 'plan'; label: string; status: 'running' | 'done' | 'failed' | 'needs-you'; attempts: number; nextRetryAt?: number; startedAt: number; finishedAt?: number; error?: string }
export const RETRY_DELAYS_MS = [10_000, 60_000, 300_000] as const // then a Needs you entry
```

**Settings (slice 2 adds, others read):** `trustLevel: 'auto' | 'ask'` (default `'auto'`), `costWarningUsd: number` (default `0.5`, `0` turns it off), `showThinking: 'auto' | 'open' | 'closed'` (`'auto'` = open in project scopes and chats with no scope, closed in client scopes), `backgroundPaused: boolean` (default `false`; slice 7's runner honours it, slice 8's menu bar toggles it). Until slice 2 lands, readers use these defaults.

## Contract register

Names one slice creates and others import. The owner builds it; nobody else re-creates it. A plan that needs a name before its owner lands imports it anyway and lists the owner under Needs.

| Name | Where | Owner |
|---|---|---|
| `Sheet({ opened, onClose, title, children, actions, side?: 'bottom' \| 'right' })`, `useSheetFocus(ref, { onClose })` (first focus: the primary action, or `[data-autofocus]` in typing sheets; Tab stays inside; Esc closes and returns focus) | `src/renderer/components/ui/Sheet.tsx` | 1b |
| `pushUndo({ message, undo, group?: 'knowledge' \| 'other', silent?, durationMs? }): string`, `undoEntry(id): Promise<boolean>`, `undoLatest(): Promise<boolean>`, `useUndoHotkey()` (⌘Z / Ctrl+Z, ignored inside text fields), `<UndoToast />` (bottom-centre, one at a time, 5 s) | `src/renderer/packages/undo/` | 1b |
| `Mascot({ state, size, label? })`, `type MascotState = 'idle' \| 'thinking' \| 'replying' \| 'working' \| 'needs-you' \| 'done' \| 'asleep' \| 'stuck'`; reduced motion holds the idle pose and shows the state as text | `src/renderer/components/brand/Mascot.tsx` | 1b |
| `ReviewEntry` (+ optional `risk?: 'safe' \| 'risky'`, `actionLabel?`, `options?: { id; text; source? }[]`, `resolvedAt?`, `chatId?` (the chat a Change entry came from; added by 6a)), `addReviewEntry(input): Promise<ReviewEntry>` (merges an open entry with the same `ref`), `updateReviewEntry(id, patch)`, `setReviewEntryState(match: { id } \| { ref }, state)`, `listReviewEntries()`, `subscribeReviewEntries(cb): () => void`, `useReviewEntries()`, `useReviewWaitingCount()` (open Needs you + Proposal + Conflict), `registerReviewOpener(refType, open, opts?: { canOpen?(entry) })` (an entry its opener refuses gets no Open; `canOpen` added by 6a), `openReviewEntry(entry)`, `registerReviewRenderer(kind, Component, opts?: { refType? })` with `ReviewRendererProps = { entry; focused: boolean }` (lookup `kind:ref.type`, then bare `kind`, then slice 5's default renderer), `useReviewRenderer(entry)`; `ReviewRefType` = `'proposal' \| 'conflict' \| 'change' \| 'job' \| 'draft' \| 'question' \| 'setup' \| 'chat' \| 'knowledge'`, `setLastCheckedAt(ts)`, `useLastCheckedAt()`; storage key `review-entries` | `src/shared/types/review.ts`, `src/renderer/packages/review/` | 1b |
| Additions 1b also makes: Sheet `hint?`; `pushUndo` `extra?: { label, onClick }`; `canUndo`, `DEFAULT_UNDO_MS`, `hasReviewOpener`, `loadReviewEntries`, `waitingCount`, `MASCOT_STATE_LABEL`, `useReducedMotion`, `isEditableTarget`; Mascot `size` is one of 16, 20, 22, 24, 28, 40, 56 | 1b files | 1b |
| `BackgroundJob` and `RETRY_DELAYS_MS` exactly as in Shared types above (slice 7 adds fields) | `src/shared/types/background.ts` | 1b |
| `/new` route (today's new-chat page, `search: { scopeId?, prefill? }`) and `startNewChat({ scopeId?, prefill? })`; `/` redirects to `/new` until slice 5 makes it Review | `src/renderer/routes/new.tsx`, `src/renderer/lib/startNewChat.ts` | 1b |
| `useTrustSheet()`; routes `/settings/sources`, `/settings/privacy` | slice 2 files | 2 |
| `useScopes(): { scopes, getScope, addScope, updateScope, removeScope, putScope }` (outside React: `myProjectsAtom` + `parseScopes` through Jotai's `getDefaultStore()`), `readsEverywhereFor(scope)`, `isEverywhere(id)`, `moveSessionToScope(sessionId, scopeId \| undefined)`, route `/scope/$scopeId` (Everywhere at `/scope/everywhere`), `ScopeKnowledgeTab`, `ScopeSourcesTab`, `useScopeKnowledgeCount`, `EverywherePage` sections `data-section="preferences" \| "facts" \| "documents"` | slice 3 files | 3 |
| `proposeKnowledge(input: Omit<KnowledgeProposal, 'id' \| 'createdAt'>)` (adds the Proposal or Conflict Review entry itself), `approveProposal(id, opts?: { text?: string }): Promise<KnowledgeItem>`, `deferProposal(id)`, `listDontSuggest()`, `allowSuggestAgain(id)`, `markSourceRemoved(sourceId)`; `KnowledgeProposal.origin` adds `'user'`; `KnowledgeSource.sourceId?`; message field `knowledgeIds?: string[]` | `src/renderer/packages/knowledge/` | 4 |
| Review renderers `('proposal', { refType: 'proposal' })`, `('conflict', { refType: 'conflict' })`, `'re-check'` (inline edit RV2, Keep both RV7); knowledge actions push their own undo, so the feed never pushes a second one | `src/renderer/packages/knowledge/review/` | 4 |
| `ReviewFeed`, `/` = Review, the Review toolbar (its Trust button calls `useTrustSheet()`), keys, empty states, the default renderer (its primary button and E call `openReviewEntry` when the entry has an opener); Trust arrival with `registerReviewApplier(refType, applier)`, `getReviewApplier`, `getTrustLevel`, `canUndoArrival`, `undoArrival`; default `'question'` opener (a prefilled chat; slice 10 replaces it) | slice 5 files | 5 |
| `registerSourceKind`, `registerSourceAdapter(kind, adapter)`, `listSourceKinds()`, `ConnectedSource` (with `connectedAt`, `localOnly?`), `openAddSourceSheet({ scopeId? })`, `SourceKindPicker`, `pickSource()`, `connectSource(draft, { scopeId, backgroundReview }): Promise<{ sourceId; jobId? }>`, `listSources(filter?)`, `updateSource(id, patch)`, `SourceAdapter = { pollMs?, sync?, read? }`, `NeedsUserError`, `JOB_FIX_LABELS`, `getBackgroundJob`, `useBackgroundJob`, `stopJob`, `runJobFix(id)`; `BackgroundJob` adds `sourceId?`, `progress?`, `outcome?`, `fix?`, `stoppedAt?` (a stopped job is `failed` with `stoppedAt`); the runner honours `backgroundPaused` and calls `setLastCheckedAt` when a sync or review finishes; `'job'` opener | slice 7 files | 7 |
| `Platform.openInMain?(path: string): Promise<void>` (desktop shell: hides the quick window, shows main and sends it `navigate-to` with an app path starting with `/`; Rust channel `shell:openInMain` rejects anything else; absent on web and mobile, where the caller navigates its own window). The quick window opens everything that configures (Sign in, Choose a model, settings links) and its notification clicks through it | `src/renderer/platform/interfaces.ts`, `src-tauri/src/desktop_shell.rs` | 8 |
| Tool permission queue `requestToolPermission`, per-scope Always grants, `ToolPermissionSheet`; Swarm as one toggle under Tools ▾, `Message.swarm { runId, taskTitle, stoppedEarly }`, `SwarmLiveCard`, `SwarmWorkedWith`; `registerSearchProvider`, `SearchOverlay` (⌘K) | slice 6c files | 6c |
| `'setup'` opener for the skipped-source entry; phone-only `/scopes` list | `src/renderer/packages/first-run/`, slice 9 files | 9 |
| `'draft'` and `'question'` openers, a `'draft'` applier; Gmail and Asana registered with `registerSourceAdapter` | `src/renderer/packages/pm-pilot/` | 10 |
| Existing names slice 10 imports (registered 2026-10-20, all already exported): `readScopes` | `src/renderer/hooks/useScopes.ts` | 3 |
| `addKnowledge`, `resolveConflict`, `KnowledgeConflictError`, `ensureKnowledgeLoaded`, `recordKnowledgeUse`, `NEVER_SEND_EMAIL` | `src/renderer/packages/knowledge/` | 4 |
| `applyReviewEntry` | `src/renderer/packages/review/trust.ts` | 5 |
| `backgroundModelChoice`, `hasUsableModel`, `sourcesStore`, `LOCAL_PROVIDERS` (today a private constant in `packages/sources/review.ts`; slice 10 exports it); sync results may carry `quiet?: boolean` (no Done entry for that run), and a source adapter may ask for a shorter poll interval than the 15-minute check (slice 10: Gmail 60 s, Asana 120 s) | `src/renderer/packages/sources/`, `src/renderer/packages/background/` | 7 (changes made in slice 10) |
| `openConfiguration(path)` | `src/renderer/components/sources/openConfiguration.ts` | 7 |
| `switchCurrentSession(id)` | `src/renderer/stores/session/crud.ts` | chat store |
| `reviewStore`, `loadReviewEntries`, `subscribeReviewEntries` (slice 10's bridge also re-exports these) | `src/renderer/packages/review/store.ts` | 1b |
| `loadSources`; `isLocalModelProvider` (moved beside `LOCAL_PROVIDERS` by slice 10) | `src/renderer/packages/sources/store.ts`, `src/renderer/packages/sources/model-check.ts` | 7 (changes made in slice 10) |
| `startNewChat` is also imported directly by slice 10's `answer.ts` (fallback for questions it doesn't own) | `src/renderer/lib/startNewChat.ts` | 1b |
| Existing names slice 9 imports (registered 2026-10-21, all already exported): `discardSourceDraft`, `draftWasDiscarded`, `sourceRuleErrorText`, `SourceRuleError`, `BACKGROUND_REVIEW_LINE`, `getSource`, `useSources`, `useSourcesLoaded`, `getSourceKind`, `MCP_SOURCE_OPTION`; `SourceDraft`; `useBackgroundJobs` | `src/renderer/packages/sources/`, `src/shared/types/sources.ts`, `src/renderer/packages/background/` | 7 |
| `validateScopeName` | `src/renderer/projects/scope-store.ts` | 3 |
| `formatShortcutLabel`, `Keys`; `knownWindowRole`, `getWindowRole` | `src/renderer/components/Shortcut.tsx`, `src/renderer/platform/windowRole.ts` | existing |
| `TRUST_LABELS`, `readTrustLevel`; `useReviewEntries`, `hasOpenSheet`, `topSheet` | `src/renderer/components/settings/TrustSheet.tsx`, `src/shared/types/settings.ts`, `src/renderer/packages/review/`, `src/renderer/components/ui/Sheet.tsx` | 2, 5, 1b |
| Additive exports slice 9 makes in their owners' files: `TRUST_OPTIONS` (the Trust sheet's option lines), an optional `className` on `Sheet`, the model tester's basic-test helper, and the Codex and Gemini OAuth model-seeding helpers | owners' files | 2, 1b, existing (changes made in slice 9) |

## Decisions where the spec disagreed with itself

These are now written into the flows themselves; the UX flows' [Settled while planning](2026-10-16-ux-flows.md#settled-while-planning-2026-10-17) section lists them with the rest of what the plans settled, and is the one source of truth.

- Trust Auto never approves knowledge: ADR 0001 wins over the brief. Auto applies safe actions that are not knowledge (a Gmail label, a draft that is not sent) and shows them as Done with Undo; knowledge proposals always wait.
- Preferences approved anywhere land in Everywhere (ADR 0013); there is no "Apply to all scopes?" question.
- Review keys: ↑↓ or J/K move, A approve, E edit, X dismiss, ↵ open, ⌘Z undo. While editing, ⌘↵ approves.
- Conflict actions: Keep this on each statement, then Keep both… and Dismiss.
- Choosing project or client sets the words and the Everywhere defaults (ADR 0013).
- Scope Files, Sources and Knowledge are tabs on the scope page; the inspector is for chats and artifacts, 380–460 px.
- Errors that retrying cannot fix (expired sign-in, missing folder, no model) skip the retries and go straight to Needs you.
- Knowledge records are OKF-ready per ADR 0014; OKF import/export is a later, unscheduled plan.
- Values the spec leaves open and the plans chose: a long run is 60 s or more; background review every 6 h; PM pilot confidence High ≥ 0.85, Medium ≥ 0.6; at most 20 drafts a day. Tune them in use.

## Rules every plan follows

- The design system in `design/dango/` and the `--dango-*` variables from slice 1 are the only source of colour, type, spacing and radius. Classes from `src/renderer/static/dango-components.css` (`dg-*`) are reused, not redrawn.
- Copy follows the README's voice section: sentence case, buttons name the action, errors put the fix on the button, no emoji.
- Dango never sends an email or deletes forever without asking. Undo is a 5 s toast plus ⌘Z.
- Each plan's Global Constraints list its Needs and what is out of the slice. Shared names come from the Contract register above; a plan does not redefine them.
- Plans are saved here as `2026-10-17-slice-NN-<name>.md` with OKF frontmatter, `status: draft`. Merging a plan's PR is the approval.

## Running the plans

These plans are approved for execution once this roadmap is merged to `main`, even though their frontmatter says `status: draft`; the maintainer sets `stable` after a slice ships. Each plan starts with the line telling an agent to use superpowers:subagent-driven-development or superpowers:executing-plans.

One branch and one PR per slice, named `feat/redesign-<NN>-<name>` from the plan file name, off the latest `main`. A slice is done when its plan's tests pass, `pnpm check`, `pnpm lint` and `pnpm test` pass, and the dango-verify-change skill's checks pass. Stop and report, rather than guess, when a step's test fails twice after a fix, when the code no longer matches a line range the plan cites and the right place is not obvious, or when a step needs a name the Contract register does not have.

Goal for the first session (1b, then the main line):

> Execute docs/specs/2026-10-17-slice-01b-shared-foundations.md, then slices 03, 04, 05, 07, 10 from docs/specs/2026-10-17-redesign-roadmap.md, in that order. Merge 02 before starting 05. Follow the roadmap's "Running the plans" rules. Open one PR per slice and wait for it to be merged before starting the next.

Goal for the second session, started after 1b is merged:

> Execute slices 02, 06a, 08, 06b, 06c from docs/specs/2026-10-17-redesign-roadmap.md, in that order, starting each only when the slices in its Needs column are merged. Follow the roadmap's "Running the plans" rules. One PR per slice.

Slice 09 starts after every other slice is merged.

**Relicensing comes after.** The clean-room relicensing plan (`2026-10-17-clean-room-relicense.md`) starts only once every slice here has merged (maintainer decision, 2026-10-17). The slices edit existing files where their plans say so; the clean-room rule and the provenance gate do not apply to them. The relicensing plan then measures what upstream-derived code is left and cleans it.
