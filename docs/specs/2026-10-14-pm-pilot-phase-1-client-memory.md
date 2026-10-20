---
type: plan
status: deprecated
description: "PM Pilot Phase 1: Client Memory Implementation Plan"
---
# PM Pilot Phase 1: Client Memory Implementation Plan

Superseded by [slice 10](2026-10-17-slice-10-pm-pilot-sources.md) on 2026-10-17.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sync a PM's Gmail and Asana into a per-client, source-linked ledger and let them ask "what's open with client X?" in any chat and get an answer with links and honest gaps.

**Architecture:** Pure logic (types, normalisers, client assignment, ledger validation) lives in `src/shared/client-memory/`. I/O (HTTP sync, persistence, model calls, background runner, chat tool) lives in `src/renderer/packages/client-memory/`. Auth reuses the existing Integrations accounts, secret store and `ensureFreshSecret`; no new OAuth code. A background runner polls Gmail `history.list` and the Asana Events API while the app is open, stores work records per client, and derives ledger entries with the user's configured model.

**Tech Stack:** TypeScript, Zod, ofetch, Vercel AI SDK via `@/packages/model-calls` `generateText`, Zustand/Jotai for status, Mantine for the settings page, Vitest + msw for tests.

**Spec:** `docs/specs/2026-10-13-pm-pilot-design.md` (sections Charter, 1, 2; parts of 4 and 5). Decision record: `docs/adr/0010-pm-pilot-first-user.md`.

**Out of this plan:** the inbox pipeline (labels, drafts), first-run screens and the Advanced settings split. They get their own plans (phase 2, phase 3) once this lands.

## Global Constraints

- Never send email. No code path in this plan calls a Gmail send or draft endpoint; the Gmail client exposes read operations only in phase 1.
- Nothing synced or derived becomes approved knowledge (ADR 0001). Ledger entries are reference material.
- One project per client; client-specific material never answers a question about another client (ADR 0002).
- A source marked local-only is never sent to a cloud model (ADR 0003). Derivation for it is skipped and reported as a coverage gap.
- No user data goes to a server the maintainer runs.
- Auth: reuse `src/shared/integrations` accounts. Gmail uses the `google_workspace` connector with the `mail` scope pack; Asana uses the `asana` connector (PAT or OAuth).
- Code style per `AGENTS.md`: Biome, single quotes, no semicolons, `camelCase.ts` utilities, `PascalCase.tsx` components, English copy, barrel `index.ts` per domain folder.
- Commit messages: `feat(client-memory): …`. Commits require the user's go-ahead in this checkout (git cannot remove lock files in the connected folder until delete permission is granted).

## Review Focus

1. **Gmail history ID expired** (app closed for over a week; `history.list` returns 404) → sync falls back to the backfill window and continues; no crash, no silent gap. Test in Task 3.
2. **Email that matches two clients or none** (cc to two client domains; a newsletter) → stays unassigned and never enters any client's records. Test in Task 5.
3. **Model cites a record it was not given** (hallucinated source id in the derivation output) → that entry is dropped, never stored. Test in Task 6.
4. **Account needs re-auth mid-sync** (`ensureFreshSecret` returns `needs_reauth`) → that source shows an error status, other sources keep syncing, recall lists it as a gap. Tests in Tasks 7 and 8.
5. **Vietnamese, HTML-only and quoted-reply emails** → normaliser keeps diacritics, extracts text from HTML-only bodies, and drops the quoted earlier message. Test in Task 2.

---

### Task 1: Domain types

**Files:**
- Create: `src/shared/client-memory/types.ts`, `src/shared/client-memory/index.ts`
- Test: `src/shared/client-memory/types.test.ts`

