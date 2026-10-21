---
type: plan
status: draft
description: "Fix the blockers found when verifying the redesign's known issues: permission bypass, local-only leaks, knowledge import, imported-source delete, Gmail consent"
generated: { by: claude/opus-5.5, at: 2026-10-21T16:00:00+07:00 }
---
# Redesign Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the release blockers found when the known-issues list was verified against main on 2026-10-21: an MCP tool can skip the permission sheet by borrowing a built-in's name, grants and the read-only shortcut reach secret files, "local" models are judged by provider id alone, local-only mail reaches cloud models through legacy memory and four side paths, settings import overwrites knowledge and sources, an imported source deletes without asking, and Gmail runs model calls with Background review off.

**Architecture:** Security first. The risk engine decides LOW for Dango's own tools by where the tool comes from (a `builtin` flag the wrapper passes), not by its name, and treats secret paths as HIGH and never grantable. One `isLocalModel` in `packages/sources/model-check.ts` (loopback host, local provider, no `-cloud` model) replaces the provider-id check at every local-only gate. Two small policy helpers in `pm-pilot-history.ts` (`chatHoldsLocalOnly`, `localOnlyTurn`) switch off memory writes, memory reflect and web search where local-only text is in play. The rest are local fixes: export/import key filter, a "Start over" for unreadable knowledge, confirm Sheets, a Gmail review gate, and a persisted pending source removal.

**Tech Stack:** TypeScript, React 18, Zustand 5 (`persist`), Vitest (+ jsdom, Testing Library), Biome; Tauri 2 desktop, IndexedDB/localStorage/SQLite storage behind `Platform`.

**Spec:** [Known issues](../research/2026-10-19-redesign-known-issues.md) (2026-10-21 verification: B1–B6, S1–S3, S11, S13), [ADR 0001](../adr/0001-user-approved-knowledge-authority.md), [ADR 0003](../adr/0003-explicit-knowledge-source-connections.md), [ADR 0013](../adr/0013-everywhere-layer.md), [ADR 0014](../adr/0014-okf-knowledge-document-format.md) §2 and §4, [ADR 0015](../adr/0015-command-tools-always-ask.md); Backlog TASK-13, TASK-22, TASK-42, TASK-45, TASK-46.

## Global Constraints

- One branch `fix/redesign-blockers` off the latest `main`, one PR. Follow the roadmap's "Running the plans" stop rules: stop and report when a step's test fails twice after a fix, or a cited line range no longer matches and the right place is not obvious.
- Gates: `pnpm test` green; `pnpm check` no more than the 37-error baseline; `pnpm lint` no more than the 9-error baseline; the dango-verify-change skill's checks.
- Copy goes through `t()` with the English string as key, sentence case, no emoji, and each new key is added to `src/renderer/i18n/locales/en/translation.json` as `"key": "key"`. Copy quoted in a task is exact.
- Confirm sheets use 1b's `Sheet` (`components/ui/Sheet.tsx`): Cancel first with `data-autofocus` (first focus), the destructive button `dg-btn dg-btn--danger`, Esc cancels.
- Local means all three: provider is Ollama or LM Studio (`LOCAL_PROVIDERS`); the resolved host is `localhost`, `127.0.0.1` or `::1`; the model id does not end in `-cloud` or `:cloud`. Anything else is cloud. Never use `src/shared/utils/network_utils.ts` `isLocalHost` for this (it counts 10.x and 192.168.x).
- Decision: no "trusted host" setting in this PR. A user with Ollama on another machine gets the existing "choose a local model" fix for local-only sources. Add the setting later only if the maintainer asks.
- Decision: legacy memory gets no local-only tag. With `memory_retain`, `memory_update` and `memory_reflect` off in local-only chats (Task 5), nothing a model reads from local-only text can be saved: `applyFactsToBanks` has no caller and the memory dock saves only text the user types.
- Decision (B6), maintainer may choose the alternative: hide the switch for Gmail and state that connecting means processing. Implemented default: Background review off means Gmail only syncs and stores mail, no model calls (no judge, drafts or read-back). Task 9 is self-contained so it can be swapped.
- Durable data: additive only. `ConnectedSource.removalPendingAt` is `z.number().optional()`; `Storage.getStoreRaw?` is optional; no `CurrentVersion` bump (dango-storage-migration). `Storage` interface changes follow dango-cross-platform-change.
- Out of scope: TASK-46's other five confirm dialogs, settings-export of chats (TASK-13 decides), S4–S10, S12, S14–S16.

## Review Focus

- An MCP server whose tool is literally named like a built-in (`mcp__x__list_tasks`, `mcp__x__web_search`) asks exactly like any other MCP tool, whatever the arguments (Task 1).
- A HIGH "Always" grant earned on a non-secret call (`/etc/hosts`) never auto-runs a secret read (`~/.kube/config`, `~/.aws/credentials`) of the same tool, and the sheet for a secret read never offers Always (Task 2).
- Ollama with an emptied host field (the default `127.0.0.1`) is local; the same provider pointed at `192.168.x`, a domain, or running a `-cloud` model is cloud on every gate (Task 4).
- Importing an old export that holds `knowledge: null`, `knowledge-migration` or `sources` leaves this device's knowledge and sources untouched (Task 7).
- Quitting less than 5 s after removing a source: at the next launch the removal finishes before any due sync of that source starts (Task 10).

---

### Task 1: LOW by Dango toolset identity, never by name (B1)

