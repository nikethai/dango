---
type: plan
status: draft
description: "Carry out the maintainer's five decisions on the questions the redesign blockers PR left open: MCP tools ask once, device-only chats close outside tools, Gmail review on by default, review acts only on new mail, and a narrower settings export"
generated: { by: claude/opus-5.5, at: 2026-10-21T19:00:00Z }
---
# Blocker Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the maintainer's answers (2026-10-21) to the five questions in [PR #110](https://github.com/nikethai/dango/pull/110) and the [known issues](../research/2026-10-19-redesign-known-issues.md) "Left open by the blockers PR" list.

**Architecture:** Small changes in the places the blockers plan already touched: the risk engine floor for MCP tools, the local-only tool filter in `streamText`, the Gmail switch default and caption, a `reviewEnabledAt` time on sources that the Gmail pipeline respects, and the settings export key filter. Decisions are recorded in [ADR 0016](../adr/0016-outside-tools-and-device-only-chats.md).

**Spec:** Maintainer decisions in the PR #110 conversation, 2026-10-21; [blockers plan](2026-10-21-redesign-blockers.md); ADR 0003, ADR 0015, ADR 0016.

## Global Constraints

- Same branch `fix/redesign-blockers`, same PR #110, same gates (`pnpm test` green, `pnpm check` ≤ 37, `pnpm lint` ≤ 9), copy through `t()` with English keys, durable data additive only (no `CurrentVersion` bump).
- Never trust an MCP server's description of itself: its tool name, description and annotations (`readOnlyHint` and the like) never lower a tier.

## Decisions (maintainer, 2026-10-21)

1. **MCP tools ask once, then remember.** Every MCP tool asks the first time; the sheet offers "Always in this scope" except for secret paths and the tools that always ask (send, delete, pay, commands). No MCP tool runs unasked because of its name, description or annotations.
2. **Device-only chats close outside tools.** On a local-only turn, everything that sends content off the device is off: MCP tools, browser and video-URL reading, image generation (web search and link reading already are). Computer use stays (its screenshots go to the local model). The chat shows one quiet line: "Web and outside tools are off because this chat holds device-only mail."
3. **Gmail review on by default.** The Background review switch defaults on for Gmail. Caption when on: "Dango reads new mail with your model to draft replies." Off still means store-only, with the existing off caption.
4. **Turning review back on acts only on newer mail.** Mail that arrived while review was off stays stored and searchable but is never judged or drafted. (A later one-time offer, "Draft replies for the last 3 days' unanswered mail?", is not in this plan.)
5. **Narrower settings export.** Connected accounts (`integrations`), Review entries, background jobs and source cursors stay on the device, in export and import. Chats and imported history stay in the export, but chats that hold device-only mail are left out unless the user ticks "Include chats that quote device-only mail".

---

### Task D1: MCP tools never rate LOW

**Files:** `src/renderer/packages/tools/risk-engine.ts` (`classifyToolRisk`, `getToolRiskTier`), `src/renderer/packages/model-calls/wrap-tools-approval.ts` (only if needed), tests in `risk-engine.test.ts`, `wrap-tools-approval.risk.test.ts`.

- [ ] **Step 1: Failing tests.** `getToolRiskTier('mcp__x__get_notes', 'Get notes', { id: 1 })` → `MEDIUM`; same for `mcp__github__list_issues`, `mcp__gmail__read_email`, `mcp__x__search` with no description; a built-in LOW tool (`read_video_url` with `{ builtin: true }`) stays LOW; MCP tool annotations (`readOnlyHint: true`, if the tool shape carries them anywhere) do not lower the tier. Wrap test: first call of `mcp__x__get_notes` asks with `allowAlways: true`; after the user picks Always in scope, the second call runs unasked; a secret-path argument still asks with `allowAlways: false`.
- [ ] **Step 2: Implement.** After computing the tier for a non-built-in tool whose name starts with `mcp__`, raise LOW to MEDIUM. Higher tiers are unchanged.
- [ ] **Step 3: Gates and commit** `fix(permissions): MCP tools ask once, then remember`.