**Interfaces:**
- Produces (Zod schema + inferred type for each):
  - `SourceKind = 'gmail' | 'asana'`
  - `SourceLink = { label: string; url: string }`
  - `WorkRecord = { id: string; source: SourceKind; accountId: string; externalId: string; threadOrTaskId: string; clientId: string | null; author: string; participants: string[]; occurredAt: number; title: string; text: string; status?: string; link: SourceLink }`
  - `Client = { id: string; name: string; trackerProjectRefs: Array<{ accountId: string; projectId: string }>; emailMatchers: string[]; createdAt: number }` (`emailMatchers` holds `@domain.com` or `exact@address.com`)
  - `LedgerKind = 'qa' | 'decision' | 'commitment' | 'open_item'`
  - `LedgerEntry = { id: string; clientId: string; kind: LedgerKind; text: string; question?: string; answer?: string; sourceRecordIds: string[]; derivedAt: number }`
  - `SyncCursor = { accountId: string; source: SourceKind; scope: string; value: string; updatedAt: number }` (`scope` = `'mailbox'` for Gmail, the project GID for Asana)
  - `SourceStatus = { accountId: string; source: SourceKind; state: 'idle' | 'syncing' | 'error' | 'needs_reauth' | 'blocked_local_only'; lastSyncAt?: number; message?: string }`
  - `SourceSyncResult = { records: WorkRecord[]; cursor: SyncCursor; deletedExternalIds: string[] }` (plain type, no schema)
  - `workRecordId(source: SourceKind, externalId: string): string` → `` `${source}:${externalId}` ``

- [ ] **Step 1: Write the failing tests**

`types.test.ts`: `WorkRecordSchema` parses a valid record and rejects one missing `link`; `workRecordId('gmail', 'abc')` returns `'gmail:abc'`; `LedgerEntrySchema` rejects an empty `sourceRecordIds` array (`.min(1)`).

- [ ] **Step 2: Run** `pnpm test -- src/shared/client-memory/types.test.ts` — expected FAIL (module not found).
- [ ] **Step 3: Implement the schemas and `workRecordId` in `types.ts`; re-export from `index.ts`.**
- [ ] **Step 4: Run the test** — expected PASS. Run `pnpm check` — expected no new errors.
- [ ] **Step 5: Commit** (with user go-ahead): `feat(client-memory): add domain types`

### Task 2: Gmail normaliser

**Files:**
- Create: `src/shared/client-memory/gmail-normalize.ts`
- Create fixtures: `test/fixtures/client-memory/gmail/plain.json`, `html-only.json`, `quoted-reply.json`, `vietnamese.json` (Gmail API `users.threads.get?format=full` responses, anonymised)
- Test: `src/shared/client-memory/gmail-normalize.test.ts`

**Interfaces:**
- Consumes: `WorkRecord`, `workRecordId` (Task 1)
- Produces:
  - `type GmailMessage` / `type GmailThread`: the subset of the Gmail API shape used (`id`, `threadId`, `internalDate`, `payload.headers`, `payload.parts`, `payload.body.data`)
  - `normalizeGmailThread(thread: GmailThread, accountId: string): WorkRecord[]` — one record per message, `clientId: null` (assignment is Task 5), `link.url = https://mail.google.com/mail/#all/{threadId}`, `title` = Subject, `author` = From address, `participants` = From/To/Cc addresses lower-cased.
  - `extractNewText(body: string): string` — drops quoted history.

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps Vietnamese diacritics', () => {
  const [r] = normalizeGmailThread(vietnamese, 'acc1')
  expect(r.text).toContain('Chúng tôi đã cập nhật thiết kế')
})
it('extracts text from HTML-only bodies', () => {
  const [r] = normalizeGmailThread(htmlOnly, 'acc1')
  expect(r.text).toContain('Can you confirm the launch date?')
  expect(r.text).not.toContain('<')
})
it('drops quoted earlier messages', () => {
  const records = normalizeGmailThread(quotedReply, 'acc1')
  expect(records[1].text).not.toMatch(/^>/m)
  expect(records[1].text).not.toContain('On Mon, 1 Sep 2026')
})
it('builds ids and links from Gmail ids', () => {
  const [r] = normalizeGmailThread(plain, 'acc1')
  expect(r.id).toBe(`gmail:${plain.messages[0].id}`)
  expect(r.link.url).toBe(`https://mail.google.com/mail/#all/${plain.id}`)
})
```

- [ ] **Step 2: Run** `pnpm test -- src/shared/client-memory/gmail-normalize.test.ts` — expected FAIL.
- [ ] **Step 3: Implement.** Decode base64url as UTF-8 (`TextDecoder`, not `atob` alone, or diacritics break). Prefer `text/plain` parts; fall back to `text/html` stripped with `DOMParser` when available, regex tag strip otherwise. `extractNewText` cuts at the first line matching `^On .+ wrote:$`, `^Vào .+ đã viết:$`, or a run of `>`-prefixed lines.
- [ ] **Step 4: Run the test** — expected PASS.
- [ ] **Step 5: Commit**: `feat(client-memory): normalise Gmail threads into work records`

### Task 3: Gmail sync

**Files:**
- Create: `src/renderer/packages/client-memory/gmail-sync.ts`
- Test: `src/renderer/packages/client-memory/gmail-sync.test.ts` (msw handlers on `https://gmail.googleapis.com/gmail/v1/users/me/*`)