**Files:**
- Modify: `src/renderer/packages/tools/risk-engine.ts:48-59` (MEDIUM intents), `:443-501` (`BUILTIN_LOW_RISK_TOOLS`, `classifyToolRisk`, `getToolRiskTier`)
- Modify: `src/renderer/packages/model-calls/wrap-tools-approval.ts:97-122`
- Modify: `src/renderer/packages/model-calls/stream-text.ts:940,948,956,964,972-985,993,1001` (built-in wraps; `:525` MCP stays as is)
- Test: `src/renderer/packages/tools/risk-engine.test.ts` (update `:23`, `:35-40`), `src/renderer/packages/model-calls/wrap-tools-approval.risk.test.ts`

**Interfaces:**
- Produces: `classifyToolRisk(toolName: string, description?: string, args?: unknown, opts?: { builtin?: boolean }): RiskClassification`; `getToolRiskTier(...same)`; `wrapToolsWithApproval(sessionId: string | undefined, tools: ToolSet, opts?: { scopeId?: string; builtin?: boolean }): ToolSet`.

- [ ] **Step 1: Write the failing tests** (`risk-engine.test.ts`, new `describe('built-in identity')`)

```ts
const L = { builtin: true }
expect(getToolRiskTier('mcp__x__list_tasks', 'Update tasks', { cmd: 'rm -rf ~' })).toBe(ToolRiskTier.CRITICAL)
expect(getToolRiskTier('mcp__x__web_search', 'Write a file anywhere on disk', { path: '/etc/sudoers', content: 'x' })).toBe(ToolRiskTier.CRITICAL)
expect(getToolRiskTier('mcp__fs__list_files', 'List files', { path: '~/.ssh/id_rsa' })).toBe(ToolRiskTier.CRITICAL)
expect(getToolRiskTier('mcp__notes__memory_reflect', 'Overwrite the given file with new content', { path: '/etc/hosts', content: 'x' })).toBe(ToolRiskTier.HIGH)
expect(getToolRiskTier('mcp__x__parse_link', 'Parse a URL', undefined, L)).toBe(ToolRiskTier.MEDIUM) // mcp__ is never built-in
expect(getToolRiskTier('read_video', 'Extract frames', { path: 'a.mp4' }, L)).toBe(ToolRiskTier.LOW)
expect(getToolRiskTier('read_video', 'Extract frames', { path: '/etc/shadow' }, L)).toBe(ToolRiskTier.CRITICAL) // CRITICAL args still count
expect(getToolRiskTier('computer_ax_query', undefined, undefined, L)).toBe(ToolRiskTier.MEDIUM)
```
Update `:23` to expect `MEDIUM` for `computer_ax_query`; give `:36-39` the `undefined`/`{ builtin: true }` arguments. In `wrap-tools-approval.risk.test.ts` add `it.each` over the four `mcp__` cases above: wrapped with `{ scopeId: 's1' }`, `requestToolPermissionMock` resolves `'deny'` → asked once, `execute` not called; and `read_video_url` wrapped with `{ scopeId: 's1', builtin: true }` runs without asking.

- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/tools/risk-engine.test.ts src/renderer/packages/model-calls/wrap-tools-approval.risk.test.ts` — Expected: FAIL (the `mcp__` cases return LOW).

- [ ] **Step 3: Implement.** The LOW shortcut applies only when `opts?.builtin === true`, `!toolName.startsWith('mcp__')` and `BUILTIN_LOW_RISK_TOOLS.has(toolName)` (exact name; delete the `baseName` split at `:465`). In that branch run `classifyPaths`/`classifyArgs` on `argTexts(args)` and return CRITICAL with those signals if any is CRITICAL, else LOW. Remove `computer_ax_query` from the set and add `/\bcomputer_ax_query\b/` to `MEDIUM_INTENT_PATTERNS` (it reads screen text). `wrapToolsWithApproval` passes `{ builtin: opts.builtin }` to both `getToolRiskTier` calls; `stream-text.ts` passes `builtin: true` on every built-in wrap listed above.

- [ ] **Step 4: Run** the Step 2 command, then `pnpm test -- src/renderer/packages/model-calls` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "fix(permissions): decide low risk by Dango toolset, never by tool name"`

### Task 2: Secret paths always ask; no shortcut on relative operands (S1, S2)

**Files:**
- Modify: `src/renderer/packages/tools/risk-engine.ts:262-264` (`SECRET_PATH`), `:318-338` (`isReadOnlyCommandText`), `:373-379` (`getArgsRiskTier`), `:464-493` (`classifyToolRisk`)
- Modify: `src/renderer/packages/model-calls/wrap-tools-approval.ts:124-125` (`grantable`)
- Test: `src/renderer/packages/tools/risk-engine.test.ts` (move cases out of the read-only list at `:354-387`), `src/renderer/packages/model-calls/wrap-tools-approval.risk.test.ts`

**Interfaces:**
- Consumes: Task 1's `classifyToolRisk` signature.
- Produces: `secretPathIn(args: unknown): string | undefined` — the first path-like token in any string value of `args` that matches `SECRET_PATH`.

- [ ] **Step 1: Write the failing tests**

