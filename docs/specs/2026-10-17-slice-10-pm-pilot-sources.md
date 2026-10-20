---
type: plan
status: draft
description: "Slice 10: Gmail and Asana as source kinds of client scopes, and flow 10 (route, retrieve, judge, act by tier; sent replies read back as proposals) on the shared core"
generated: { by: claude/opus-5.5, at: 2026-10-17T19:00:00+07:00 }
---
# Slice 10: PM pilot, Gmail and Asana as Sources of Client Scopes, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A PM connects Gmail and Asana to a client scope; each new client email is routed to its scope, checked against that scope's email, tasks and approved knowledge, and handled by confidence tier (a draft written into Gmail and shown as Done with Undo; a draft Proposal to edit and approve; or a Needs you item with candidates that opens as a chat). What the PM sends is read back, and fact changes become knowledge proposals.

**Architecture:** Pure logic (types, Gmail normaliser, routing, judge validation, tier decision, fact diff, copy) lives in `src/shared/pm-pilot/`. I/O (Gmail and Asana HTTP, the record store, model calls, the pipeline, chat tools) lives in `src/renderer/packages/pm-pilot/`. Every call into slices 1b, 3, 4, 5 and 7 goes through one file, `src/renderer/packages/pm-pilot/bridge.ts`, so a renamed export there is a one-file fix. Slice 10 never reads Trust: it adds a High-tier draft as a safe Proposal and registers a `'draft'` applier, and slice 5's Trust arrival applies it as Done with Undo under Auto or leaves it waiting under Ask. There is no client record store, ledger or Clients page: a client is a scope with `kind: 'client'`, facts are knowledge items and proposals, Gmail and Asana are slice 7 source kinds whose adapters this slice registers, and results are Review entries.

**Tech Stack:** TypeScript, Zod, ofetch, Vercel AI SDK through `generateText` from `@/packages/model-calls`, Vitest + msw (`msw/node`, already a dev dependency), Biome.