### Task D2: Device-only turns close outside tools, and say so

**Files:** `src/renderer/packages/model-calls/stream-text.ts` (the local-only filter after the allowedTools filter), the message type in `src/shared/types/session.ts` (additive optional field), the answer footer component that renders under an assistant message, `translation.json`; tests in `stream-text.test.ts` and the footer component's test.

- [ ] **Step 1: Failing tests.** On a local-only turn (Ollama, chat holds local-only text): no tool whose name starts with `mcp__`, no `read_video_url`, no browser tools, no `generate_image` (plus the existing web tools) reaches the model; `computer_*` tools stay. An OpenAI non-local-only turn keeps them. When any tool was removed or the web toggle was on, the generated message carries `localOnlyToolsOff: true`, and the footer renders "Web and outside tools are off because this chat holds device-only mail." as muted text with no live region.
- [ ] **Step 2: Implement** in the existing filter (one list of outside-tool predicates); set the message flag where the turn's other metadata is written.
- [ ] **Step 3: Gates and commit** `fix(privacy): device-only turns close outside tools and say so`.

### Task D3: Gmail review on by default, plain caption

**Files:** `src/renderer/components/sources/AddSourceSheet.tsx`, `components/sources/SourceRow.tsx`, `components/first-run/SourceStep.tsx`, `translation.json`; their tests.

- [ ] **Step 1: Failing tests.** Picking Gmail in Add a source and in first run shows the switch on; other kinds keep their current default. With the switch on the Gmail caption reads "Dango reads new mail with your model to draft replies."; with it off, the existing off caption. Both are tied to the switch with `aria-describedby`.
- [ ] **Step 2: Implement; Step 3: gates and commit** `feat(sources): Gmail background review on by default`.

### Task D4: Turning review back on acts only on newer mail

**Files:** `src/shared/types/sources.ts` (`reviewEnabledAt: z.number().optional()`), the code that changes `backgroundReview` (`updateSource` callers in `SourceRow.tsx` and wherever the switch is saved), `src/renderer/packages/pm-pilot/pipeline.ts` (the "arrived after connect" check); tests in `pipeline.test.ts` and `sources` store tests.

- [ ] **Step 1: Failing tests.** Turning the switch from off to on stores `reviewEnabledAt = now`; on to off leaves it. The pipeline acts only on mail with `occurredAt > max(connectedAt, reviewEnabledAt ?? 0)`; mail stored while review was off is not judged or drafted after the switch comes back on, and stays in the records.
- [ ] **Step 2: Implement; Step 3: gates and commit** `fix(pm-pilot): review turned back on acts only on newer mail`.

### Task D5: Narrower settings export

**Files:** `src/renderer/storage/exportFilter.ts`, the export UI in `routes/settings/general.tsx` and `pages/SettingDialog/AdvancedSettingTab.tsx` (and the extracted helpers), `translation.json`; tests in `exportFilter.test.ts` and the export helper tests.

- [ ] **Step 1: Failing tests.** `isDeviceOnlyKey` is true for `integrations`, `review-entries`, `background-jobs` and any `source-cursor:` key, so they are neither exported nor imported. A chat session whose messages hold device-only text (`chatHoldsLocalOnly`) is left out of the export by default and included when the new checkbox "Include chats that quote device-only mail" is ticked; other chats and imported history are exported as before.
- [ ] **Step 2: Implement; Step 3: gates and commit** `fix(export): keep accounts, Review and jobs on the device; device-only chats only on request`.

### Task D6: Docs

- [ ] Known issues: mark the five "Left open" items as decided and fixed (#110), and keep the one-time "last 3 days" offer as an idea card on the board.
- [ ] `docs/log.md` lines for this plan and ADR 0016. Commit `docs: record the blocker decisions`.