**Interfaces:**
- Consumes: `normalizeGmailThread` (Task 2), `SyncCursor`, `WorkRecord`, `SourceSyncResult` (Task 1)
- Produces:
  - `GMAIL_BACKFILL_DAYS = 90`
  - `syncGmail(input: { accountId: string; accessToken: string; cursor: SyncCursor | null; matcherQuery: string; now?: number }): Promise<SourceSyncResult>`
    - `cursor === null` → backfill: `messages.list?q=after:{epochSec} ({matcherQuery})`, fetch each distinct thread, new cursor = `profile.historyId`.
    - otherwise → `history.list?startHistoryId=…&historyTypes=messageAdded`, fetch touched threads, new cursor = response `historyId`.
    - `history.list` 404 → treat as `cursor === null` (backfill), same call.
  - `buildMatcherQuery(clients: Client[]): string` → `from:(@a.com OR x@b.com) OR to:(…)`; empty string when no matchers (sync then fetches nothing).
- No send or draft functions in this module.

- [ ] **Step 1: Write the failing tests**
  - `backfills when there is no cursor` — asserts the `q` parameter contains `after:` and the matcher query, returns records from both mocked threads, cursor value equals the mocked profile `historyId`.
  - `syncs incrementally from history` — mocked history with one `messageAdded`; returns that thread's records only.
  - `falls back to backfill when the history id has expired` — history endpoint returns 404; asserts `messages.list` was called and a cursor is returned (Review Focus 1).
  - `fetches nothing when no client has matchers` — no request to `messages.list`.
  - `buildMatcherQuery` returns `''` for no clients and the OR-joined form for two.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/client-memory/gmail-sync.test.ts` — expected FAIL.
- [ ] **Step 3: Implement `syncGmail` and `buildMatcherQuery` with `ofetch`** (bearer header; page through `nextPageToken`; fetch threads with concurrency 5).
- [ ] **Step 4: Run the test** — expected PASS.
- [ ] **Step 5: Commit**: `feat(client-memory): sync Gmail via history polling`

### Task 4: Work-tracker interface and Asana adapter

**Files:**
- Create: `src/shared/client-memory/tracker.ts` (interface), `src/renderer/packages/client-memory/asana-adapter.ts`
- Test: `src/renderer/packages/client-memory/asana-adapter.test.ts` (msw on `https://app.asana.com/api/1.0/*`)