**Spec:** `docs/specs/2026-10-16-ux-flows.md` flow 10 and flows 3, 6, 9, 15, 16, Screens RV1 and CH6; `docs/specs/2026-10-16-redesign-brief.md` (Trust, Review item types, the PM's behaviour); `docs/specs/2026-10-17-redesign-roadmap.md` (Shared types, Contract register, Decisions); `docs/specs/2026-10-13-pm-pilot-design.md` sections 1 and 3 where flow 10 does not override them; ADRs 0001, 0003, 0010, 0011, 0013.

## Global Constraints

- **This plan supersedes `docs/specs/2026-10-14-pm-pilot-phase-1-client-memory.md`.** Task 1 sets that file's frontmatter to `status: deprecated`, adds the line `Superseded by [slice 10](2026-10-17-slice-10-pm-pilot-sources.md) on 2026-10-17.` under its title, and adds a `docs/log.md` line under 2026-10-17. Its phases 2 and 3 (labels, drafts) are folded in here; first run and the settings split belong to slices 9 and 2.
- **Needs** (names from the roadmap's Contract register, imported only in `bridge.ts`, Task 5): **1b** `ReviewEntry` (with `risk`, `actionLabel`, `options`), `addReviewEntry`, `updateReviewEntry`, `setReviewEntryState`, `listReviewEntries`, `registerReviewOpener`, `pushUndo`, `Sheet`, `startNewChat`; **3** `Scope`, `EVERYWHERE_SCOPE_ID`, `myProjectsAtom` / `parseScopes` (the store behind `useScopes()`, read outside React through Jotai's `getDefaultStore()`); **4** `proposeKnowledge` (adds its own Proposal or Conflict entry), `approveProposal(id, { text })`, `knowledgeForTurn`, `KnowledgeSourceInput` (sources without an `id`; slice 4 assigns ids); **5** `registerReviewApplier`, `getTrustLevel` (Trust arrival); **7** `registerSourceAdapter`, `SourceAdapter`, `ConnectedSource` (`connectedAt`, `localOnly`), `SourceItem`, `listSources`, `updateSource`, `NeedsUserError`, `JOB_FIX_LABELS`.
- **Never send.** No module calls `messages/send`, `drafts/send` or `messages/import`. The Gmail client has no export whose name contains `send`. Drafts and labels are the only Gmail writes; a draft is deleted only by the user's Undo, and only when Gmail still holds the message Dango wrote.
- Nothing from Gmail or Asana becomes approved knowledge on its own (ADR 0001): facts reach knowledge only through `proposeKnowledge`. The one approval slice 10 makes is the user's own typed answer in a Needs you chat (CH6): proposed with `origin: 'user'` and approved at once with `approveProposal(id, { text })`, because the user wrote it.
- A source marked local-only is never sent to a cloud model (ADR 0003): its records sync, but judge, draft, fact-diff and `client_recall` skip them unless the default chat model's provider is `ModelProviderEnum.Ollama` or `ModelProviderEnum.LMStudio`.
- Trust (roadmap Decisions): slice 10 never reads `trustLevel`. A High-tier draft under the daily cap is added as `kind: 'proposal'`, `risk: 'safe'`, `ref: { type: 'draft', id }`, `actionLabel: 'Apply'`; slice 5's arrival runs the registered `'draft'` applier under `'auto'` (label + draft in Gmail, stored as Done with a silent `pushUndo`) and leaves it waiting with Apply under `'ask'`. Medium drafts and High drafts over the cap are added with `risk: 'risky'`, so they always wait. Nothing sends.
- Values: `GMAIL_BACKFILL_DAYS = 90`, `GMAIL_POLL_MS = 60_000`, `ASANA_POLL_MS = 120_000`, `HIGH_CONFIDENCE = 0.85`, `MEDIUM_CONFIDENCE = 0.6`, `DAILY_DRAFT_CAP = 20` (resets at local midnight), `PIPELINE_MAX_THREADS_PER_TICK = 10`, `RETRIEVE_MAX_RECORDS = 12`, `DRAFT_LABEL = 'Dango/Draft ready'`, `PUBLIC_MAIL_DOMAINS = ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com']`. The confidence thresholds and the daily cap are pinned by the roadmap's Decisions (tune them in use); the rest are this plan's choices.
- Dates in copy are `d MMM` (`12 Sep`). Evidence labels: a Gmail record sent by the user → `your {d MMM} email`; another Gmail record → `{sender first name}'s {d MMM} email`; an Asana record → `Asana "{task name}"`; a knowledge item → `approved: {first 40 chars}`.
- Copy (sentence case, no emoji, buttons name the action):
  - Draft proposal (waiting): source `Gmail thread "{subject}"`, text = the draft body, sub `Not in Gmail yet · per {labels}`, `actionLabel: 'Apply'`; E or ↵ (slice 5's default renderer calls `openReviewEntry`) opens the edit sheet (title `Edit the reply`, the draft in a text area, primary **Apply**, **Cancel**).
  - Done draft (RV1), written onto the same entry with `updateReviewEntry` once the applier has run: text `Reply drafted in Gmail: {answer}, per {labels joined with ", " and " and "}.`, sub `Draft is in the thread, not sent`; ↵ opens the Gmail thread; Undo is slice 5's arrival undo.
  - Needs you, candidates (RV1): source `{two|three|four|N} candidates`, text `{summary} I found {v1} ({d1}) and {v2} ({d2}). Which is current?`, action **Answer**.
  - Needs you, no answer: source `no answer found`, text `{summary} I couldn't find the answer.`, action **Answer**.
  - Needs you, unknown client (flow 10 step 1): source `Gmail`, text `Which client is this?`, sub `{from} · "{subject}"`, action **Answer**.
  - Needs you, Asana project: source `Asana`, text `Which Asana project is {scope name}?`, `options` = the account's projects, action **Answer**.
  - Needs you, local-only: text `{scope name} Gmail stays on this device. Choose a local model to draft replies.`, action **Choose a model** (opens Settings › Models and keys).
  - CH6 chat opening (one assistant message): `{summary} I found {n word} answers and can't tell which is current:` then one line per candidate `{value} · {d MMM} · {source label}`, then `Pick one, or type the answer. I'll save it for {scope name} and draft the reply.`
  - Sent-reply proposal (flow 10 step 5): slice 4's Proposal entry keeps the fact as its text; slice 10 sets its `sub` to `You told {scope name} {sent}; the draft said {draft}. Save {sent} as the {what}?`
  - Undo of a draft the PM has since edited in Gmail: the applier's `undo` throws, so 1b shows `Couldn't undo. The change stays.` and the draft stays.
- Storage follows `.claude/skills/dango-storage-migration`: keys in `StorageKey` / `StorageKeyGenerator` (`src/renderer/storage/StoreStorage.ts:6-72`), drafts and questions written with `setItemNow`; no migration (all keys are new).
- Auth reuses Integrations: Gmail is a `google_workspace` account with the `mail` (or wider) scope pack (`gmail.modify`); Asana is an `asana` account (PAT or OAuth). No new OAuth code.
- Code style per `AGENTS.md`. Commits `feat(pm-pilot): …`.
- **Out of this slice:** the add-source sheets SR1–SR3, the Gmail/Asana sign-in (`pick`, `reconnect`), the job runner, retries and the "Gmail sync stopped: sign in again" Needs you item (slice 7); the Review feed, keys, Trust arrival and the undo toast (1b, 5); Proposal and Conflict entries and renderers (4); scope pages and the scope Settings tab (3); first run FR2 (9); Search SE1 (6c). In this slice: the local-only switch on Gmail and Asana source rows (slice 7 left the field for slice 10). Dropped from the old plan: its own record store for clients, the ledger, client auto-creation and merge, own-domain setting, Clients settings page, draft auto-expiry and deleting a draft when the PM replies by hand (Dango deletes nothing without asking), per-client drafts switch (Trust Ask covers it in v1).

## Review Focus

1. **First sync or an expired history id pulls 90 days of mail** → records are stored but the pipeline acts only on messages that arrived after the source was connected and were not processed before; no flood of drafts. Test in Task 9.
2. **The PM edited the draft in Gmail, then presses Undo in Dango** → the draft is kept and the toast says the change stays; Undo never destroys the PM's words. Tests in Tasks 3 and 8.
3. **The model cites evidence it was not given, or invents a fact change** → the citation is dropped; an answer left without evidence is Low (Needs you), and a fact change whose values are not in both texts is not proposed. Tests in Tasks 6 and 7.
4. **A thread matches two client scopes, or a newsletter from an unknown domain** → two matches give a "Which client is this?" Needs you with both scopes as candidates; promotions, bulk mail and `no-reply` senders never create a Needs you item; one open question per unknown domain. Tests in Tasks 5 and 9.
5. **Vietnamese mail** → normaliser keeps diacritics and drops `Vào … đã viết:` quotes; the draft's MIME subject is RFC 2047 encoded so `Re: Báo giá` arrives intact. Tests in Tasks 1 and 3.

---

### Task 1: Types, Gmail normaliser, supersede the old plan

**Files:**
- Create: `src/shared/pm-pilot/types.ts`, `src/shared/pm-pilot/gmail-normalize.ts`, `src/shared/pm-pilot/index.ts`
- Create fixtures: `test/fixtures/pm-pilot/gmail/plain.json`, `html-only.json`, `quoted-reply.json`, `vietnamese.json`, `newsletter.json`, `sent-reply.json` (anonymised `users.threads.get?format=full` responses)
- Modify: `docs/specs/2026-10-14-pm-pilot-phase-1-client-memory.md:1-6`, `docs/log.md` (2026-10-17 section)
- Test: `src/shared/pm-pilot/gmail-normalize.test.ts`

**Interfaces:**
- Consumes: `KnowledgeSourceInput` from `@shared/types/knowledge` (slice 4). Test fixtures that build `KnowledgeItem` literals for `knowledgeForTurn` mocks include `revisions` and `approvedRevisionId` (slice 4's shape).
- Produces (Zod schema + type each, in `types.ts`, plus the constants from Global Constraints):
  - `PmSourceKind = 'gmail' | 'asana'`
  - `SourceRecord = { id: string; sourceKind: PmSourceKind; sourceId: string | null; accountId: string; externalId: string; threadOrTaskId: string; scopeId: string | null; author: string; participants: string[]; occurredAt: number; title: string; text: string; status?: string; sentByMe: boolean; noise: boolean; rfcMessageId?: string; link: { label: string; url: string } }` and `recordId(kind, externalId) → \`${kind}:${externalId}\``
  - `GmailSourceConfig = { accountId: string; matchers: string[] }` (`@acme.com` or `jo@acme.com`), `AsanaSourceConfig = { accountId: string; projectGid: string }`
  - `SyncCursor = { accountId: string; sourceKind: PmSourceKind; scope: string; value: string; updatedAt: number }`
  - `Tier = 'high' | 'medium' | 'low'`; `Evidence = { id: string; label: string; date: number; text: string; source: KnowledgeSourceInput }` (`id` is `r:{recordId}` or `k:{knowledgeId}`)
  - `ClientDraft = { id: string; scopeId: string; accountId: string; threadId: string; inboundMessageId: string; to: string; subject: string; inReplyTo?: string; text: string; answer: string; evidence: Evidence[]; gmailDraftId?: string; gmailMessageId?: string; state: 'proposed' | 'written' | 'undone' | 'sent' | 'dismissed'; reviewEntryId?: string; createdAt: number }`
  - `ClientQuestion = { id: string; kind: 'which-client' | 'which-answer' | 'which-project'; sourceId?: string; scopeId: string | null; accountId: string; threadId: string; subject: string; from: string; summary: string; candidates: Array<{ value: string; date?: number; sourceLabel: string; scopeId?: string; evidenceIds?: string[] }>; domain?: string; sessionId?: string; reviewEntryId?: string; state: 'open' | 'answered'; createdAt: number }`
  - `type GmailThread` / `type GmailMessage` (in `gmail-normalize.ts`): the subset of the Gmail API used (`id`, `threadId`, `labelIds`, `internalDate`, `payload.headers`, `payload.parts`, `payload.body.data`).
  - `normalizeGmailThread(thread: GmailThread, accountId: string, ownAddress: string): SourceRecord[]`: one record per message, `scopeId: null`, `sourceId: null`, `link.url = https://mail.google.com/mail/#all/{threadId}`, `title` = Subject, `author` = From address, `participants` = From/To/Cc lower-cased, `sentByMe` = `labelIds` has `SENT`, `noise` = a `CATEGORY_PROMOTIONS|SOCIAL|FORUMS|UPDATES` label, a `List-Unsubscribe` or `Precedence: bulk` header, or a sender local part starting `no-reply`/`noreply`; `rfcMessageId` = `Message-ID` header.
  - `extractNewText(body: string): string`

- [ ] **Step 1: Write the failing tests** (kept from the old Task 2, plus the new flags):

```ts
it('keeps Vietnamese diacritics', () => expect(normalizeGmailThread(vietnamese, 'a1', 'pm@agency.vn')[0].text).toContain('Chúng tôi đã cập nhật thiết kế'))
it('extracts text from HTML-only bodies', () => { const [r] = normalizeGmailThread(htmlOnly, 'a1', 'pm@agency.vn'); expect(r.text).toContain('Can you confirm the launch date?'); expect(r.text).not.toContain('<') })
it('drops quoted earlier messages in English and Vietnamese', () => { const rs = normalizeGmailThread(quotedReply, 'a1', 'pm@agency.vn'); expect(rs[1].text).not.toMatch(/^>/m); expect(rs[1].text).not.toContain('On Mon, 1 Sep 2026'); expect(extractNewText('Ok\n\nVào 2 thg 9, 2026 Lan đã viết:\n> cũ')).toBe('Ok') })
it('marks newsletters as noise and sent mail as sentByMe', () => { expect(normalizeGmailThread(newsletter, 'a1', 'pm@agency.vn')[0].noise).toBe(true); expect(normalizeGmailThread(sentReply, 'a1', 'pm@agency.vn').at(-1)?.sentByMe).toBe(true) })
it('builds ids and links from Gmail ids', () => { const [r] = normalizeGmailThread(plain, 'a1', 'pm@agency.vn'); expect(r.id).toBe(`gmail:${plain.messages[0].id}`); expect(r.link.url).toBe(`https://mail.google.com/mail/#all/${plain.id}`) })
```

- [ ] **Step 2: Run** `pnpm test -- src/shared/pm-pilot/gmail-normalize.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `types.ts` and `gmail-normalize.ts`.** Decode base64url as UTF-8 with `TextDecoder`; prefer `text/plain`, else `text/html` stripped (`DOMParser` when present, tag regex otherwise). `extractNewText` cuts at the first line matching `^On .+ wrote:$`, `^Vào .+ đã viết:$`, or a run of `>` lines.
- [ ] **Step 4: Run the test.** Expected: PASS. Then mark the old plan superseded and add the log line (Global Constraints, first bullet).
- [ ] **Step 5: Commit** `feat(pm-pilot): add types and Gmail normaliser; supersede phase-1 plan`

### Task 2: Gmail read sync

**Files:**
- Create: `src/renderer/packages/pm-pilot/gmail-sync.ts`, `src/renderer/packages/pm-pilot/tokens.ts`
- Modify: `src/renderer/packages/integrations/mcp-inject.ts:29-61` (export `refreshForAccount`)
- Test: `src/renderer/packages/pm-pilot/gmail-sync.test.ts` (msw on `https://gmail.googleapis.com/gmail/v1/users/me/*`), `src/renderer/packages/pm-pilot/tokens.test.ts`

**Interfaces:**
- Consumes: `normalizeGmailThread`, `SyncCursor`, `SourceRecord`, `GMAIL_BACKFILL_DAYS` (Task 1).
- Produces:
  - `buildMatcherQuery(matchers: string[]): string` → `from:(@a.com OR x@b.com) OR to:(@a.com OR x@b.com)`; `''` for none.
  - `syncGmailMailbox(input: { accountId: string; accessToken: string; ownAddress: string; cursor: SyncCursor | null; backfillQuery: string; now?: number }): Promise<{ records: SourceRecord[]; cursor: SyncCursor; backfilled: boolean }>` — `cursor === null` → `messages.list?q=after:{epochSec} ({backfillQuery})`, fetch distinct threads, cursor = `profile.historyId`; else `history.list?startHistoryId=…&historyTypes=messageAdded`, fetch touched threads (all of them; routing filters), cursor = response `historyId`; `history.list` 404 → backfill in the same call. Empty `backfillQuery` with no cursor → no `messages.list` call, cursor from `profile`.
  - `class GmailAuthError extends Error` thrown on 401/403.
  - `getFreshToken(accountId: string): Promise<{ ok: true; token: string; ownAddress: string } | { ok: false; message: string }>` in `tokens.ts` (`ensureFreshSecret` with `refreshForAccount`, marking the account `needs_reauth` on failure as `resolveMcpInjectForAccount` does; `ownAddress` from `account.config.email ?? account.accountHint`).

- [ ] **Step 1: Write the failing tests:** `backfills when there is no cursor` (asserts `q` contains `after:` and the matcher query; `backfilled: true`); `syncs incrementally from history` (one `messageAdded` → that thread only; `backfilled: false`); `falls back to backfill when the history id has expired` (404 → `messages.list` called, cursor returned); `does not backfill when no source has matchers`; `throws GmailAuthError on 401`; `buildMatcherQuery returns '' for none and the OR form for two`; in `tokens.test.ts`: `returns the refreshed token and own address`, `returns the reconnect message when the secret is missing`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/pm-pilot/gmail-sync.test.ts src/renderer/packages/pm-pilot/tokens.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement with `ofetch`** (bearer header, page through `nextPageToken`, threads fetched 5 at a time).
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pm-pilot): sync Gmail by history polling`

### Task 3: Gmail writes: label, draft, undo (never send)

**Files:**
- Create: `src/shared/pm-pilot/mime.ts`, `src/renderer/packages/pm-pilot/gmail-write.ts`
- Test: `src/shared/pm-pilot/mime.test.ts`, `src/renderer/packages/pm-pilot/gmail-write.test.ts` (msw)

**Interfaces:**
- Consumes: `ClientDraft`, `DRAFT_LABEL` (Task 1).
- Produces:
  - `buildReplyMime(input: { from: string; to: string; subject: string; inReplyTo?: string; body: string }): string` → base64url RFC 2822: `Content-Type: text/plain; charset="UTF-8"`, `Content-Transfer-Encoding: base64`, subject prefixed `Re: ` unless it already starts with `Re:` (case-insensitive), non-ASCII subject as `=?UTF-8?B?…?=`, `In-Reply-To` and `References` set when `inReplyTo` is given.
  - `ensureLabel(token: string, name: string): Promise<string>` (list, create if missing, cache id per token)
  - `writeDraft(token: string, draft: ClientDraft, from: string): Promise<{ gmailDraftId: string; gmailMessageId: string }>` → `POST drafts` with `{ message: { raw, threadId } }`, then `POST threads/{id}/modify` adding the `DRAFT_LABEL` id.
  - `undoDraft(token: string, draft: ClientDraft): Promise<'removed' | 'kept-edited' | 'already-gone'>` → `GET drafts/{id}`; 404 → `'already-gone'`; message id ≠ `draft.gmailMessageId` → `'kept-edited'` (no delete); else `DELETE drafts/{id}` and remove the label → `'removed'`.

- [ ] **Step 1: Write the failing tests:**
  - `mime.test.ts`: `encodes a Vietnamese subject` (decoded raw contains `Subject: =?UTF-8?B?` and decodes to `Re: Báo giá`); `does not double the Re: prefix`; `sets In-Reply-To and References`; `body round-trips UTF-8`.
  - `gmail-write.test.ts`: `writes a draft into the thread and labels it` (asserts request bodies: `threadId`, `addLabelIds`); `creates the label once`; `undo deletes an untouched draft and removes the label`; `undo keeps a draft the user edited` (Review Focus 2: `GET drafts/{id}` returns another message id → no `DELETE`, returns `'kept-edited'`); `never calls a send endpoint` (msw handler on `*/send` and `*/messages/import` fails the test; also `Object.keys(await import('./gmail-write'))` has no name matching `/send/i`).
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement `mime.ts` and `gmail-write.ts`.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pm-pilot): write labels and drafts into Gmail, undo safely`

### Task 4: Asana adapter

Kept from the old Task 4; `clientId` becomes `scopeId`, and `listProjects` now feeds slice 7's add-source sheet instead of client auto-creation.

**Files:**
- Create: `src/renderer/packages/pm-pilot/asana-adapter.ts`
- Test: `src/renderer/packages/pm-pilot/asana-adapter.test.ts` (msw on `https://app.asana.com/api/1.0/*`)

**Interfaces:**
- Consumes: `SourceRecord`, `SyncCursor`, `recordId` (Task 1).
- Produces:
  - `listAsanaProjects(token: string, workspaceGid?: string): Promise<Array<{ id: string; name: string }>>`
  - `syncAsanaProject(input: { accountId: string; sourceId: string; accessToken: string; projectGid: string; scopeId: string; cursor: SyncCursor | null }): Promise<{ records: SourceRecord[]; cursor: SyncCursor; deletedExternalIds: string[] }>`. Task → record (`externalId = gid`, `title = name`, `text = notes`, `status = completed ? 'done' : section name`, `link.url = permalink_url`); comment story → record (`threadOrTaskId = task gid`, `title = 'Comment on {task name}'`). No cursor → full read, then `GET /events?resource={gid}` (412 carries the `sync` token). Cursor → events, re-read named tasks, deleted tasks to `deletedExternalIds`. 412 on a stored token → full read. 429 → wait `Retry-After` (max 60 s) and retry once; second 429 throws `AsanaRateLimitedError`; 401 throws `AsanaAuthError`.

- [ ] **Step 1: Write the failing tests:** `maps tasks and comments to records with permalinks`, `obtains a sync token after the first full read`, `applies events incrementally and reports deleted tasks`, `does a full read when the sync token has expired (412)`, `retries once after 429 Retry-After, then throws` (fake timers), `listAsanaProjects returns id and name`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/pm-pilot/asana-adapter.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pm-pilot): add Asana source adapter`

### Task 5: Route a thread to a client scope, and the record store

Changed from the old Task 5: routing picks a connected Gmail source (and so its scope) instead of a client; unknown or ambiguous threads become one question instead of being silently dropped; the store keeps records per scope and has no client management.

**Files:**
- Create: `src/shared/pm-pilot/route.ts`, `src/renderer/packages/pm-pilot/store.ts`, `src/renderer/packages/pm-pilot/bridge.ts`
- Modify: `src/renderer/storage/StoreStorage.ts:6-72` (keys `PmCursors = 'pm-cursors'`, `PmDrafts = 'pm-drafts'`, `PmQuestions = 'pm-questions'`, `PmProcessed = 'pm-processed'`, `PmDraftCount = 'pm-draft-count'`; generator `pmRecords(scopeId) → \`pm:records:${scopeId}\``; add `PmDrafts`, `PmQuestions` to `immediateKeys`)
- Test: `src/shared/pm-pilot/route.test.ts`, `src/renderer/packages/pm-pilot/store.test.ts`