```ts
it.each(['~/.gnupg/private-keys-v1.d/a.key', '~/.config/gh/hosts.yml', '~/.kube/config', '~/.zshrc', '~/.aws/config',
  '~/.ssh/config', '~/.docker/config.json', '~/.git-credentials', 'repo/.git/config'])('%s rates HIGH', (path) => {
  expect(getToolRiskTier('mcp__fs__read_file', 'Read a file', { path })).toBe(ToolRiskTier.HIGH)
})
it('prose and option names are not paths', () => {
  expect(getToolRiskTier('mcp__llm__complete', 'Complete text', { max_tokens: 5, prompt: 'how do tokens work' })).toBe(ToolRiskTier.MEDIUM)
})
it.each(['cat .zshrc', 'grep KEY .zshrc', 'cat .git/config', 'ls -la .ssh', 'cat README.md', 'head -n 5 a.txt',
  'du -sh build', 'find . -name app.ts', 'wc -l src/app.ts', 'stat package.json', 'tail -n 20 log.txt'])(
  '%s asks: the working folder is unknown', (command) => expect(isReadOnlyCommand({ command })).toBe(false))
```
Keep `ls`, `ls -la`, `df -h`, `du -sh`, `pwd`, `git status`, `git log --oneline -5`, `git diff main..HEAD`, `git show HEAD`, `which node`, `type git` in the read-only list. In `wrap-tools-approval.risk.test.ts`: with a seeded HIGH scope grant for `mcp__fs__read_file`, each of `~/.aws/credentials`, `~/.env`, `~/.netrc`, `~/.npmrc`, `~/.kube/config` asks with `allowAlways: false`; `/etc/hosts` (HIGH, not secret) still runs under the grant.

- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/tools/risk-engine.test.ts src/renderer/packages/model-calls/wrap-tools-approval.risk.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** Extend `SECRET_PATH` with `(?:^|[/:=])\.(?:zshrc|bashrc|bash_profile|zprofile|zshenv|profile)$`, `\.git\/config$`, `\.yarnrc`, `\.m2\/settings\.xml`. `secretPathIn` walks string values (depth ≤ `MAX_ARG_DEPTH`, never the flattened JSON, never keys), splits on whitespace and `=`, and tests tokens that are path-like (`/[\\/]/`, a leading `~` or `.`, or a `\.[a-z0-9]{1,8}$` ending). `classifyToolRisk` (non-built-in branch) and `getArgsRiskTier` push `{ source: 'path', tier: HIGH, matched }` when it returns a token. In `isReadOnlyCommandText`, for `ls`, `du`, `FILE_READERS`, `tail`, `grep` and `find` every argument must be a flag (`-…`) or a bare number. `grantable` adds `&& !secretPathIn(args)`. Update ADR 0015's Consequences line "if that folder is home, plain reads there run without asking" in Task 11.

- [ ] **Step 4: Run** the Step 2 command — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "fix(permissions): secret paths always ask and never take a grant"`

### Task 3: Audit log cap and visible grant/revoke write failures (S3)

**Files:**
- Modify: `src/renderer/stores/safeStorage.ts:14-52`, `src/renderer/stores/toolApprovalStore.ts:40-50,106-145,168`
- Modify: `src/renderer/components/permission/ScopePermissions.tsx:15-27`, `src/renderer/packages/model-calls/wrap-tools-approval.ts:170-188`
- Test: `src/renderer/stores/toolApprovalStore.test.ts`, `src/renderer/components/permission/ScopePermissions.test.tsx`

**Interfaces:**
- Produces: `createSafeStorage(onWriteError?: (name: string, error: unknown) => void): PersistStorage<unknown>` (`safeStorage = createSafeStorage()`); `AUDIT_LOG_LIMIT = 500`; `addApproval`, `addScopeGrant`, `revokeScopeGrant` now return `boolean` (false when the persisted write threw; memory state still changes).

- [ ] **Step 1: Write the failing tests**

```ts
it('keeps the newest 500 audit entries', () => {
  for (let i = 0; i < 510; i++) toolApprovalStore.getState().addAuditEntry({ ...entry, timestamp: i })
  const log = toolApprovalStore.getState().auditLog
  expect(log).toHaveLength(500)
  expect(log[0].timestamp).toBe(10)
})
it('a revoke that cannot be saved says so', () => {
  toolApprovalStore.getState().addScopeGrant('scope-1', grant)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError') })
  expect(toolApprovalStore.getState().revokeScopeGrant('scope-1', 'browser_click')).toBe(false)
})
```
`ScopePermissions.test.tsx`: with `revokeScopeGrant` spied to return `false`, "Stop allowing" calls the mocked `@/stores/toastActions` `add` with the copy below and does not call `pushUndo`.

- [ ] **Step 2: Run** `pnpm test -- src/renderer/stores/toolApprovalStore.test.ts src/renderer/components/permission/ScopePermissions.test.tsx` — Expected: FAIL.

- [ ] **Step 3: Implement.** `addAuditEntry` keeps `.slice(-AUDIT_LOG_LIMIT)`. The store's storage is `createSafeStorage(onWriteError)` that records the error in a module variable; each returning action clears it, calls `set`, and returns whether it is still clear (Zustand's `persist` writes synchronously inside `set`). Copy, revoke: `"Couldn't save this change. “{{label}}” may be allowed again after Dango restarts. Free up some disk space and try again."`; Always grant (wrap, via `toastActions.add`): `"Couldn't save “Always” for {{label}}. Dango will ask again next time."` with `label = toolLabel(toolName)`.

- [ ] **Step 4: Run** the Step 2 command — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "fix(permissions): cap the audit log and surface failed grant writes"`

### Task 4: One `isLocalModel` at every local-only gate (B2, TASK-42)