**Interfaces:**
- Consumes: `WorkRecord`, `SyncCursor`, `SourceSyncResult`, `workRecordId` (Task 1)
- Produces:
  - `interface WorkTrackerAdapter { source: SourceKind; listProjects(accessToken: string): Promise<Array<{ id: string; name: string }>>; syncProject(input: { accountId: string; accessToken: string; projectId: string; clientId: string; cursor: SyncCursor | null }): Promise<SourceSyncResult> }`
  - `asanaAdapter: WorkTrackerAdapter`
    - Task → record: `externalId = task.gid`, `title = name`, `text = notes`, `status = completed ? 'done' : section/assignee_status`, `link.url = permalink_url`.
    - Comment story → record: `externalId = story.gid`, `threadOrTaskId = task gid`, `title = 'Comment on {task name}'`, `text = story.text`.
    - `cursor === null` → full read (`/projects/{gid}/tasks?opt_fields=…`, stories per task), then `GET /events?resource={gid}` without sync to obtain a token (Asana answers 412 with `sync`).
    - With cursor → `GET /events?resource={gid}&sync={token}`; re-read only tasks named in events; deleted tasks go to `deletedExternalIds`.
    - 412 on a stored token → full read (as `cursor === null`).
    - 429 → wait `Retry-After` seconds (max 60) and retry once; second 429 throws `RateLimitedError`.

- [ ] **Step 1: Write the failing tests**
  - `maps tasks and comments to records with permalinks`
  - `obtains a sync token after the first full read`
  - `applies events incrementally and reports deleted tasks`
  - `does a full read when the sync token has expired (412)`
  - `retries once after 429 Retry-After, then throws RateLimitedError` (use fake timers)
  - `listProjects returns id and name`
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/client-memory/asana-adapter.test.ts` — expected FAIL.
- [ ] **Step 3: Implement the interface in `tracker.ts` and `asanaAdapter` in `asana-adapter.ts`.**
- [ ] **Step 4: Run the test** — expected PASS.
- [ ] **Step 5: Commit**: `feat(client-memory): add work-tracker interface and Asana adapter`

### Task 5: Client assignment and record store

**Files:**
- Create: `src/shared/client-memory/assign.ts`, `src/renderer/packages/client-memory/store.ts`
- Test: `src/shared/client-memory/assign.test.ts`, `src/renderer/packages/client-memory/store.test.ts`

**Interfaces:**
- Consumes: Task 1 types
- Produces:
  - `assignClient(record: WorkRecord, clients: Client[], ownDomains: string[]): string | null` — matches participants outside `ownDomains` against each client's `emailMatchers`; exactly one matching client → its id; zero or several → `null`. Asana records keep the `clientId` the adapter set.
  - `clientMemoryStore` (Zustand vanilla store, persisted through `platform.setStoreValue`/`getStoreValue` under keys `client-memory:clients`, `client-memory:records:{clientId}`, `client-memory:ledger:{clientId}`, `client-memory:cursors`, `client-memory:own-domains`, `client-memory:local-only`):
    - `upsertClientsFromTrackerProjects(accountId: string, projects: Array<{ id: string; name: string }>): void` — creates a client per unseen project; never renames existing ones.
    - `renameClient(id: string, name: string): void`
    - `mergeClients(fromId: string, intoId: string): void` — moves project refs, matchers, records, ledger entries; deletes `fromId`.
    - `setEmailMatchers(id: string, matchers: string[]): void` — lower-cases, keeps only `@domain` or `a@b` forms.
    - `setOwnDomains(domains: string[]): void`
    - `setLocalOnly(accountId: string, localOnly: boolean): void`, `isLocalOnly(accountId: string): boolean` — default `false`
    - `upsertRecords(records: WorkRecord[]): void` — drops records with `clientId === null`; replaces by `id`.
    - `deleteRecords(source: SourceKind, externalIds: string[]): void`
    - `removeAccount(accountId: string): void` — removes that account's records, cursors and project refs, and any ledger entry whose `sourceRecordIds` no longer resolve.
    - `getRecords(clientId: string): WorkRecord[]`, `getLedger(clientId: string): LedgerEntry[]`, `appendLedger(clientId: string, entries: LedgerEntry[]): void`
    - `getCursor(accountId, source, scope)`, `setCursor(cursor: SyncCursor)`

- [ ] **Step 1: Write the failing tests**
  - `assign.test.ts`: `assigns by domain`, `assigns by exact address`, `returns null when two clients match` (Review Focus 2), `returns null when nothing matches`, `ignores the user's own domain`.
  - `store.test.ts` (TestPlatform storage): `drops unassigned records`, `upserting the same id twice keeps one record`, `upsertClientsFromTrackerProjects keeps a renamed client's name`, `mergeClients moves records and ledger and removes the source client`, `removeAccount deletes ledger entries left without sources`, `state survives a reload from storage`.