**Interfaces:**
- Consumes: Task 1 types.
- Produces:
  - `ownMatchers(ownAddress: string): { address: string; domain?: string }` — domain omitted when it is in `PUBLIC_MAIL_DOMAINS`.
  - `routeThread(records: SourceRecord[], sources: Array<{ id: string; scopeId: string; config: GmailSourceConfig }>, ownAddress: string): { type: 'noise' } | { type: 'own' } | { type: 'scope'; sourceId: string; scopeId: string } | { type: 'unknown'; domain: string; candidateScopeIds: string[] }` — noise when the newest inbound record is `noise`; `own` when no participant is outside the user's address/domain; one matching source → `scope`; two or more → `unknown` with those scopes; none → `unknown` with every source's scope. `domain` is the external sender's domain, or the full address for a public domain.
  - `bridge.ts`, the only file that imports other slices; later tasks and their tests import or mock `./bridge`:
    - scopes (3): `listClientScopes(): Promise<Scope[]>` and `getScope(id: string): Promise<Scope | undefined>` = `parseScopes(await getDefaultStore().get(myProjectsAtom))`, filtered to `kind === 'client'` for the first;
    - knowledge (4): re-exports `knowledgeForTurn`, `proposeKnowledge`, `approveProposal`;
    - review (1b, 5): re-exports `addReviewEntry`, `updateReviewEntry`, `setReviewEntryState`, `listReviewEntries`, `registerReviewOpener`, `registerReviewApplier`, `pushUndo`;
    - sources (7): re-exports `registerSourceAdapter`, `listSources`, `updateSource`, `NeedsUserError`, `JOB_FIX_LABELS`, types `ConnectedSource`, `SourceAdapter`, `SourceItem`; `gmailConfig(source: ConnectedSource): GmailSourceConfig` and `asanaConfig(source): { accountId: string; projectGid?: string }` parse `source.config` (missing `matchers` → `[]`).
  - `pmStore` (Zustand vanilla, persisted through `storage` from `@/storage`): `upsertRecords(records)` (requires `scopeId`, replaces by `id`), `deleteRecords(kind, externalIds)`, `removeSourceRecords(sourceId)`, `getRecords(scopeId)`, `getCursor(accountId, kind, scope)`, `setCursor(c)`, `markProcessed(accountId, messageId)` / `isProcessed(…)` (keeps the newest 5 000 per account), `saveDraft(d)`, `getDraft(id)`, `findDraftByThread(threadId)`, `saveQuestion(q)`, `findOpenQuestion({ domain } | { threadId })`, `countDraftsToday(now)`, `bumpDraftsToday(now)`.