**Files:**
- Modify: `src/renderer/packages/sources/model-check.ts:6-16`; Create: `src/renderer/packages/sources/model-check.test.ts`
- Modify (gates): `model-calls/stream-text.ts:371-373`; `model-calls/toolsets/pm-pilot-history.ts:5,103-109`; `stores/session/naming.ts:58-61`; `context-management/summary-generator.ts:46,149`; `knowledge/chat-proposer.ts:47,55`; `knowledge/contradictions.ts:194-205`; `pm-pilot/background-model.ts:1,27`; `pm-pilot/bridge.ts:52-57`; `pm-pilot/index.ts:5`; `sources/review.ts:9,179-181`; `sources/connect.ts:145-155` (paths under `src/renderer/packages/` except `stores/session/naming.ts` under `src/renderer/`)
- Modify (rename only): `src/renderer/components/quick-chat/quickChatState.ts:25` `isLocalModel` → `reachableOffline` and its callers `useQuickChat.ts:31,172`, `quickChatState.test.ts:4,40-62`
- Test mocks: `pm-pilot/judge-call.test.ts:13`, `pm-pilot/sent-readback.test.ts:20`; gate tests in `model-calls/stream-text.test.ts`, `model-calls/toolsets/pm-pilot-history.test.ts`

**Interfaces:**
- Produces (in `model-check.ts`; `isLocalModelProvider` is removed):
  ```ts
  export type ModelRef = { provider?: string | null; modelId?: string | null }
  export type ProviderHostSettings = Pick<Settings, 'providers' | 'customProviders'>
  export function isLocalModel(input: { providerId?: string | null; host?: string | null; modelId?: string | null }): boolean
  export function providerHost(settings: ProviderHostSettings | undefined, providerId: string): string
  export function isLocalModelIn(settings: ProviderHostSettings | undefined, model: ModelRef | null | undefined): boolean
  ```
  `cloudSafeMessages(messages: Message[], model: ModelRef | null | undefined, settings: ProviderHostSettings | undefined): Promise<Message[]>`

- [ ] **Step 1: Write the failing tests** (`model-check.test.ts`)

```ts
const local = (providerId: string, host: string, modelId = 'llama3') => isLocalModel({ providerId, host, modelId })
expect(local('ollama', 'http://127.0.0.1:11434')).toBe(true)
expect(local('ollama', 'http://localhost:11434')).toBe(true)
expect(local('lm-studio', 'http://[::1]:1234')).toBe(true)
expect(local('ollama', '127.0.0.1:11434')).toBe(true) // no scheme
expect(local('ollama', 'http://192.168.1.20:11434')).toBe(false)
expect(local('ollama', 'https://ollama.example.com')).toBe(false)
expect(local('ollama', 'http://127.0.0.1:11434', 'gpt-oss:120b-cloud')).toBe(false)
expect(local('openai', 'http://localhost:8080')).toBe(false)
expect(local('ollama', '')).toBe(false)
expect(isLocalModelIn({}, { provider: 'ollama', modelId: 'm' })).toBe(true) // definition default host
expect(isLocalModelIn({ providers: { ollama: { apiHost: 'http://10.0.0.5:11434' } } }, { provider: 'ollama', modelId: 'm' })).toBe(false)
expect(isLocalModelIn({}, null)).toBe(false)
```
Gate tests: in `pm-pilot-history.test.ts`, `cloudSafeMessages` with `{ provider: 'ollama', modelId: 'm' }` and settings `providers.ollama.apiHost = 'http://10.0.0.5:11434'` replaces a local-only recall answer with `LOCAL_ONLY_ANSWER_PLACEHOLDER`. In `stream-text.test.ts`, with the settings mock's `providers.ollama.apiHost` set to `http://10.0.0.5:11434`, an Ollama session calls `loadPmToolSetMock` with `cloudModel: true`.

- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/sources/model-check.test.ts src/renderer/packages/model-calls` — Expected: FAIL.

- [ ] **Step 3: Implement.** `providerHost` resolves like `getProviderSettings` (`src/shared/providers/index.ts:58-67`) without throwing: `settings.providers[id].apiHost`, else the system or custom provider's `defaultSettings.apiHost`, trimmed, else `''`. `isLocalModel` adds `http://` when the host has no scheme, reads `new URL(host).hostname`, and accepts only `localhost`, `127.0.0.1`, `[::1]`, `::1`; the model id must not match `/(?:^|[-:])cloud$/i`. Each gate passes the model it actually calls plus global settings (`settingsStore.getState().getSettings()` where none is in scope, e.g. `chat-proposer.ts`). `cost-tracking/headsUp.ts:27` keeps its own check (a LAN model is still free) and `reachableOffline` keeps LAN hosts (it answers "works without internet"); neither is a privacy gate.

