# Long-term Memory

Cross-session, cross-model memory for Dango (community edition).

## What it is

- **Global bank** — shared for all chats and models (identity, prefs, durable facts)
- **Agent bank** — per-agent persona memory
- **Compressed profile** — short summary (+ optional profile slots) used in the always-on inject core
- **Entries** — short facts users can pin, edit, disable, archive, delete

Not the same as:

- **Session compaction** — short-term thread summary only
- **Knowledge base** — document RAG

## Retrieval modes (token strategy)

Default is **hybrid** so chats do not pay for the full fact list every turn.

| Mode | Injected every turn | Rest of bank |
|------|---------------------|--------------|
| **Hybrid** (default) | Policy + profile + **pinned** facts (small core budgets) | `memory_recall` tools + optional host keyword pre-search from the latest user message |
| **Always inject** | Profile + facts under large budgets (classic) | Tools still available for overflow |
| **On-demand** | Policy only (plus host pre-search hits if enabled) | Tools required; **falls back to hybrid inject** when the model cannot use tools |

**Pin** important identity/prefs so hybrid always includes them without a tool call.

**Host pre-search** (Advanced, default on): on every user message (hybrid / on_demand), the app runs **unified scored recall** (lexical + optional local semantic boost) **before** the model runs tools, injects a **Memory lookup** section (hits or explicit no-match), and shows a **Memory lookup** tool card in the UI.

## Scale & quality (S0–S5)

| Layer | Behavior |
|-------|----------|
| **S0 Metrics** | In-process counters: entry counts, presearch ms, auto-save stats. Dev: `window.__memoryMetrics()` |
| **S1 Quality** | Auto-save every **3** turns; fallback pin of raw messages **off**; near-dup merge; one scorer for host + tools + Settings |
| **S2 Index** | In-memory inverted token index + write coalesce (~200ms); prune prefers `lastAccessedAt` |
| **S3 Soft archive** | Over max entries → disable+archive instead of hard-delete (pins kept); Settings can show archived |
| **S4 Repository** | `MemoryRepository` + local FTS-style index (JSON source of truth; SQLite desktop can plug in later) |
| **S5 Semantic** | Local feature-hashed token vectors + fusion (no external embed API). Toggle in Advanced |

## User features

- Settings → **Memory**: manage global/agent banks, retrieval mode, budgets, auto-save, export/import
- Message menu → **Save to memory** (always pins to **Global**)
- Settings **Add memory** on Global / Agent tabs
- AI **auto-save** (default on): every **3** completed turns by default, the chat's model extracts facts and files them as knowledge proposals (`src/renderer/packages/knowledge/chat-proposer.ts`). Proposals wait for approval under the answer and in Review; the old memory banks are not written.
- Model tools: `memory_retain`, `memory_recall`, `memory_list`, `memory_forget`, `memory_update`, `memory_reflect`

Legacy **User Personal Info** is migrated into the global bank; `/settings/user-personal-info` redirects to Memory.

## UI affordances

- **Memory controls**: the composer brain button (next to `+`) and the `mem on · N` statusline chip open an in-chat Global memory popover
  - Search uses the same scored recall behavior as chat, with pinned/recent entries shown before searching
  - Click a tag chip to filter Global memories, then check multiple entries and use **Insert N selected** to add their facts to the draft together
  - **Insert** adds selected memories as removable composer chips. Hover a chip to preview its full content; the text is added to the model request only when the message is sent.
  - Type **`@mem`** or **`@memory`** in the composer to search memories from the keyboard; add a search phrase after a space, then use arrow keys plus Enter or Tab to attach the highlighted result.
  - **Save memory from draft** uses selected composer text first (otherwise the draft), requires review + optional tags, and saves unpinned by default
  - **Manage** opens Settings → Memory for full editing, archive, export, and advanced controls