- [ ] **Step 1: Write the failing tests:**
  - `route.test.ts`: `routes by domain`, `routes by exact address`, `two matching scopes is unknown with both as candidates` (Review Focus 4), `a newsletter is noise even from an unknown domain` (Review Focus 4), `mail only between the user's colleagues is own`, `a gmail.com client is keyed by full address`.
  - `store.test.ts` (TestPlatform storage): `upserting the same id twice keeps one record`, `refuses records without a scope`, `removeSourceRecords removes only that source`, `processed ids are capped at 5000`, `draft count resets at local midnight`, `state survives a reload`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement `route.ts`, `store.ts`, and `bridge.ts` (no logic beyond `getTrustLevel`).**
- [ ] **Step 4: Run.** Expected: PASS. Run `pnpm check`.
- [ ] **Step 5: Commit** `feat(pm-pilot): route threads to client scopes and store records`

### Task 6: Retrieve and judge

Changed from the old Task 6: ledger derivation is gone; the same evidence check now guards the judge, and approved knowledge from slice 4 is evidence beside the records.

**Files:**
- Create: `src/shared/pm-pilot/judge.ts`, `src/renderer/packages/pm-pilot/retrieve.ts`, `src/renderer/packages/pm-pilot/judge-call.ts`, `src/renderer/packages/pm-pilot/prompts.ts`
- Test: `src/shared/pm-pilot/judge.test.ts`, `src/renderer/packages/pm-pilot/retrieve.test.ts`