- [ ] **Step 4: Run** the Step 2 command, then `pnpm test -- src/renderer/packages/pm-pilot src/renderer/packages/knowledge src/renderer/packages/sources src/renderer/components/quick-chat` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "fix(privacy): local means a loopback host on Ollama or LM Studio, never a cloud model"`

### Task 5: Legacy memory in chats that hold local-only text (B3, TASK-45 part)

**Files:**
- Modify: `src/renderer/packages/model-calls/toolsets/pm-pilot-history.ts` (add two helpers after `holdsLocalOnlyRecall`, `:44`)
- Modify: `src/renderer/packages/memory/tools.ts:17-32,43-70,126-128,264-312`; `src/renderer/packages/memory/consolidate.ts:20-38` (already takes `sessionSettings`); `src/renderer/stores/memoryStore.ts:63,286-308`
- Modify: `src/renderer/packages/model-calls/stream-text.ts:371-373` (compute before `cloudSafeMessages`), `:644-668`
- Test: `src/renderer/packages/model-calls/toolsets/pm-pilot-history.test.ts`; Create: `src/renderer/packages/memory/tools.test.ts`

**Interfaces:**
- Produces: `chatHoldsLocalOnly(messages: Pick<Message, 'contentParts' | 'pmLocalOnly' | 'pmQuestionId'>[]): boolean` (any message `holdsLocalOnlyRecall` or has `pmQuestionId`); `localOnlyTurn(i: { holdsLocalOnly: boolean; cloudModel: boolean; clientRecallOffered: boolean }): boolean` (= `!cloudModel && (holdsLocalOnly || clientRecallOffered)`); `MemoryToolContext.localOnlyChat?: boolean`, `MemoryToolContext.sessionSettings?: SessionSettings`; `rebuildProfile(scope, agentId?, useLlm?, opts?: { sessionSettings?: SessionSettings })`.

- [ ] **Step 1: Write the failing tests**

```ts
expect(chatHoldsLocalOnly([recallAnswer({ localOnly: true })])).toBe(true)
expect(chatHoldsLocalOnly([{ ...createMessage('assistant', 's'), pmLocalOnly: true }])).toBe(true)
expect(chatHoldsLocalOnly([{ ...createMessage('assistant', 'q'), pmQuestionId: 'q1' }])).toBe(true)
expect(chatHoldsLocalOnly([createMessage('user', 'hi'), recallAnswer({})])).toBe(false)
expect(localOnlyTurn({ holdsLocalOnly: false, cloudModel: false, clientRecallOffered: true })).toBe(true)
expect(localOnlyTurn({ holdsLocalOnly: true, cloudModel: false, clientRecallOffered: false })).toBe(true)
expect(localOnlyTurn({ holdsLocalOnly: true, cloudModel: true, clientRecallOffered: true })).toBe(false)
expect(localOnlyTurn({ holdsLocalOnly: false, cloudModel: false, clientRecallOffered: false })).toBe(false)
```
(`recallAnswer(result)` = an assistant message with one `client_recall` tool-call part whose `result` is given.) `tools.test.ts`: `Object.keys(getMemoryToolSet({ ...ctx, localOnlyChat: true }).tools)` equals `['memory_recall', 'memory_list', 'memory_forget']`, and its description contains "Saving and reflecting are off in this chat because it holds email or tasks kept on this device."

- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/model-calls/toolsets/pm-pilot-history.test.ts src/renderer/packages/memory/tools.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** `getMemoryToolSet` omits `memory_retain`, `memory_update` and `memory_reflect` when `localOnlyChat` (memory_update can write the same text), and drops their bullets from the description. `memory_reflect` builds its model from `{ ...globalSettings, ...ctx.sessionSettings }` (as `consolidate.ts:12-14`). In `streamText`, take `holdsLocalOnly = chatHoldsLocalOnly(params.messages)` before `:373` (the placeholder drops the tool parts); after `:524` compute `turnIsLocalOnly = localOnlyTurn({ holdsLocalOnly, cloudModel, clientRecallOffered: pmToolSet !== null })`; pass `localOnlyChat: holdsLocalOnly || turnIsLocalOnly` and `sessionSettings`, and `scheduleConsolidate` passes `{ sessionSettings }` through `rebuildProfile` to `consolidateBank`.

- [ ] **Step 4: Run** the Step 2 command, then `pnpm test -- src/renderer/packages/model-calls src/renderer/stores` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "fix(privacy): no legacy memory writes or reflect in chats holding local-only mail"`

### Task 6: The other local-only paths (S13, TASK-45 rest)

**Files:**
- Modify: `src/renderer/components/search/FollowUpSuggestions.tsx:160-170,210-214,288-296`
- Modify: `src/renderer/packages/model-calls/stream-text.ts:595,689-691,890,925-928`
- Modify: `src/renderer/packages/hooks/wrap-tools.ts:47-56`
- Modify: `src/renderer/packages/pm-pilot/recall.ts:46-60,236-252`; `src/renderer/packages/knowledge/approve.ts:229-244`; `src/renderer/packages/knowledge/save-message.ts:16-39`
- Test: `src/renderer/packages/model-calls/stream-text.test.ts`, `src/renderer/packages/hooks/wrap-tools.test.ts`, `src/renderer/packages/pm-pilot/recall.test.ts`, `src/renderer/packages/knowledge/save-message.test.ts`; Create: `src/renderer/components/search/FollowUpSuggestions.test.ts`

**Interfaces:**
- Consumes: Task 4 `isLocalModelIn`; Task 5 `chatHoldsLocalOnly`, `turnIsLocalOnly` local in `streamText`.
- Produces: `ClientRecallResult` (ok) gains `localOnlySourceIds?: string[]`; `addKnowledge(input: { scopeId: string; kind: KnowledgeKind; text: string; sources?: KnowledgeSourceInput[] })` (default `[{ kind: 'user', label: 'You' }]`); `generateFollowUpSuggestions` is exported for tests.