- [ ] **Step 2: Run** both test files — expected FAIL.
- [ ] **Step 3: Implement `assignClient` and `clientMemoryStore`.**
- [ ] **Step 4: Run the tests** — expected PASS.
- [ ] **Step 5: Commit**: `feat(client-memory): assign records to clients and persist them`

### Task 6: Ledger derivation

**Files:**
- Create: `src/shared/client-memory/ledger.ts`, `src/renderer/packages/client-memory/derive.ts`, `src/renderer/packages/client-memory/prompts/derive-ledger.ts`
- Test: `src/shared/client-memory/ledger.test.ts`, `src/renderer/packages/client-memory/derive.test.ts`

**Interfaces:**
- Consumes: Task 1 types; `generateText` from `@/packages/model-calls`, `getModel` from `@shared/models`, `createModelDependencies` from `@/adapters` (same pattern as `packages/memory/extract.ts`)
- Produces:
  - `LEDGER_BATCH_MAX_RECORDS = 40`, `LEDGER_MAX_ENTRIES_PER_BATCH = 20`
  - `parseLedgerDraft(text: string): unknown[]` — tolerant JSON parse (strip code fences); `[]` on failure.
  - `validateLedgerDraft(draft: unknown[], clientId: string, batchRecordIds: Set<string>, now: number): LedgerEntry[]` — keeps entries whose `kind` is valid, `text` non-empty, and whose `sourceRecordIds` are non-empty and all in `batchRecordIds`; truncates to `LEDGER_MAX_ENTRIES_PER_BATCH`.
  - `buildDeriveLedgerPrompt(clientName: string, records: WorkRecord[]): { system: string; user: string }` — records listed with their ids; instructs JSON `{ "entries": [...] }`, answer only from the records, cite ids, write in the language of the source text.
  - `deriveLedgerBatch(input: { clientId: string; clientName: string; records: WorkRecord[]; settings: Settings }): Promise<{ entries: LedgerEntry[]; error?: string }>` — never throws; model or parse failure returns `{ entries: [], error }`.

- [ ] **Step 1: Write the failing tests**
  - `ledger.test.ts`: `drops entries citing ids outside the batch` (Review Focus 3), `drops entries with an unknown kind`, `caps entries per batch at 20`, `parseLedgerDraft returns [] for non-JSON`, `parseLedgerDraft strips code fences`.
  - `derive.test.ts` (mock `generateText`): `returns validated entries from a model reply`, `returns an error and no entries when the model call rejects`, `prompt includes every record id`.
- [ ] **Step 2: Run** both test files — expected FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the tests** — expected PASS.
- [ ] **Step 5: Commit**: `feat(client-memory): derive source-checked ledger entries`

### Task 7: Background runner

**Files:**
- Create: `src/renderer/packages/client-memory/runner.ts`, `src/renderer/packages/client-memory/index.ts`, `src/renderer/setup/client_memory.ts`
- Modify: `src/renderer/index.tsx` (add `import('./setup/client_memory')` beside the other deferred setup imports, desktop only)
- Test: `src/renderer/packages/client-memory/runner.test.ts`