**Interfaces:**
- Consumes: `pmStore.getRecords` (Task 5); `knowledgeForTurn` via `bridge.ts`; `generateText`, `getModel`, `createModelDependencies` (pattern of `src/renderer/packages/memory/extract.ts:59-96`).
- Produces:
  - `type Judgement = { intent: 'question' | 'fyi' | 'noise'; summary: string; answer?: string; evidenceIds: string[]; confidence: number; candidates: Array<{ value: string; evidenceIds: string[] }> }`
  - `parseJudgement(text: string): Judgement | null` (strip fences; invalid → `null`)
  - `validateJudgement(j: Judgement, given: Set<string>): Judgement` — drops evidence ids not in `given`; drops candidates left without evidence.
  - `tierFor(j: Judgement): Tier` — two or more distinct candidates → `low`; no `answer` or no evidence → `low`; `confidence ≥ HIGH_CONFIDENCE` → `high`; `≥ MEDIUM_CONFIDENCE` → `medium`; else `low`.
  - `retrieveEvidence(input: { scopeId: string; inbound: SourceRecord; localOnlySourceIds: Set<string>; cloudModel: boolean }): Evidence[]` — scope records outside the inbound thread, lexical token overlap with the inbound text, top `RETRIEVE_MAX_RECORDS`, skipping local-only sources on a cloud model; then every `knowledgeForTurn(scopeId)` item.
  - `buildJudgePrompt(scopeName: string, inbound: SourceRecord, evidence: Evidence[]): { system: string; user: string }` — evidence listed with ids; JSON reply shape of `Judgement`; answer only from evidence; `summary` is one sentence in the thread's language.
  - `judgeThread(input: { scopeName: string; inbound: SourceRecord; evidence: Evidence[] }): Promise<{ judgement: Judgement | null; error?: string }>` — never throws.