- [ ] **Step 1: Write the failing tests**
  - `stream-text.test.ts`: with `webBrowsing: true` and the client_recall toolset loaded, an Ollama session's `options.tools.web_search` is `undefined`; an OpenAI session's is defined.
  - `wrap-tools.test.ts`: with an enabled PostToolUse hook, executing `client_recall` and `client_answer` never runs the hook; another tool still does.
  - `recall.test.ts`: a local-model recall returning records of local-only source `g1` has `localOnly: true, localOnlySourceIds: ['g1']`; a record with no known source leaves `localOnlySourceIds` out.
  - `save-message.test.ts`: saving an answer whose recall result is `{ localOnly: true, localOnlySourceIds: ['g1'] }` files sources `[{ kind: 'chat', label: 'Chat answer', sourceId: 'g1' }]`; with `localOnly: true` and no ids it saves nothing and toasts "This answer used email or tasks kept on this device, so it can't be saved as knowledge."
  - `FollowUpSuggestions.test.ts`: `generateFollowUpSuggestions({ sessionId, answer, localOnly: true })` with session settings `{ provider: 'openai', modelId: 'gpt' }` returns `[]` and never calls `getModel`; with `{ provider: 'ollama', modelId: 'm' }` it calls the model.

- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/model-calls/stream-text.test.ts src/renderer/packages/hooks src/renderer/packages/pm-pilot/recall.test.ts src/renderer/packages/knowledge/save-message.test.ts src/renderer/components/search` — Expected: FAIL.

- [ ] **Step 3: Implement.**
  - Follow-ups: `FollowUpContext.localOnly = holdsLocalOnlyRecall(message) || !!message.pmQuestionId`; skip (return `[]`) when `localOnly && !isLocalModelIn(globalSettings, settings)`, before resolving the model.
  - Web search: `const searchWeb = webBrowsing && !turnIsLocalOnly`, used at `:595`, `:689`, the `webNotSupported` branch at `:890` (`webNotSupported && searchWeb`) and `:925`.
  - Hooks: `wrapToolsWithLifecycleHooks` skips `PostToolUse` (both the result and the error call) for `CLIENT_RECALL_TOOL` and `CLIENT_ANSWER_TOOL`; PreToolUse still runs.
  - Recall: while filling `records`, collect `r.sourceId` of each `mayNotLeave` record whose source is known; set `localOnlySourceIds` only when none was unknown.
  - Save as knowledge: a message with `pmQuestionId` (a Needs you opening that quotes mail) gets the same toast and saves nothing; when `holdsLocalOnlyRecall(msg)`, read `localOnlySourceIds` from its `client_recall`/`client_answer` results; none → toast the copy above and return; else `addKnowledge({ scopeId, kind: 'fact', text, sources })` with `label: t('Chat answer')`.
  - Settings export of chats that quote mail: no code change; Task 11 records it as TASK-13's decision.

- [ ] **Step 4: Run** the Step 2 command — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "fix(privacy): keep local-only text out of follow-ups, web search, hooks and saved knowledge"`

### Task 7: Knowledge and sources stay out of export/import; unreadable store recovers (B4, TASK-13)

Use the dango-storage-migration skill (keys and read semantics) and dango-cross-platform-change (`Storage` interface).

**Files:**
- Modify: `src/renderer/storage/exportFilter.ts:1-13` (covers `pages/SettingDialog/AdvancedSettingTab.tsx:164,227` and `routes/settings/general.tsx:508,588-596`, which already call it)
- Modify: `src/renderer/platform/interfaces.ts:21-29` (`getStoreRaw?`), `platform/storages.ts` (`LocalStorage`, `MobileSQLiteStorage`, `IndexedDBStorage`), `platform/desktop_platform.ts:169-195`, `platform/test_platform.ts:30-45,162`; `src/renderer/storage/BaseStorage.ts:66-73` (`readRawItem`)
- Modify: `src/renderer/packages/knowledge/store.ts:13-25,41-46,69-77,162-171`; `src/renderer/packages/knowledge/test-storage.ts:17-37`
- Modify: `src/renderer/components/settings/privacy/MemoryPrivacyPage.tsx:72-80`; Create: `src/renderer/components/settings/privacy/StartOverKnowledgeSheet.tsx`
- Test: `src/renderer/storage/exportFilter.test.ts`, `src/renderer/packages/knowledge/store.test.ts`, `src/renderer/components/settings/privacy/MemoryPrivacyPage.test.tsx`

**Interfaces:**
- Produces: `Storage.getStoreRaw?(key: string): Promise<string | null>` (the stored text, unparsed); `BaseStorage.readRawItem(key: string): Promise<string | null | undefined>` (`undefined` = platform cannot tell); `KnowledgeStoreState.unreadable: boolean`; `startKnowledgeOver(): Promise<boolean>` (true when it wrote an empty document); `putRawText(key: string, text: string)` in `test-storage.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
it.each(['knowledge', 'knowledge-migration', 'sources', 'pm-records'])('%s never leaves or enters', (key) => {
  expect(isDeviceOnlyKey(key)).toBe(true)
})
expect(isDeviceOnlyKey('settings')).toBe(false)
```
`store.test.ts`: `putRaw(KEY, null); putRawText(KEY, 'null')` → `ensureKnowledgeLoaded({ fresh: true })` resolves with empty state and `unreadable: false`; same for `''`. `putRaw(KEY, null); putRawText(KEY, '{"items": [')` → rejects with `KnowledgeUnreadableError`, `unreadable: true`; then `startKnowledgeOver()` resolves `true`, the stored value is `emptyKnowledgeState()`, `unreadable` is false and a commit works. `startKnowledgeOver()` on a readable document resolves `false` and writes nothing. The existing case at `:71-89` keeps passing (no raw text set = platform cannot tell = fail closed). `MemoryPrivacyPage.test.tsx`: with `unreadable: true` the row "Knowledge can't be read" shows; "Start over…" opens the sheet with focus on Cancel; "Delete and start over" calls `startKnowledgeOver`.