**Interfaces:**
- Consumes: `syncGmail`, `buildMatcherQuery` (Task 3); `asanaAdapter` (Task 4); `clientMemoryStore`, `assignClient` (Task 5); `deriveLedgerBatch` (Task 6); `ensureFreshSecret`, `getIntegrationSecret`, `integrationsStore`
- Produces:
  - `GMAIL_POLL_MS = 60_000`, `ASANA_POLL_MS = 120_000`, `DERIVE_MAX_BATCHES_PER_HOUR = 12`
  - `runSyncOnce(deps?: RunnerDeps): Promise<void>` — for each active `google_workspace` (mail pack) and `asana` account: refresh token, sync, assign clients, upsert/delete records, store cursor, then derive ledger for clients with records newer than their last derivation, within the hourly batch budget.
  - `startClientMemoryRunner(deps?: RunnerDeps): { stop(): void; syncNow(): Promise<void> }`
  - `sourceStatusAtom` (Jotai atom of `SourceStatus[]`)
  - `type RunnerDeps` — injectable clock, adapters, store and model call for tests.
- Rules:
  - One run at a time per account (skip a tick if the previous run is still going).
  - `ensureFreshSecret` failure → that account's status `needs_reauth` with the message; continue with other accounts (Review Focus 4).
  - `clientMemoryStore.isLocalOnly(accountId)` while the configured model is a cloud provider → records still sync, derivation skipped, status `blocked_local_only`. Local providers are those for which `isLocalModelProvider(providerId: string): boolean` (new, in `runner.ts`) returns true: the Ollama and LM Studio members of `ModelProviderEnum` in `src/shared/types/provider.ts`.
  - An account present in the store's cursors or project refs but no longer active in `integrationsStore` → `clientMemoryStore.removeAccount(accountId)`.

- [ ] **Step 1: Write the failing tests** (fake timers, injected deps)
  - `one account needing re-auth does not stop the others`
  - `skips a tick while the previous run is still going`
  - `derives at most 12 batches per hour`
  - `does not derive for local-only sources on a cloud model and reports blocked_local_only`
  - `deleted Asana tasks are removed from the store`
  - `an account removed from Integrations has its records and orphaned ledger entries removed`
  - `stop() clears the timers`
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/client-memory/runner.test.ts` — expected FAIL.
- [ ] **Step 3: Implement the runner and the setup module** (setup module calls `startClientMemoryRunner()` only when `platform.type === 'desktop'`).
- [ ] **Step 4: Run the tests** — expected PASS. Run `pnpm check`.
- [ ] **Step 5: Commit**: `feat(client-memory): poll sources and derive ledger in the background`

### Task 8: `client_recall` chat tool

**Files:**
- Create: `src/renderer/packages/model-calls/toolsets/client-memory.ts`, `src/renderer/packages/client-memory/recall.ts`
- Modify: `src/renderer/packages/model-calls/stream-text.ts` (add the toolset beside `getToolSet` for knowledge base, around line 470, enabled when at least one client has records)
- Test: `src/renderer/packages/client-memory/recall.test.ts`

**Interfaces:**
- Consumes: `clientMemoryStore`, `sourceStatusAtom` (Tasks 5, 7)
- Produces:
  - `resolveClient(nameOrId: string | undefined, clients: Client[]): { ok: true; client: Client } | { ok: false; code: 'ambiguous_client' | 'unknown_client' | 'no_client_given'; candidates: Array<{ id: string; name: string }> }` — case-insensitive name contains / id match.
  - `recallClient(input: { client?: string; query: string; limit?: number }): ClientRecallResult` where `ClientRecallResult = { ok: true; client: { id: string; name: string }; entries: Array<{ kind: LedgerKind; text: string; sources: SourceLink[]; derivedAt: number }>; recentRecords: Array<{ title: string; text: string; link: SourceLink; occurredAt: number }>; gaps: string[] } | { ok: false; code: …; candidates: … }`
    - Lexical scoring over ledger entries (reuse `scoreEntryLexical` from `@/packages/memory/recall` if its signature fits a `{ content: string }` shape; otherwise a token-overlap score). Default `limit = 8`.
    - `recentRecords`: up to 5 newest records matching the query, so answers can use material not yet derived.
    - `gaps`: one line per source of that client not in `idle` state (e.g. `Asana: needs sign-in again — results may be out of date`), plus `No ledger yet for this client` when the ledger is empty.
  - Tool `client_recall` with Zod input `{ client?: string; query: string }`; description tells the model to ask the user which client when `ambiguous_client` or `no_client_given` is returned, to cite source links, and to state gaps.

- [ ] **Step 1: Write the failing tests**
  - `resolves a client by partial name`
  - `returns ambiguous_client with candidates when two names match`
  - `returns entries with resolved source links`
  - `lists a needs_reauth source as a gap` (Review Focus 4)
  - `never returns another client's entries`
- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/client-memory/recall.test.ts` — expected FAIL.
- [ ] **Step 3: Implement `recall.ts`, the toolset, and register it in `stream-text.ts`.**
- [ ] **Step 4: Run the tests**, then `pnpm test -- src/renderer/packages/model-calls/stream-text.test.ts` — expected PASS (add the new toolset to that file's `vi.mock` list if it imports eagerly).
- [ ] **Step 5: Commit**: `feat(client-memory): answer client questions in chat with sources and gaps`

### Task 9: Clients settings page

**Files:**
- Create: `src/renderer/routes/settings/clients.tsx`, `src/renderer/components/settings/clients/ClientRow.tsx`
- Modify: `src/renderer/routes/settings/route.tsx` (add a `clients` entry after `integrations`, around line 84), i18n English strings
- Test: `src/renderer/components/settings/clients/ClientRow.test.tsx`

**Interfaces:**
- Consumes: `clientMemoryStore`, `sourceStatusAtom`, `startClientMemoryRunner().syncNow` (via a module-level handle exported from `packages/client-memory/index.ts` as `syncClientMemoryNow(): Promise<void>`)
- Produces: the page. Contents, top to bottom:
  - "Your company's email domains" field → `setOwnDomains`.
  - Source status list: one line per connected Gmail/Asana account with state, last sync time, message, and a **Keep on this device only** switch (`setLocalOnly`; helper text: "Emails and tasks from this account are never sent to a cloud model"); a **Sync now** button; a link to Settings → Integrations when nothing is connected or an account needs re-auth.
  - Client list: per client, name (inline rename), email domains/addresses (tag input → `setEmailMatchers`), counts of records and ledger entries, **Merge into…** select.
- Copy is plain language: "Emails from these addresses belong to this client", not "matchers".

- [ ] **Step 1: Write the failing tests**
  - `renaming a client updates the store`
  - `adding "@acme.com" saves it as an email matcher; "acme" is rejected with a hint`
  - `merge into another client removes this row`
  - `the local-only switch saves to the store` (in a `SourceStatusRow.test.tsx` beside `ClientRow.test.tsx`)
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/settings/clients/ClientRow.test.tsx` — expected FAIL.
- [ ] **Step 3: Implement the page and row, and register the route.**
- [ ] **Step 4: Run the tests** — expected PASS. Run `pnpm check` and `pnpm lint`.
- [ ] **Step 5: Manual check** (`pnpm dev`, macOS): connect a Google account with the Gmail pack and an Asana PAT in Integrations; set own domain and one client domain; press Sync now; ask in Quick Chat "What's open with {client}?" — expected: an answer citing Gmail/Asana links, and a gap line if a source is in error.
- [ ] **Step 6: Commit**: `feat(client-memory): add Clients settings page`

---

## Later plans

- **Phase 2 — inbox pipeline, labels only** (spec section 3, steps 1–4 without drafts; labelling needs a Gmail `labels`/`modify` write path, still no send). Written after this plan lands, using real records from the pilot for the router/judge test set.
- **Phase 3 — drafts, first run, settings split** (spec sections 3 step 5 and guards, 4).
- **Promote a ledger entry to approved knowledge** (spec section 2) through the existing proposal flow: small, fits in phase 2 or 3.