- [ ] **Step 1: Write the failing tests:**
  - `judge.test.ts`: `drops evidence ids that were not given` (Review Focus 3), `an answer left without evidence is low`, `two different candidates are low`, `0.9 with evidence is high, 0.7 is medium, 0.5 is low`, `parseJudgement returns null for prose and strips code fences`.
  - `retrieve.test.ts` (bridge mocked): `returns matching records from the same scope only`, `excludes the inbound thread`, `skips local-only sources when the model is cloud`, `includes approved knowledge with k: ids`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pm-pilot): retrieve evidence and judge client threads`

### Task 7: Sent replies read back; fact changes become proposals

New (flow 10 step 5).

**Files:**
- Create: `src/shared/pm-pilot/fact-diff.ts`, `src/renderer/packages/pm-pilot/sent-readback.ts`
- Test: `src/shared/pm-pilot/fact-diff.test.ts`, `src/renderer/packages/pm-pilot/sent-readback.test.ts`

**Interfaces:**
- Consumes: `pmStore.findDraftByThread`, `saveDraft` (Task 5); `proposeKnowledge`, `listReviewEntries`, `updateReviewEntry` via `bridge.ts`.
- Produces:
  - `extractFactTokens(text: string): { dates: string[]; numbers: string[]; names: string[] }` — dates `6 Nov` / `Nov 6` / `6/11` / `ngày 6 tháng 11` normalised to `6-11`; numbers of 2+ digits with `,` and `.` thousands separators removed (`9,100` and `9.100` → `9100`), excluding digits inside dates; names = `\p{Lu}\p{Ll}+` words not starting a sentence and not a month, weekday or greeting; text after a sign-off line (`Best`, `Thanks`, `Regards`, `Cheers`, `Trân trọng`, `Cảm ơn`) ignored.
  - `sentDiffText(scopeName: string, sent: string, draft: string, what: string): string` (copy in Global Constraints)
  - `factsDiffer(a: string, b: string): boolean` — any category's sets differ.
  - `phraseFactChanges(input: { draft: string; sent: string; scopeName: string }): Promise<Array<{ what: string; fact: string; draftSaid: string; sentSaid: string }>>` — one model call; each item kept only if `sentSaid` occurs in `sent` and `draftSaid` in `draft`.
  - `proposeFactChanges(input: { draft: ClientDraft; sentText: string; sentRecord?: SourceRecord; scopeName: string }): Promise<number>` — no model call when `factsDiffer` is false; else for each change `proposeKnowledge({ scopeId, kind: 'fact', text: fact, sources: [{ kind: 'email', label: 'your sent reply', ref: link }], origin: 'background-review' })` (slice 4 adds the Proposal or Conflict entry); when the returned proposal has no `conflictsWith`, set the `sub` of the open entry with `ref: { type: 'proposal', id }` to `sentDiffText(...)`.
  - `readBackSent(records: SourceRecord[]): Promise<void>` — for each `sentByMe` record in a thread with a `written` or `proposed` draft created before it: run `proposeFactChanges`, set the draft `sent` (or `dismissed` when it was only proposed, closing its entry).

- [ ] **Step 1: Write the failing tests:**
  - `fact-diff.test.ts`: `a reworded reply with the same facts does not differ` (`Launch is on 4 Nov.` vs `We're launching 4 Nov, as planned!`), `a changed date differs` (`4 Nov` vs `6 Nov`), `9,100 equals 9.100`, `Vietnamese dates normalise` (`ngày 6 tháng 11` equals `6/11`), `a changed sign-off name does not differ`.
  - `sent-readback.test.ts`: `no model call when facts match`; `a changed date proposes the new fact and notes it on slice 4's entry` (`updateReviewEntry` called with `sub: 'You told Acme Co 6 Nov; the draft said 4 Nov. Save 6 Nov as the launch date?'`); `drops a change whose values are not in both texts` (Review Focus 3); `a conflicting proposal gets no note`; `marks the draft sent`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pm-pilot): read sent replies back and propose changed facts`

### Task 8: Act by tier: entries, the draft applier and opener

New (the old plan's phases 2 and 3). Trust is slice 5's: this task only says which entries are safe.

**Files:**
- Create: `src/shared/pm-pilot/act.ts`, `src/shared/pm-pilot/copy.ts`, `src/renderer/packages/pm-pilot/act-call.ts`, `src/renderer/packages/pm-pilot/DraftEditSheet.tsx`
- Test: `src/shared/pm-pilot/act.test.ts`, `src/shared/pm-pilot/copy.test.ts`, `src/renderer/packages/pm-pilot/act-call.test.ts`, `src/renderer/packages/pm-pilot/DraftEditSheet.test.tsx` (`@vitest-environment jsdom`)

**Interfaces:**
- Consumes: Tasks 3, 5, 6, 7 (`proposeFactChanges`); `getFreshToken` (Task 2); `addReviewEntry`, `updateReviewEntry`, `setReviewEntryState`, `registerReviewApplier`, `registerReviewOpener`, `pushUndo` via `bridge.ts`; `Sheet` from `@/components/ui/Sheet`.
- Produces:
  - `entryShapeForTier(input: { tier: Tier; draftsToday: number; localOnlyBlocked: boolean }): { kind: 'proposal'; risk: 'safe' | 'risky' } | { kind: 'needs-you' }` — `localOnlyBlocked` or `low` → needs-you; `high` and `draftsToday < DAILY_DRAFT_CAP` → safe proposal; otherwise risky proposal.
  - `copy.ts`: `draftProposalEntry(d: ClientDraft)`, `doneDraftPatch(d: ClientDraft): { text: string; sub: string }`, `needsYouEntry(q: ClientQuestion)`, `ch6Opening(q: ClientQuestion, scopeName: string)`, `countWord(n: number)`, `joinLabels(labels: string[])`, returning the Global Constraints copy (entries as `ReviewEntryInput`).
  - `writeDraftText(input: { inbound: SourceRecord; answer: string; evidence: Evidence[] }): Promise<string>` — default chat model; the language of the client's last message; grounded only on the evidence; no source list in the body (it would reach the client).
  - `actOnThread(input: { scope: Scope; inbound: SourceRecord; judgement: Judgement; evidence: Evidence[]; localOnlyBlocked: boolean }): Promise<'drafted' | 'asked' | 'ignored'>` — `fyi`/`noise` → `ignored`; a proposal shape → draft text, `saveDraft` (`state: 'proposed'`), `addReviewEntry({ ...draftProposalEntry(d), ...shape })`, and when the stored entry comes back `kind: 'done'` (Trust arrival applied it) `updateReviewEntry(id, doneDraftPatch(d))`; needs-you → a `which-answer` `ClientQuestion` and `addReviewEntry(needsYouEntry(q))` with `ref: { type: 'question', id }`.
  - `draftApplier: { apply(e: ReviewEntry): Promise<void>; undo(e: ReviewEntry): Promise<void> }` is the one path that writes a draft into Gmail and the one that takes it back: slice 5 calls it for Trust Auto arrival and for Apply / A on a waiting draft (via `getReviewApplier`, then Done with Undo), and the edit sheet calls it too; its `undo` serves all three. `apply`: load the draft by `e.ref.id`; when `e.text` differs from the stored body it is an edit (save it, then `proposeFactChanges` against the original); `writeDraft`; `bumpDraftsToday`; state `written`; `updateReviewEntry(e.id, doneDraftPatch(d))` (resolves `undefined` before the arrival row exists, which is fine). `undo`: `undoDraft`; `'removed'` or `'already-gone'` → state `undone` and the entry text back to the draft body; `'kept-edited'` → throw `Error('kept-edited')`, so 1b keeps the row Done and shows its "Couldn't undo" toast.
  - `openDraftEntry(e: ReviewEntry): void` — Done → `platform.openLink` on the thread; proposal → opens `DraftEditSheet` (copy in Global Constraints), whose Apply calls `updateReviewEntry(e.id, { text })`, `draftApplier.apply`, `setReviewEntryState({ id: e.id }, 'done')` and `pushUndo({ message: 'Reply drafted in Gmail', undo: () => draftApplier.undo(e) })`.
  - `initPmReview(): void` — `registerReviewApplier('draft', draftApplier)`, `registerReviewOpener('draft', openDraftEntry)`.

- [ ] **Step 1: Write the failing tests:**
  - `act.test.ts` table for `entryShapeForTier`: high/0 → safe proposal; high/20 → risky (cap); medium → risky; low → needs-you; high with `localOnlyBlocked` → needs-you.
  - `copy.test.ts`: `doneDraftPatch` gives `Reply drafted in Gmail: launch is 4 Nov, per Asana "Launch plan" and your 2 Oct email.` with sub `Draft is in the thread, not sent`; `draftProposalEntry` has `actionLabel: 'Apply'` and `ref.type: 'draft'`; `needsYouEntry` for two candidates gives source `two candidates` and `Client asks for the revised quote. I found 8,400 (12 Sep) and 9,100 (30 Sep). Which is current?`; `ch6Opening` ends with `Pick one, or type the answer. I'll save it for Acme Co and draft the reply.`
  - `act-call.test.ts` (Gmail write, model and bridge mocked): `high adds a safe draft proposal and does not write to Gmail itself`; `when arrival returns done, the Done copy is written onto the entry`; `medium adds a risky proposal`; `low adds one Needs you entry and a question`; `apply with an edited entry text writes the edited text and proposes changed facts`; `undo of a draft edited in Gmail throws and keeps it` (Review Focus 2); `initPmReview registers the draft applier and opener`; `undo works the same after an Auto arrival and after a user's Apply` (one written draft each, `undo` removes both).
  - `DraftEditSheet.test.tsx`: `Apply writes the edited text, closes and pushes an undo`; `Cancel changes nothing`; `first focus is the text area`.