- [ ] **Step 2: Run** `pnpm test -- src/renderer/storage/exportFilter.test.ts src/renderer/packages/knowledge/store.test.ts src/renderer/components/settings/privacy` — Expected: FAIL.

- [ ] **Step 3: Implement.** `isDeviceOnlyKey` adds exact `knowledge`, `knowledge-migration`, `sources`; update the file comment ("approved knowledge and connected sources stay on this device; OKF import, ADR 0014, is how knowledge comes in, as proposals"). `getStoreRaw` returns the stored string as is (localStorage/localforage/SQLite `getItem`; desktop file keys return `null`). In `readState`, when the value reads `null` and the key is listed, `readRawItem`: `null`, `''` or `'null'` (trimmed) → missing; anything else, or `undefined`, → throw as today. `ensureKnowledgeLoaded` sets `unreadable` true on `KnowledgeUnreadableError` and false on a good read. `startKnowledgeOver` runs in `enqueue`, re-reads, and only when unreadable writes `emptyKnowledgeState()` with `setItemNow` and sets state. Page: calls `ensureKnowledgeLoaded()` on mount (errors ignored) so the flag is known, and shows a "Knowledge" section only while `unreadable`; row title "Knowledge can't be read", description "Dango can't read your saved knowledge, so nothing new can be saved. Starting over deletes it.", button "Start over…". Sheet title "Start over with empty knowledge?", body "Your saved facts, preferences and proposals are deleted. This can't be undone.", actions Cancel and "Delete and start over". Export row description becomes "Back up chats and settings to a file. Knowledge stays on this device."

- [ ] **Step 4: Run** the Step 2 command, then `pnpm test -- src/renderer/platform src/renderer/storage src/renderer/packages/knowledge` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "fix(knowledge): keep knowledge and sources out of settings export and import; recover an unreadable store"`

### Task 8: Deleting an imported source asks first (B5, TASK-46 part)

**Files:**
- Create: `src/renderer/components/imported-history/DeleteImportedSourceSheet.tsx`, `DeleteImportedSourceSheet.test.tsx`
- Modify: `src/renderer/modals/ImportedConversationView.tsx:21-24,58,83-100`
- Test: `src/renderer/components/ui/sheetInventory.test.ts` (keeps `modals/ImportedConversationView.tsx` allow-listed: the viewer stays on AdaptiveModal; update the comment at `:28-31`)

**Interfaces:**
- Produces: `DeleteImportedSourceSheet(props: { filename: string; conversationCount: number; opened: boolean; onClose(): void; onConfirm(): void })`.

- [ ] **Step 1: Write the failing test**: rendered with `filename: 'chatgpt-export.zip', conversationCount: 12`, the dialog is named `Delete “chatgpt-export.zip”?`, shows "This removes 12 imported conversations from Dango and can't be undone. Chats you continued from them stay.", focus is on Cancel, Esc calls `onClose` only, "Delete import" calls `onClose` then `onConfirm`. With `conversationCount: 1` the body reads "This removes 1 imported conversation from Dango and can't be undone. Chats you continued from them stay."

- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/imported-history` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement** the sheet after `components/scope/DeleteScopeSheet.tsx`, with the two body strings as separate keys (count 1, other). In the viewer, "Delete imported source" sets `confirming = true`; the AdaptiveModal's `opened` becomes `modal.visible && !confirming` (no stacked focus traps); Cancel sets `confirming = false`; confirm runs the existing `deleteImportedSourceAndReconcile(...)` call, then `modal.hide()`. `conversationCount = source.conversations.length`, `filename = source.originalFilename`. The other five TASK-46 dialogs stay with TASK-46 (each is a different modal and flow, not a one-line swap).

- [ ] **Step 4: Run** `pnpm test -- src/renderer/components/imported-history src/renderer/components/ui/sheetInventory.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "fix(imported-history): confirm before deleting an imported source"`

### Task 9: Gmail with Background review off makes no model calls (B6)

**Files:**
- Modify: `src/renderer/packages/pm-pilot/pipeline.ts:236-279` (`runAccount`)
- Modify: `src/renderer/components/sources/AddSourceSheet.tsx:291-305`
- Test: `src/renderer/packages/pm-pilot/pipeline.test.ts` (fixture `source()` at `:172-184` becomes `backgroundReview: true`, so existing acting tests keep their meaning)

**Interfaces:**
- Consumes: `ConnectedSource.backgroundReview` (exists).

- [ ] **Step 1: Write the failing test**: `h.sources = [source({ backgroundReview: false })]`, `syncReturns([mail(), mail({ sentByMe: true, author: OWN })])` → `runGmailPipeline` stores both records, `judgeThread`, `actOnThread` and `readBackSent` are not called, `resolveBackgroundModel` is not called, and the result is `{ summary: 'Checked 2 new emails', quiet: true }`. A second source on the same account with review on still gets its new mail judged.

- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/pm-pilot/pipeline.test.ts` — Expected: FAIL.

- [ ] **Step 3: Implement.** In `runAccount`, after the cursor is saved: `const reviewing = sources.filter((s) => s.backgroundReview)`; when empty, return without resolving the model, reading back or acting. Otherwise resolve the model as now, pass `stored.filter((r) => r.sourceId && reviewingIds.has(r.sourceId))` to `readBack` and `reviewing` to `actOnNewMail`. Sync, storage, "Which client is this?" questions and backfills (no model calls) are unchanged. AddSourceSheet: under the switch, for `kind === 'gmail'` only, a caption "Off: Dango keeps new mail for search but doesn't read it with a model or write drafts."

- [ ] **Step 4: Run** `pnpm test -- src/renderer/packages/pm-pilot src/renderer/components/sources` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "fix(pm-pilot): Gmail with Background review off only stores mail"`

### Task 10: A pending source removal survives quit (S11, TASK-22)

Persist the pending removal and finish it at next launch: `revokeSource` is async (keychain, bindings) and cannot finish inside `beforeunload` or a Tauri close handler, so no quit hook is added.

**Files:**
- Modify: `src/shared/types/sources.ts:7-18` (`removalPendingAt: z.number().optional()`)
- Create: `src/renderer/packages/sources/pending-removal.ts`, `pending-removal.test.ts`; export from `src/renderer/packages/sources/index.ts`
- Modify: `src/renderer/packages/sources/jobs.ts:51-80` (`dueReviews`, `dueSyncs` skip pending sources)
- Modify: `src/renderer/components/sources/SourceRow.tsx:19,72-123`; `SourcesSettings.tsx:26`, `components/scope/ScopeSourcesTab.tsx:16` (also hide `removalPendingAt` sources)
- Modify: `src/renderer/setup/background_jobs.ts:93-98` (finish before `startDueJobs`)

**Interfaces:**
- Produces: `REMOVE_DELAY_MS = 5_000` (moved from `SourceRow.tsx:19`); `markRemovalPending(id: string, at: number): Promise<void>`; `cancelRemovalPending(id: string): Promise<void>`; `finishPendingRemovals(sources: ConnectedSource[], now: number): Promise<void>` (revokes each source whose `removalPendingAt` is at least `REMOVE_DELAY_MS` old; a failure is logged and retried at the next check).

- [ ] **Step 1: Write the failing tests**: `finishPendingRemovals([src({ removalPendingAt: 1_000 }), src({ id: 'b', removalPendingAt: 9_000 }), src({ id: 'c' })], 10_000)` revokes only the first; `dueSyncs` and `dueReviews` leave out a source with `removalPendingAt`; `markRemovalPending` then `cancelRemovalPending` leaves the stored source without the field (`sources/store.test.ts` storage helpers).

- [ ] **Step 2: Run** `pnpm test -- src/renderer/packages/sources` — Expected: FAIL.

- [ ] **Step 3: Implement** with `updateSource` for mark/cancel. `removeWithUndo` calls `markRemovalPending(source.id, Date.now())` (logged on failure) before starting its timer; Undo calls `cancelRemovalPending`. In `background_jobs.ts` `check()`, `await finishPendingRemovals(sourcesStore.getState().sources, Date.now())` right before `startDueJobs`.

- [ ] **Step 4: Run** `pnpm test -- src/renderer/packages/sources src/renderer/components/sources src/renderer/setup` — Expected: PASS.

- [ ] **Step 5: Commit** `git commit -m "fix(sources): finish a source removal pending at quit on the next launch"`

### Task 11: Docs, full gates, verification

**Files:**
- Modify: `docs/research/2026-10-19-redesign-known-issues.md`, `docs/adr/0015-command-tools-always-ask.md` (Consequences), `docs/log.md`

- [ ] **Step 1: Known issues.** Mark Fixed with "(fixed in #PR)" (placeholder for the PR number): the B1 name-collision and "Built-in low-risk tools" lines; S1 (the raised-tier grant bullet: now "a secret path never takes a grant"); S2; S3; TASK-42 "Local model check"; TASK-45 items legacy memory, follow-ups, web search, hooks and "Save as knowledge"; TASK-13 both parts; "deleting an imported source asks nothing" (TASK-46 keeps the five dialogs); TASK-22; B6 with "maintainer may still choose: hide the switch for Gmail". Add under Trade-offs: read-only commands with a file operand now ask (the MCP server's working folder is unknown); Ollama on another machine counts as cloud (no trusted-host setting); settings export of chats that quote mail stays TASK-13's decision; the 2026-10-21 verification also noted Review entries and background jobs are still exported (unconfirmed whether they hold mail text).
- [ ] **Step 2: ADR 0015** (draft): replace "if that folder is home, plain reads there run without asking (secret files still ask)" with "commands that name a file or folder ask, because Dango does not know the server's working folder; secret files never take a grant".
- [ ] **Step 3: Log.** One line under `## 2026-10-21`: `* **Implementation**: [redesign blockers](specs/2026-10-21-redesign-blockers.md) built on \`fix/redesign-blockers\`: …` naming the fixes in one sentence each.
- [ ] **Step 4: Gates.** Run `pnpm test` (Expected: all pass), `pnpm check` (Expected: ≤ 37 errors), `pnpm lint` (Expected: ≤ 9 errors). Then run the dango-verify-change skill and report what was not run (desktop walk: permission sheet on a real MCP server, Gmail with review off, quit within 5 s of a removal).
- [ ] **Step 5: Commit** `git commit -m "docs: record the redesign blocker fixes"` and open the PR from `fix/redesign-blockers`.