- **Per-chat auto-save** (default **on**, inherits global Memory auto-save)
  - **Primary UI**: Memory dock (composer **brain** button or statusline **mem** chip) → **Auto-save this chat** switch at the top
  - Also in Session options → **Auto-save memories from this chat**
  - **Off** (`session.settings.memoryAutoSave === false`): no post-turn auto-extract and no model `memory_retain` for this chat
  - **Inject / host pre-search / recall tools** stay on when global Memory is enabled
  - **Manual Save to memory** (toolbar / composer) still works — explicit user intent
  - Statusline shows `on · N · auto-save off` when Memory inject is on but this chat opted out
- **Save to memory**: message action toolbar (brain icon), next to edit / more
- **Settings → Memory** tabs: **Global** | **Agents** | **Advanced**
  - Header: master **Enabled** / **Auto-save** + status strip (`On · N facts · ~T tokens`)
  - Bank workspace: profile card, search, primary **Add memory**, ⋯ menu (export / import / rebuild / clear)
  - Soft-archived / disabled: toggle **Show archived**
  - **Advanced**: retrieval mode, core vs full budgets, host pre-search, auto-save N turns, fallback pin, soft-archive, semantic boost, inject preview

## Write policy (global × session)

| Source | Global Memory off | Session auto-save off | Normal (both on) |
|--------|-------------------|------------------------|------------------|
| Auto-extract after N turns | blocked | blocked | allowed if global Auto-save on |
| Model `memory_retain` | blocked | blocked | allowed when tools available |
| Manual Save to memory | blocked | **allowed** | allowed |
| Inject / pre-search / recall | off | **on** | on |

## Troubleshooting empty bank

1. Confirm **Global** tab (not empty Agents with no agent selected).
2. Use **Add memory** on Global and type a fact — you should see “Saved to Global memory”.
3. Message toolbar **brain** icon (or mobile ⋯ → Save to memory).
4. Open **Inject preview** under Memory → Advanced to confirm the model prompt block.
5. In hybrid, **pin** facts that must always appear; unpinned facts need search / pre-search.
6. Auto-save needs chat generation to finish; toast shows update count or “no durable facts”.
7. Auto-save does **not** pin raw chat by default (enable **Fallback-pin** in Advanced if you want that).
8. If this chat has **Auto-save memories from this chat** off, auto-extract and model retain will not write — that is expected; inject can still show facts from other chats.

## Storage

| Key | Content |
|-----|---------|
| `memory-settings` | Feature flags, retrieval mode, budgets, caps |
| `memory-bank-global` | Global bank JSON |
| `memory:agent:{id}` | Per-agent bank JSON |

Writes are **coalesced** (~200ms) for bank keys; settings / clear / export flush immediately.

## Inject

Built in `packages/memory/inject.ts`, applied via `injectModelSystemPrompt` for every provider. Multi-agent rooms inject **global + current speaker’s agent bank**. Host pre-search uses unified `recallEntries` via `packages/memory/host-presearch.ts`.

## Architecture

```
src/shared/types/memory.ts
src/shared/types/settings.ts          # SessionSettings.memoryAutoSave
src/renderer/packages/memory/
  bank-ops.ts       # retain / prune / soft-archive / near-dup
  recall.ts         # unified scored recall
  query-index.ts    # inverted token index (local FTS)
  semantic.ts       # local token-vector fusion
  repository.ts     # MemoryRepository (LocalFtsMemoryRepository)
  metrics.ts        # S0 diagnostics
  session-policy.ts # per-chat auto-save / tool-retain gates
  inject.ts / tools.ts / persistence.ts
src/renderer/stores/memoryStore.ts
src/renderer/routes/settings/memory.tsx
src/renderer/components/settings/memory/
src/renderer/modals/SessionSettings.tsx  # per-chat auto-save switch
```

## Privacy

- Local by default; **optional self-hosted encrypted sync** — snapshots of memory
  settings plus global/agent banks can be pushed/pulled through your own
  self-hosted sync server (see `scripts/history-sync-server/README.md`). The
  server never sees plaintext: snapshots are encrypted client-side with a sync
  passphrase (PBKDF2-HMAC-SHA-256 + AES-GCM) before upload. There is **no
  passphrase recovery** — losing the passphrase makes remote memory
  unrecoverable.
- Secret redaction on write
- Master disable + clear bank
- Soft-archive keeps data local until hard clear / hard forget