- [ ] **Step 2: Run** the four files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(pm-pilot): draft entries by tier with a Gmail applier`

### Task 9: Source adapters, pipeline and the local-only switch

Changed from the old Task 7: slice 7 owns the Gmail and Asana kinds (sign-in, reconnect, revoke), polling, retries and job display; this task registers their adapters and runs flow 10 inside the Gmail sync.

**Files:**
- Create: `src/renderer/packages/pm-pilot/pipeline.ts`, `src/renderer/packages/pm-pilot/adapters.ts`, `src/renderer/packages/pm-pilot/index.ts`
- Modify: slice 7's `SourceRow` (`src/renderer/components/sources/SourceRow.tsx`): a "Keep on this device only" switch for `gmail` and `asana` rows
- Test: `src/renderer/packages/pm-pilot/pipeline.test.ts`, `src/renderer/packages/pm-pilot/adapters.test.ts`, `src/renderer/components/sources/SourceRow.localOnly.test.tsx` (`@vitest-environment jsdom`)

**Interfaces:**
- Consumes: everything above; `initPmReview` (Task 8).
- Produces:
  - `isLocalModelProvider(providerId: string): boolean` (Ollama, LM Studio).
  - `runGmailPipeline(source: ConnectedSource, ctx: { signal: AbortSignal; progress(text: string): void; now?: number }): Promise<{ summary: string }>` — one mailbox sync per account per tick (a memoised promise shared by that account's Gmail sources; `backfillQuery` = `buildMatcherQuery` over the union of their matchers); route each touched thread; upsert records with `scopeId`/`sourceId`; `readBackSent`; then for at most `PIPELINE_MAX_THREADS_PER_TICK` threads whose newest inbound message is not processed, not noise, and has `occurredAt > source.connectedAt`: retrieve, judge, `actOnThread`; mark processed. `unknown` → one `which-client` question per domain (`scopeId: null`, entry `scopeId: EVERYWHERE_SCOPE_ID`, `options` = the candidate scopes). A local-only source on a cloud model → one local-only Needs you entry per source, no model call. Records of sources no longer in `listSources({ kind })` are removed (slice 7's revoke has no hook for slice 10). A failed token or `GmailAuthError` → `throw new NeedsUserError('sign in again', { action: 'reconnect', label: JOB_FIX_LABELS.reconnect })`. Summary: `Checked {n} new emails` (`n` = threads acted on or stored this run).
  - A new Gmail source starts with no `matchers`: its first threads arrive as "Which client is this?" questions, and answering one (Task 11) adds the matcher. `backfillMatcher(source: ConnectedSource, matcher: string): Promise<number>` runs a one-off `syncGmailMailbox` with `cursor: null` and that matcher's query, stores the records, leaves the account cursor alone, and acts on nothing. *As built: there is no separate `backfillMatcher` export. Answering "Which client is this?" stores a pending backfill on the question, and the jobs window runs it inside that account's next Gmail run, under the same rules.*
  - `syncAsanaSource(source: ConnectedSource, ctx: { signal: AbortSignal; progress(text: string): void }): Promise<{ summary: string }>` — no `projectGid` → one `which-project` question (`options` from `listAsanaProjects`) and summary `Waiting for you to pick an Asana project`; else `syncAsanaProject` + store, summary `Synced {n} tasks and comments`. `AsanaAuthError` → `NeedsUserError('sign in again', reconnect)`.
  - `readSourceItems(source: ConnectedSource, ctx: { signal: AbortSignal; cursor: string | null }): Promise<{ items: SourceItem[]; cursor: string | null }>` — records newer than the cursor (ms as string), up to 40, `ref` = record id, `label` = title; local-only sources on a cloud model return none (slice 7's background review).
  - `registerPmAdapters(): void` — `registerSourceAdapter('gmail', { pollMs: GMAIL_POLL_MS, sync: runGmailPipeline, read: readSourceItems })`, `registerSourceAdapter('asana', { pollMs: ASANA_POLL_MS, sync: syncAsanaSource, read: readSourceItems })`, then `initPmReview()`.
  - `getSourceHealth(sourceId: string): { ok: true; lastSyncAt?: number } | { ok: false; message: string }`, set at the end of every sync (in memory).
  - `SourceRow` switch: label `Keep on this device only`, help `Emails and tasks from this source are never sent to a cloud model`, calls `updateSource(id, { localOnly })`.
  - `index.ts` re-exports `registerPmAdapters`, `getSourceHealth` (Task 11 adds `initPmQuestions`).

- [ ] **Step 1: Write the failing tests** (bridge, Gmail and model mocked):
  - `pipeline.test.ts`: `backfilled mail is stored but not acted on` (Review Focus 1: 30 records older than `connectedAt` → 0 judge calls); `a message processed once is not judged again after a history reset`; `acts on at most 10 threads per tick`; `two unknown threads from one domain make one question` (Review Focus 4); `a source without matchers asks which client and acts on nothing`; `local-only source on a cloud model makes one Needs you and no model call`; `an expired sign-in throws NeedsUserError with the reconnect fix`; `records of a removed source are pruned`; `backfillMatcher stores records and judges nothing`.
  - `adapters.test.ts`: `registers gmail and asana adapters with their poll intervals`; `Asana without a project asks which project once`; `read skips local-only sources on a cloud model`.
  - `SourceRow.localOnly.test.tsx`: `the switch shows for Gmail and Asana only`; `toggling it calls updateSource with localOnly`.
- [ ] **Step 2: Run** the three files. Expected: FAIL.
- [ ] **Step 3: Implement**, and call `registerPmAdapters()` where slice 7 registers its kinds (after them; desktop only).
- [ ] **Step 4: Run.** Expected: PASS. Run `pnpm check`.
- [ ] **Step 5: Commit** `feat(pm-pilot): Gmail and Asana adapters run flow 10`

### Task 10: `client_recall` chat tool

Changed from the old Task 8: no ledger (approved knowledge already reaches the turn through `knowledgeForTurn`); the tool searches the client scope's email and tasks and states gaps. Still needed because records are not knowledge.

**Files:**
- Create: `src/renderer/packages/pm-pilot/recall.ts`, `src/renderer/packages/model-calls/toolsets/pm-pilot.ts`
- Modify: `src/renderer/packages/model-calls/stream-text.ts:469-530` and `:839-844` (load the toolset beside `kbToolSet`, add to `hasFunctionTools`, merge into `tools`), `src/renderer/packages/model-calls/stream-text.test.ts` (mock the toolset)
- Test: `src/renderer/packages/pm-pilot/recall.test.ts`

**Interfaces:**
- Consumes: `pmStore`, `listClientScopes`, `listSources` (Task 5), `getSourceHealth` (Task 9).
- Produces:
  - `resolveClientScope(nameOrId: string | undefined, sessionScopeId: string | undefined, scopes: Scope[]): { ok: true; scope: Scope } | { ok: false; code: 'ambiguous_client' | 'unknown_client' | 'no_client_given'; candidates: Array<{ id: string; name: string }> }` — omitted name uses the session's scope when it is a client scope; otherwise case-insensitive contains/id match over `kind === 'client'` scopes.
  - `recallClient(input: { client?: string; query: string; sessionScopeId?: string; cloudModel: boolean; limit?: number }): Promise<ClientRecallResult>`; `ClientRecallResult = { ok: true; scope: { id: string; name: string }; records: Array<{ title: string; text: string; link: { label: string; url: string }; occurredAt: number }>; gaps: string[] } | { ok: false; code; candidates }` — default `limit = 8`; gaps: `Gmail: sign in again — results may be out of date` for a failing source, `Gmail stays on this device, so it was not searched` for local-only on a cloud model, `No email or tasks synced yet` when empty.
  - `pmToolSet(ctx: { sessionScopeId?: string; cloudModel: boolean }): { description: string; tools: { client_recall: Tool } }`, enabled when any client scope has a Gmail or Asana source. Description: ask the user which client on `ambiguous_client` or `no_client_given`, cite links, state gaps.

- [ ] **Step 1: Write the failing tests:** `uses the chat's client scope when no name is given`, `returns ambiguous_client with candidates when two names match`, `never returns another scope's records`, `lists a failing source as a gap`, `skips local-only records on a cloud model and says so`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/pm-pilot/recall.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `recall.ts`, the toolset, and register it in `stream-text.ts`.**
- [ ] **Step 4: Run** the test, then `pnpm test -- src/renderer/packages/model-calls/stream-text.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(pm-pilot): answer client questions in chat from email and tasks`

### Task 11: Needs you as a chat (CH6) and `client_answer`

New. Replaces slice 5's default `'question'` opener (which only prefills a new chat) with one that opens the CH6 chat.

**Files:**
- Create: `src/renderer/packages/pm-pilot/answer.ts`
- Modify: `src/renderer/packages/model-calls/toolsets/pm-pilot.ts` (add `client_answer`), `src/renderer/packages/pm-pilot/index.ts`
- Test: `src/renderer/packages/pm-pilot/answer.test.ts`

**Interfaces:**
- Consumes: `ch6Opening`, `actOnThread` (Task 8); `backfillMatcher`, `runGmailPipeline` (Task 9); `createSession`, `getSession` from `@/stores/chatStore`; `createMessage` from `@shared/types`; `proposeKnowledge`, `approveProposal`, `setReviewEntryState`, `registerReviewOpener`, `updateSource`, `getScope` (bridge).
- Produces:
  - `openClientQuestion(questionId: string): Promise<string>` — returns the session id; the first call creates a session named after the thread subject with `projectId` = the question's scope (none for `which-client`) and one assistant message: `ch6Opening` for `which-answer`; for `which-client`, `Which client is this? {from} wrote about "{subject}".`, one line per candidate scope, then `Pick one and I'll file this thread and others from {domain} there.`; for `which-project`, `Which Asana project is {scope name}?`, one line per project, then `Pick one and I'll read its tasks for {scope name}.` Later calls reopen the same session.
  - `initPmQuestions(): void` — `registerReviewOpener('question', (e) => openClientQuestion(e.ref.id).then(navigateToSession))`; called by `registerPmAdapters` after `initPmReview`.
  - `pmToolSet` gains `client_answer`, present only when the session belongs to an open question. Input `{ answer: string; fact?: string; choice?: string }` (`choice` = a candidate's scope id or project gid).
    - `which-answer`: `proposeKnowledge({ scopeId, kind: 'fact', text: fact, sources: [{ kind: 'user', label: 'your answer in chat' }, …the chosen candidate's sources], origin: 'user' })`, then `approveProposal(id, { text: fact })` (the user wrote it; slice 4 pushes its own undo); draft the reply with the answer as evidence through `actOnThread` as `high` (Trust and the cap still apply); question `answered`; `setReviewEntryState({ ref: { type: 'question', id } }, 'done')`.
    - `which-client`: `choice` must be a candidate scope; add `@{domain}` (or the address) to that scope's Gmail source `matchers` with `updateSource`; `backfillMatcher`; re-run `runGmailPipeline` for that source; question `answered`; entry `done`.
    - `which-project`: `choice` must be one of the listed projects; `updateSource(sourceId, { config: { ...config, projectGid: choice } })`; question `answered`; entry `done`. Slice 7 syncs it on the next poll.

- [ ] **Step 1: Write the failing tests:** `opens one chat per question with the CH6 opening` (assert the first message text for the 8,400 / 9,100 fixture); `the question opener is registered and opens that chat`; `answering approves the user's fact in the question's scope and adds a safe draft proposal`; `which-client adds the domain to the chosen scope, backfills it and re-runs routing`; `which-project stores the project on the source`; `client_answer is absent in an ordinary chat`; `rejects a choice that was not a candidate`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/pm-pilot/answer.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run**, then `pnpm test`, `pnpm check`, `pnpm lint`. Expected: PASS, no new type errors.
- [ ] **Step 5: Manual check** (`pnpm dev`, macOS): add Gmail and Asana to a client scope from Settings › Sources; answer "Which Asana project is …?" and "Which client is this?" from Review; send yourself a client-style question from that domain whose answer is in an Asana task. Expected under Trust Auto: a Done item `Reply drafted in Gmail: …` and a draft in the thread, nothing sent; Undo removes it. Under Ask: the next one waits with Apply; ↵ opens the edit sheet. Sending the draft from Gmail with a changed date gives a Proposal noted `You told …`.
- [ ] **Step 6: Commit** `feat(pm-pilot): answer Needs you items in chat`

---

## Contract questions (for the roadmap owner)

Answered by the roadmap's Contract register and Decisions on 2026-10-17; notes on the last points:

1. **E on a draft proposal** (resolved): slice 10 registers no renderer. Slice 5's default renderer calls `openReviewEntry` for E when a row has no Edit of its own, so E and ↵ both reach the `'draft'` opener's edit sheet; RV1's draft row needs nothing the default lacks.
2. **Slice 3 has no plain accessor** beside the `useScopes()` hook; the bridge reads `myProjectsAtom` through `getDefaultStore()` and `parseScopes`. A `getScopes()` export from slice 3 would replace those two lines.
3. **Slice 7's adapter has no remove hook and the Gmail kind has no matcher field.** Slice 10 prunes records of removed sources on each sync, and learns a Gmail source's matchers from "Which client is this?" answers. The adapters use slice 7's names as given (`pollMs`, `sync(source, { signal, progress })`, `read(source, { signal, cursor })`, `updateSource(id, { config })`), so slice 7's mapping question 2 is stale.
