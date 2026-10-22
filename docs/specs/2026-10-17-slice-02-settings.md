---
type: plan
status: draft
description: "Slice 2 of the redesign: Settings in five sections plus Advanced, Agents replaces Copilots, Trust sheet, Memory and privacy layout, and the trust, cost, thinking and background-pause settings"
generated: { by: claude/opus-5.5, at: 2026-10-17T19:00:00+07:00 }
---
# Settings in Five Sections, Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Settings opens on five sections (Models and keys, Sources, Memory and privacy, Voice, General) with everything else under one Advanced group, every existing page still reachable, the Agents page as the only home of saved agents, Image studio reached from Advanced, and the `trustLevel`, `costWarningUsd`, `showThinking` and `backgroundPaused` settings, with controls for the first three and the Trust sheet.

**Architecture:** The flat `ITEMS` array in `routes/settings/route.tsx` becomes a pure nav model (`buildSettingsNav`) of entries, each owning one or more existing pages; an entry with several pages shows them as tabs above the content, so no existing page is rewritten or removed and every URL keeps working. Two new routes (`/settings/sources`, `/settings/privacy`) are added; the rest are regrouped. The four new settings are backward-compatible Zod fields with defaults, so no storage migration step is needed.

**Tech Stack:** React 18, TanStack Router (file routes, `routeTree.gen.ts` committed), Mantine 7, Zustand settings store, Zod, Vitest 4 (+ jsdom, Testing Library), slice 1b's `Sheet` and `pushUndo`, Lucide icons, Biome.

**Spec:** `docs/specs/2026-10-16-redesign-brief.md` (Surfaces › Settings; Decisions 1; Trust level; Acceptance), `docs/specs/2026-10-16-ux-flows.md` (flow 13 Change Trust; Screens: Settings, AGS1, TR1, KN3; "Gaps closed on 2026-10-17": Copilots become Agents, Cost, Knowledge after approval), `docs/specs/2026-10-17-redesign-roadmap.md` (Settings fields), `docs/adr/0010-pm-pilot-first-user.md`, `design/dango/README.md` (voice, sheets).

## Global Constraints

- Nothing is removed. Every page under `src/renderer/routes/settings/` stays at its current URL and is reachable from the nav; legacy redirects (`/copilots`, `/settings/copilots`, `/settings/user-personal-info`) keep working.
- Top level, in this order and with this copy: `Models and keys`, `Sources`, `Memory and privacy`, `Voice`, `General`, then a collapsible `Advanced`. Advanced rows, in order: `Usage`, `Web search providers`, `Browser agent`, `Computer use`, `Image studio`, `Video URL · Document parser`, `Chat settings`, `Skills · Commands · Hooks`, `Agents · MCP`, `Dev tools`.
- Pages the Advanced list does not name go where a non-technical PM looks for them: Integrations becomes the `Accounts` tab of Sources, Knowledge base the `Documents` tab of Sources (ux-flows: "The old Knowledge base is now the Documents source kind"), Memory and Sync are tabs of Memory and privacy, Keyboard shortcuts a tab of General. Acceptance: "A first-time PM reaches 'connect Gmail' and 'ask about a client' without opening Advanced."
- Platform gates stay exactly as today: Agents only when `platformCapabilities.supportsDesktopOnlySettings && platform.type === 'desktop' && CHATBOX_BUILD_PLATFORM !== 'android'`; MCP when `featureFlags.mcp`; Documents when `featureFlags.knowledgeBase`; Keyboard shortcuts unless `platformCapabilities.isMobileLayout`; Dev tools when `FORCE_ENABLE_DEV_PAGES` (`src/renderer/dev/devToolsConfig.ts`).
- Settings fields, names and defaults from the roadmap, verbatim: `trustLevel: 'auto' | 'ask'` (default `'auto'`), `costWarningUsd: number` (default `0.5`, `0` turns it off), `showThinking: 'auto' | 'open' | 'closed'` (default `'auto'`; `'auto'` = open in project scopes and chats with no scope, closed in client scopes), `backgroundPaused: boolean` (default `false`; slice 7's runner honours it, slice 8's menu bar toggles it, no control in this slice). Slices 5–8 read them; this slice only stores and edits them.
- Trust Auto never approves knowledge (roadmap Decisions, ADR 0001): Auto applies safe actions that are not knowledge; knowledge proposals always wait. The Trust sheet copy says so.
- Storage (skill `dango-storage-migration`): the four fields are `.default().catch()` Zod fields plus entries in `defaults.settings()`; the checklist says such fields need no migration step, so `CurrentVersion` in `src/renderer/stores/migration.ts` is not touched.
- Copy follows the README voice: sentence case (enforced for settings titles by `src/renderer/theme/settingsLabels.test.ts`), buttons name the action, no emoji, no exclamation marks. New strings go through `t()` with sentence-case keys.
- Decisions happen in sheets, never modals: slice 1b's `Sheet` from `src/renderer/components/ui/Sheet.tsx` (focus, Tab trap and Esc via its `useSheetFocus`); this slice does not build a sheet. A change a sheet makes is undoable through slice 1b's `pushUndo` from `src/renderer/packages/undo/` (5 s toast plus ⌘Z), not a hand-made toast.
- Colours, spacing and radii only from `--dango-*` variables; reuse `dg-*` classes from `src/renderer/static/dango-components.css` and do not edit that copied file.
- Needs: slice 1 (merged) and slice 1b (`Sheet`, `pushUndo`). Soft dependencies, coded against register names with fallbacks: slice 4 fills `useDontSuggestEntries` (its Task 9, via `listDontSuggest()` / `allowSuggestAgain(id)`) and adds the Everywhere row (`/scope/everywhere`) to Memory and privacy; until then the list is `[]` with its empty state; slice 7 fills Settings › Sources. This slice owns `useTrustSheet()` and the routes `/settings/sources`, `/settings/privacy` (register).
- Out of this slice: Sources content and the connect flow (slice 7); knowledge data, the memory migration and the Don't suggest again API (slice 4); scopes and Everywhere (slice 3); the Review toolbar's Trust button and how Trust changes item state (slice 5); the cost heads-up sheet CS1 and reading `showThinking` in the thinking line (slice 6); a scope's default agent and Swarm agent picking (slices 3 and 6); responsive and accessibility audit (slice 9).
- Expect a merge conflict in `src/renderer/Sidebar.tsx` with slice 3; Task 7 touches only the Imagine rows and the Image studio menu item.

## Review Focus

- Nothing removed: a page that exists as a route but has no nav row is lost to users. Pinned in Task 2 (`every settings route is reachable`).
- Deep link or reload into an Advanced page (`/settings/hooks`, `/settings/provider/openai`): Advanced must open, the right row must be current and the tabs must mark the right page. Pinned in Tasks 2 and 3.
- Old or hand-edited settings file (fields missing, `trustLevel: 'sometimes'`, `costWarningUsd: -1` or `"abc"`): the app loads with the defaults instead of failing to parse. Pinned in Task 1.
- Cost field: clearing it, typing a negative number or junk must not store `NaN`, a negative or silently turn the warning off; `0` must still be accepted as off. Pinned in Task 8.
- Trust sheet: Esc closes without saving; Undo (toast or ⌘Z, via `pushUndo`) restores the previous level; saving the same level pushes no undo. Pinned in Task 4.

---

### Task 1: Trust, cost, thinking and background settings

**Files:**
- Modify: `src/shared/types/settings.ts:589-593` (add the four fields after `trayIntroSeen`), and export the two types next to `Settings` (`:674`)
- Modify: `src/shared/defaults.ts:113-115` (add the four defaults after `trayIntroSeen: false`)
- Test: `src/shared/types/settings.test.ts` (new)

**Interfaces:**
- Produces: `SettingsSchema` fields `trustLevel: z.enum(['auto', 'ask']).default('auto').catch('auto')`, `costWarningUsd: z.number().min(0).default(0.5).catch(0.5)`, `showThinking: z.enum(['auto', 'open', 'closed']).default('auto').catch('auto')`, `backgroundPaused: z.boolean().default(false).catch(false)`; `export type TrustLevel = Settings['trustLevel']`, `export type ShowThinking = Settings['showThinking']`.

- [ ] **Step 1: Write the failing tests** in `settings.test.ts`:
  - `defaults carry the new fields`: `defaults.settings()` has `trustLevel: 'auto'`, `costWarningUsd: 0.5`, `showThinking: 'auto'`, `backgroundPaused: false`.
  - `an old settings payload gets the defaults`: `SettingsSchema.parse(old)` where `old` is `defaults.settings()` with the four keys deleted → the four defaults.
  - `junk values fall back`: `trustLevel: 'sometimes'` → `'auto'`; `costWarningUsd: -1`, `'abc'` and `Number.NaN` → `0.5`; `showThinking: 'always'` → `'auto'`; `backgroundPaused: 'yes'` → `false`.
  - `zero turns the cost warning off and is kept`: `costWarningUsd: 0` parses to `0`; `trustLevel: 'ask'`, `showThinking: 'closed'`, `backgroundPaused: true` are kept.
- [ ] **Step 2: Run** `pnpm test -- src/shared/types/settings.test.ts`. Expected: FAIL, `trustLevel` undefined.
- [ ] **Step 3: Implement** the four schema fields (each with a one-line doc comment quoting the roadmap meaning), the two types and the defaults.
- [ ] **Step 4: Run** `pnpm test -- src/shared/types/settings.test.ts src/renderer/stores/migration.test.ts` and `pnpm check`. Expected: PASS, no new tsc errors (the `Settings` return type of `defaults.settings()` forces the defaults in).
- [ ] **Step 5: Commit**: `feat(settings): add trust level, cost warning, thinking display and background pause settings`.

### Task 2: Settings nav model

**Files:**
- Create: `src/renderer/components/settings/settingsNav.ts` (pure: no React, no platform import)
- Create: `src/renderer/components/settings/settingsNavAvailability.ts`
- Test: `src/renderer/components/settings/settingsNav.test.ts`

**Interfaces:**
- Produces:
  ```ts
  import type { LucideIcon } from 'lucide-react'
  export type SettingsNavPage = { key: string; label: string; to: string }
  export type SettingsNavEntry = { id: string; label: string; icon: LucideIcon; pages: SettingsNavPage[]; leavesSettings?: boolean }
  export type SettingsNav = { sections: SettingsNavEntry[]; advanced: SettingsNavEntry[] }
  export type SettingsNavAvailability = { agents: boolean; mcp: boolean; knowledgeBase: boolean; hotkeys: boolean; devTools: boolean }
  export const ADVANCED_LABEL = 'Advanced'
  export function buildSettingsNav(available: SettingsNavAvailability): SettingsNav
  export function findSettingsEntry(nav: SettingsNav, pathname: string):
    { entry: SettingsNavEntry; page: SettingsNavPage; inAdvanced: boolean } | null
  // settingsNavAvailability.ts
  export function currentSettingsNavAvailability(): SettingsNavAvailability // the gates in Global Constraints
  ```
- The model (entry id → icon → pages as `label: to`); an entry's first page is where its row leads:

| Group | id | Label | Icon | Pages |
|---|---|---|---|---|
| sections | `models` | Models and keys | `KeyRound` | Providers: `/settings/provider` · Default models: `/settings/default-models` |
| sections | `sources` | Sources | `Plug` | Sources: `/settings/sources` · Accounts: `/settings/integrations` · Documents: `/settings/knowledge-base` (knowledgeBase) |
| sections | `privacy` | Memory and privacy | `ShieldCheck` | Privacy: `/settings/privacy` · Memory: `/settings/memory` · Sync: `/settings/sync` |
| sections | `voice` | Voice | `Mic` | Voice: `/settings/voice` |
| sections | `general` | General | `SlidersHorizontal` | General: `/settings/general` · Keyboard shortcuts: `/settings/hotkeys` (hotkeys) |
| advanced | `usage` | Usage | `ChartColumn` | `/settings/usage` |
| advanced | `web-search` | Web search providers | `Globe` | `/settings/web-search` |
| advanced | `browser-agent` | Browser agent | `AppWindow` | `/settings/browser-agent` |
| advanced | `computer-use` | Computer use | `Monitor` | `/settings/computer-use` |
| advanced | `image-studio` | Image studio | `ImagePlus` | `/image-creator`, `leavesSettings: true` |
| advanced | `video-docs` | (joined) | `FileText` | Video URL: `/settings/video-url` · Document parser: `/settings/document-parser` |
| advanced | `chat` | Chat settings | `MessageSquare` | `/settings/chat` |
| advanced | `skills` | (joined) | `Sparkles` | Skills · Commands · Hooks: `/settings/skills`, `/settings/commands`, `/settings/hooks` |
| advanced | `agents-mcp` | (joined) | `Bot` | Agents: `/settings/agents` (agents) · MCP: `/settings/mcp` (mcp) |
| advanced | `dev` | Dev tools | `Code` | `/dev` (devTools), `leavesSettings: true` |

  A page whose flag is false is left out; an entry left with no pages is dropped; "(joined)" labels are the remaining page labels joined with `' · '`. Single-page entries use the entry label as the page label. `findSettingsEntry` matches `pathname === to || pathname.startsWith(to + '/')`, ignoring a trailing slash.

- [ ] **Step 1: Write the failing tests** (`settingsNav.test.ts`, node env; `ALL` = every flag true, `NONE` = every flag false):
  - `five sections in order`: `buildSettingsNav(ALL).sections.map((e) => e.label)` equals `['Models and keys', 'Sources', 'Memory and privacy', 'Voice', 'General']`.
  - `advanced rows in order`: labels equal `['Usage', 'Web search providers', 'Browser agent', 'Computer use', 'Image studio', 'Video URL · Document parser', 'Chat settings', 'Skills · Commands · Hooks', 'Agents · MCP', 'Dev tools']`.
  - `gated pages drop out`: with `NONE`, the `agents-mcp` and `dev` entries are absent, Sources pages are `['Sources', 'Accounts']`, General pages are `['General']`; with only `mcp: true`, the entry is labelled `MCP`.
  - `every settings route is reachable`: list `src/renderer/routes/settings/*.tsx` plus `provider/route.tsx` with `readdirSync`, drop `route.tsx`, `index.tsx` and files whose source contains `throw redirect(`, map each to `/settings/<name>` (`provider/route.tsx` → `/settings/provider`), and expect every path among the `to` values of `buildSettingsNav(ALL)`. (The reverse check, every nav path has a route file, is added in Task 5 once `/settings/sources` and `/settings/privacy` exist.)
  - `deep links resolve`: `/settings/hooks` → entry `skills`, page `Hooks`, `inAdvanced: true`; `/settings/provider/openai` → `models`, `Providers`, `inAdvanced: false`; `/settings/voice/` → `voice`; `/settings` → `null`; `/settings/agents` with `NONE` → `null`.
  - `image studio leaves settings`: the `image-studio` entry has `pages[0].to === '/image-creator'` and `leavesSettings === true`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/settings/settingsNav.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `buildSettingsNav`, `findSettingsEntry` and `currentSettingsNavAvailability` (move the gate expressions from `routes/settings/route.tsx:42-164`).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(settings): nav model with five sections and an Advanced group`.

### Task 3: Settings nav, tabs and the Sources route

**Files:**
- Create: `src/renderer/components/settings/SettingsNav.tsx`, `src/renderer/components/settings/SettingsTabs.tsx`, `src/renderer/components/settings/SettingsNav.test.tsx`
- Create: `src/renderer/routes/settings/sources.tsx`
- Modify: `src/renderer/routes/settings/route.tsx` (delete `ITEMS` `:42-164` and the Tabler imports `:3-24` it alone used; `sectionLabel` `:202-205`; the nav `Stack` body `:292-340`; insert `<SettingsTabs>` before `<Outlet />` `:347`)
- Modify: `src/renderer/components/settings/settings-surfaces.css` (add `.settings-nav-group`, `.settings-tabs`)
- Regenerate: `src/renderer/routeTree.gen.ts`

**Interfaces:**
- Consumes: Task 2 `buildSettingsNav`, `findSettingsEntry`, `currentSettingsNavAvailability`, `ADVANCED_LABEL`.
- Produces:
  - `SettingsNav(props: { nav: SettingsNav; pathname: string; compact: boolean }): JSX.Element` — one `Link` row per entry to `entry.pages[0].to`, the current one with `aria-current="page"` and the existing `settings-nav-item-on` class; then a `button` "Advanced" with `aria-expanded` and `aria-controls` pointing at the Advanced list. Advanced starts open when `findSettingsEntry(nav, pathname)?.inAdvanced`, and opens when navigation lands inside it; the button toggles it. Rows keep the existing `settings-nav-link` / `settings-nav-item` classes, Lucide icons at 16 px stroke 1.8, and in `compact` mode the chevron and divider the current list has.
  - `SettingsTabs(props: { entry: SettingsNavEntry; pathname: string }): JSX.Element | null` — `null` for a single page; otherwise `<nav aria-label={t(entry.label)} className="settings-tabs">` with one `Link` per page, the current one `aria-current="page"`.
  - `SourcesSettingsPage(): JSX.Element` in `routes/settings/sources.tsx` (route `/settings/sources`): `SettingsPageHeader` title `Sources`, description `Folders, Gmail, Asana, Codex threads and documents Dango reads from. Each source belongs to one scope.`; one `SettingsCard` reading `No sources connected yet.` Slice 7 replaces the body.
- Header: the chrome title shows `findSettingsEntry(...)?.page.label` where it showed `sectionLabel`.
- CSS: `.settings-tabs` is a row of links with `gap: var(--dango-space-1)`, padding `var(--dango-space-4) var(--dango-space-8) 0`, links `color: var(--dango-ink-2)`, `border-radius: var(--dango-radius-md)`, current link `background: var(--dango-green-wash); color: var(--dango-green-text); font-weight: 600`; `.settings-nav-group` (the Advanced button) uses the label style: 12px, 600, `var(--dango-muted)`, no uppercase, no letter-spacing.

- [ ] **Step 1: Write the failing tests** in `SettingsNav.test.tsx` (jsdom; mock `react-i18next` as `BlankStateStarters.test.tsx` does; mock `@tanstack/react-router` `Link` as `({ to, children, ...rest }) => <a href={to} {...rest}>{children}</a>`; build the nav with every flag true):
  - at `/settings/provider`: links named `Models and keys`, `Sources`, `Memory and privacy`, `Voice`, `General` in that order; `Models and keys` has `aria-current="page"`; the `Advanced` button has `aria-expanded="false"` and no link named `Usage` is visible.
  - at `/settings/hooks`: `Advanced` is expanded; the link `Skills · Commands · Hooks` has `aria-current="page"`.
  - clicking `Advanced` at `/settings/provider` shows `Usage`, and the `Image studio` link has `href="/image-creator"`.
  - `SettingsTabs` for the `skills` entry at `/settings/hooks` renders three links, `Hooks` current; for the `voice` entry it renders nothing.
  - source check: `routes/settings/route.tsx` no longer contains `const ITEMS`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/settings/SettingsNav.test.tsx`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** both components, the route edits, the Sources route and the CSS; then run `pnpm build:renderer` so the router plugin regenerates `routeTree.gen.ts`.
- [ ] **Step 4: Run** `pnpm test -- src/renderer/components/settings src/renderer/utils/settings-navigation.test.ts src/renderer/theme/settingsLabels.test.ts`, `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(settings): five sections, Advanced group and section tabs`.

### Task 4: Trust sheet (TR1)

**Files:**
- Create: `src/renderer/components/settings/TrustSheet.tsx`, `src/renderer/components/settings/useTrustSheet.tsx`, `src/renderer/components/settings/TrustSheet.test.tsx`

**Interfaces:**
- Consumes: Task 1 `TrustLevel`; `useSettingsStore`, `settingsStore` from `@/stores/settingsStore`; slice 1b `Sheet({ opened, onClose, title, children, actions, hint })` from `@/components/ui/Sheet` (bottom by default; first focus on the primary action, Tab stays inside, Esc closes and returns focus) and `pushUndo({ message, undo, group?, durationMs? }): string` from `@/packages/undo`.
- Produces:
  - `export const TRUST_LABELS: Record<TrustLevel, string> = { auto: 'Auto', ask: 'Ask first' }`
  - `TrustSheet(props: { opened: boolean; value: TrustLevel; onClose(): void; onSave(level: TrustLevel): void }): JSX.Element` — pure; renders 1b's `Sheet` with a radio group of the two positions, preselected to `value`, and the hint passed as `Sheet`'s `hint` prop (only `Sheet.tsx` uses `dg-sheet` classes; slice 9 checks this).
  - `useTrustSheet(): { open(): void; sheet: JSX.Element }` (owned here per the register; slice 5's Review toolbar calls it) — saving a different level calls `setSettings({ trustLevel })`, closes, and calls `pushUndo({ message: t('Trust set to {{level}}. Items already in Review keep their state.', { level }), undo: () => setSettings({ trustLevel: previous }), group: 'other' })`; saving the same level only closes and pushes nothing.
- Copy, exact: title `Trust`. Auto: `Dango does safe things first and shows them in Review as Done, with Undo.` / `Labels and Gmail drafts, never sent. Knowledge always waits for you.` Ask first: `The same items wait in Review until you approve them.` / `Nothing is applied until you press Approve.` Hint: `Always asks, whatever you choose: sending anything, deleting, editing files, changing a decision, saving knowledge. Applies to items that arrive from now on.` Actions: `Cancel` (`dg-btn dg-btn--ghost`), primary `Use Auto` / `Use Ask first` following the selected radio (`dg-btn dg-btn--primary`).

- [ ] **Step 1: Write the failing tests** in `TrustSheet.test.tsx` (jsdom; `react-i18next` mocked with `{{level}}` interpolation; `@/stores/settingsStore` mocked with a small zustand store holding `trustLevel`; `@/packages/undo` mocked with a `pushUndo` spy; 1b's real `Sheet`):
  - with `value: 'auto'` the `Auto` radio is checked and the primary button reads `Use Auto` and has focus; choosing `Ask first` makes it `Use Ask first`; clicking it calls `onSave('ask')`.
  - Esc calls `onClose` and not `onSave`.
  - the hint text above is present, and the Auto copy contains `Knowledge always waits for you.`
  - `useTrustSheet`: open, choose `Ask first`, save → store `trustLevel === 'ask'`, `pushUndo` called once with `group: 'other'` and a message containing `Ask first`; calling its `undo` → `trustLevel === 'auto'`. Saving `Auto` while already `auto` → `pushUndo` not called.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/settings/TrustSheet.test.tsx`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `TrustSheet` and `useTrustSheet`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(settings): Trust sheet with undo`.

### Task 5: Memory and privacy page (KN3)

**Files:**
- Create: `src/renderer/routes/settings/privacy.tsx` (route `/settings/privacy`, renders `MemoryPrivacyPage`)
- Create: `src/renderer/components/settings/privacy/MemoryPrivacyPage.tsx`, `DontSuggestList.tsx`, `useDontSuggestEntries.ts`, `index.ts`, `MemoryPrivacyPage.test.tsx`
- Regenerate: `src/renderer/routeTree.gen.ts`

**Interfaces:**
- Consumes: Task 4 `useTrustSheet`, `TRUST_LABELS`; `navigateToSettings` from `@/modals/Settings`; `SettingsPage`, `SettingsPageHeader`, `SettingsSection`, `SettingsCard`, `SettingsPrefRow`.
- Produces:
  - `export type DontSuggestRow = { id: string; text: string; scopeLabel: string; at: number }` (a view row, named so it does not clash with slice 4's own type for `listDontSuggest()` results)
  - `DontSuggestList(props: { items: DontSuggestRow[]; onRestore(id: string): void }): JSX.Element` — empty: `Nothing here yet.` and `When you choose “Don't suggest this again” on a proposal, it is listed here so you can turn it back on.`; otherwise one row per item: text, `scopeLabel` and the date as caption, button `Suggest again` calling `onRestore(id)`.
  - `useDontSuggestEntries(): { items: DontSuggestRow[]; restore(id: string): Promise<void> }` — a stub in this slice: returns `{ items: [], restore: async () => {} }` with the comment `// slice 4 fills this hook (its Task 9): listDontSuggest() / allowSuggestAgain(id)`. Slice 4 fills the body, not the signature, so the page shows the empty state until then.
  - `MemoryPrivacyPage(): JSX.Element` — header `Memory and privacy`, description `What Dango keeps, what it may do before asking, and what it should stop suggesting.` Sections in order:
    1. `Trust`: row title `Trust level`, description `TRUST_LABELS[trustLevel]` plus ` · Dango does safe things first and shows you what it did.` (auto) or ` · Everything waits for your approval.` (ask); control button `Change` opening the Trust sheet.
    2. `Don't suggest again`: `DontSuggestList`.
    3. `Export`: row `Export your data`, description `Back up chats and settings to a file. Knowledge stays on this device.` (changed by the [blockers plan](2026-10-21-redesign-blockers.md)), button `Open backup` → `navigateToSettings('/general')` (General holds Data backup).
  - Not written here: the Everywhere row (`Open Everywhere` → `/scope/everywhere`), which slice 4 adds once slices 3 and 4 are merged.

- [ ] **Step 1: Write the failing tests** (`MemoryPrivacyPage.test.tsx`, jsdom, mocks as in Task 4 plus `@/modals/Settings`):
  - `DontSuggestList` with `[]` shows `Nothing here yet.`; with one item shows its text and `Suggest again`, whose click calls `onRestore` with its id.
  - `useDontSuggestEntries()` returns no items, so the page shows `Nothing here yet.`
  - the page shows the section titles `Trust`, `Don't suggest again`, `Export` in that order; the Trust row reads `Auto`; clicking `Change` opens a dialog named `Trust`.
  - `Open backup` calls `navigateToSettings('/general')`.
  - In `settingsNav.test.ts`, add `every nav page has a route`: each `to` starting with `/settings/` in `buildSettingsNav(ALL)` has a file `src/renderer/routes/settings/<name>.tsx` (or `<name>/route.tsx`).
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/settings/privacy`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and the route; run `pnpm build:renderer` to regenerate the route tree.
- [ ] **Step 4: Run** `pnpm test -- src/renderer/components/settings src/renderer/theme/settingsLabels.test.ts`. Expected: PASS, including `every nav page has a route`.
- [ ] **Step 5: Commit**: `feat(settings): Memory and privacy page with Trust and Don't suggest again`.

### Task 6: Agents replaces Copilots (AGS1)

**Files:**
- Create: `src/renderer/components/settings/agents/AgentsSettings.tsx`, `AgentForm.tsx`, `index.ts`, `AgentsSettings.test.tsx`
- Modify: `src/renderer/routes/copilots.tsx` (keep only the redirect route `:45-51`; move `BUILT_IN_TOOLS`, `HOOK_TYPES`, `FORMAT_OPTIONS` `:53-82`, `CopilotsContent` `:84-216`, `MiniItem` `:218-306`, `CopilotForm` `:308-814`, `getEmptyCopilot` `:816-827` out)
- Modify: `src/renderer/routes/settings/agents.tsx:1-10` (render `AgentsSettings`)
- Modify: `src/renderer/routes/routing.test.ts` (slice 1b's; its text check `routes/copilots.tsx` contains `to: '/new'` moves to `components/settings/agents/AgentsSettings.tsx`, where the select-agent navigation `{ to: '/new', search: { copilotId } }` now lives)

**Interfaces:**
- Consumes: `AgentDetail` (alias of `CopilotDetail`, `src/shared/types.ts:123`), `useMyCopilots`, `useRemoteCopilots` from `@/hooks/useCopilots`.
- Produces: `AgentsSettings(): JSX.Element` (was `CopilotsContent`), `AgentForm(props: { agent: AgentDetail; close(): void; save(agent: AgentDetail): void }): JSX.Element` (was `CopilotForm`), `getEmptyAgent(): Promise<AgentDetail>` (was `getEmptyCopilot`). Behaviour unchanged; storage key `StorageKey.MyCopilots` unchanged.
- Copy changes (everything else as is): header description `Saved agents: a name, a prompt, model settings, tool access, steps and hooks. Mention one with @ in the composer.`; button `New agent`; section `Your agents` (was My Agents); `Featured agents`, with description `Add one to your agents and open a chat.`; row `Show agents in a new chat` (was Show Agents in New Session); empty state `No agents yet. Create one, or add a featured agent below.`; form header `Edit agent`.

- [ ] **Step 1: Write the failing tests** (`AgentsSettings.test.tsx`, jsdom, in `MantineProvider`; mock `react-i18next`, `@/hooks/useCopilots`, `@/stores/uiStore`, `@tanstack/react-router` `useNavigate`, `@/packages/event`, `@/packages/remote`, `@/platform`):
  - no agents: heading `Agents`, button `New agent`, text `No agents yet. Create one, or add a featured agent below.`
  - one agent `{ name: 'Researcher', starred: false, usedCount: 0 }`: a button named `Researcher`; clicking `edit` on it shows `Edit agent`.
  - in 1b's `routes/routing.test.ts`, change the assertion `routes/copilots.tsx` contains `to: '/new'` to read `components/settings/agents/AgentsSettings.tsx` instead.
  - source checks: `routes/copilots.tsx` contains `throw redirect({ to: '/settings/agents' })` and no `export function`; `routes/settings/agents.tsx` imports from `@/components/settings/agents`; no file under `src/renderer` imports `@/routes/copilots`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/settings/agents`. Expected: FAIL.
- [ ] **Step 3: Implement** the move and renames, then the copy.
- [ ] **Step 4: Run** `pnpm test -- src/renderer/components/settings src/renderer/theme/settingsLabels.test.ts`, `pnpm check`. Expected: PASS.
- [ ] **Step 5: Commit**: `refactor(agents): Settings › Agents owns saved agents; Copilots is only a redirect`.

### Task 7: Image studio leaves the rail and the user menu

**Files:**
- Modify: `src/renderer/Sidebar.tsx` (`:22` `IconPhotoPlus` import, `:117-123` `handleCreateNewPictureSession`, `:322-331` icon-rail Imagine button, `:352-355` rail Imagine row, `:456-465` user-menu Image studio item)
- Test: `src/renderer/components/settings/imageStudioPlacement.test.ts`

**Interfaces:** consumes Task 2 `buildSettingsNav`. ⌘⇧N (`src/renderer/hooks/useShortcut.tsx:64-69`), "Generate image" from a message (`components/chat/Message.tsx:292`) and the composer's image button (`components/InputBox/InputBox.tsx:2705`) stay: they are ways into the studio, not rail or menu entries.

- [ ] **Step 1: Write the failing test** (node env, reading sources):
  - `Sidebar.tsx` contains none of `'/image-creator'`, `t('Imagine')`, `t('Image studio')`, `IconPhotoPlus`.
  - `useShortcut.tsx` still contains `to: '/image-creator'`.
  - `buildSettingsNav` with every flag false still has an Advanced entry `image-studio` leading to `/image-creator`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/settings/imageStudioPlacement.test.ts`. Expected: FAIL on the Sidebar check.
- [ ] **Step 3: Implement** the deletions; drop imports that become unused (Biome reports them).
- [ ] **Step 4: Run** the test, `pnpm check`, `pnpm lint`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(sidebar): Image studio moves to Settings › Advanced`.

### Task 8: Cost warning and thinking display controls

**Files:**
- Create: `src/renderer/components/settings/CostWarningRow.tsx`, `src/renderer/components/settings/ShowThinkingRow.tsx`, `src/renderer/components/settings/redesignRows.test.tsx`
- Modify: `src/renderer/routes/settings/default-models.tsx:176` (after the Models section: `<SettingsSection title={t('Cost')}><SettingsCard><CostWarningRow …/></SettingsCard></SettingsSection>`)
- Modify: `src/renderer/routes/settings/chat.tsx:252` (after the default-settings section: `<SettingsSection title={t('Thinking')}><SettingsCard><ShowThinkingRow …/></SettingsCard></SettingsSection>`)

**Interfaces:**
- Consumes: Task 1 fields and `ShowThinking`.
- Produces:
  - `normalizeCostWarning(input: string | number, previous: number): number` — empty string, non-numeric or non-finite → `previous`; negative → `0`; otherwise rounded to cents.
  - `CostWarningRow(props: { value: number; onChange(next: number): void }): JSX.Element` — `SettingsPrefRow` title `Ask before a costly run`, description `Dango asks before a run whose estimate is over this amount. 0 turns it off. Local models never ask.`; control a Mantine `NumberInput` with `prefix="$"`, `min={0}`, `step={0.1}`, `decimalScale={2}`, `aria-label` `Cost limit in US dollars`, holding a local draft and committing `normalizeCostWarning(draft, value)` on blur and Enter (the draft then resets to the committed value). `onChange` is called only when the committed value differs.
  - `ShowThinkingRow(props: { value: ShowThinking; onChange(next: ShowThinking): void }): JSX.Element` — `SettingsPrefRow` title `Show thinking`, description `Auto opens it in project scopes and chats without a scope, and keeps it closed in client scopes.`; control a `SegmentedControl` with `Auto` / `Open` / `Closed`.

- [ ] **Step 1: Write the failing tests** (`redesignRows.test.tsx`, jsdom, `MantineProvider`, `react-i18next` mocked):
  - `normalizeCostWarning`: `('', 0.5)` → `0.5`; `('abc', 0.5)` → `0.5`; `('-2', 0.5)` → `0`; `('0', 0.5)` → `0`; `('1.239', 0.5)` → `1.24`; `(Number.NaN, 0.5)` → `0.5`.
  - `CostWarningRow` with `value: 0.5`: the input shows `$0.5`; type `2`, blur → `onChange(2)`; clear the field and blur → `onChange` not called and the input shows `$0.5` again; type `0`, press Enter → `onChange(0)`.
  - `ShowThinkingRow` with `value: 'auto'`: clicking `Closed` calls `onChange('closed')`.
- [ ] **Step 2: Run** `pnpm test -- src/renderer/components/settings/redesignRows.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the two rows and mount them in the two pages with `useSettingsStore` / `setSettings`.
- [ ] **Step 4: Run** `pnpm test -- src/renderer/components/settings src/renderer/theme/settingsLabels.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(settings): cost heads-up limit and thinking display controls`.

### Task 9: Look at it, then record it

**Files:**
- Modify: `docs/log.md` (one line under the day the branch is finished), this plan (`status: stable` only when the maintainer accepts)

- [ ] **Step 1:** Run `pnpm dev:web` and capture light and dark screenshots of: `/settings/provider` (five sections, Advanced closed), `/settings/hooks` (Advanced open, three tabs), `/settings/privacy` with the Trust sheet open, `/settings/agents` (desktop build or dev flag), and `/settings` at 390 px wide. Compare with canvas screens Settings, KN3, TR1, AGS1: section order and copy, sentence case, one green current row, sheet from the bottom, no horizontal scroll at phone width.
- [ ] **Step 2:** Walk the acceptance line: from a fresh profile, reach Sources › Accounts (connect an account) without opening Advanced. Open `/copilots`, `/settings/copilots`, `/settings/user-personal-info` and confirm each redirect lands on a page with a current nav row.
- [ ] **Step 3:** Fix what the screenshots show; a pattern fix adds a line to the matching test. Commit `fix(settings): …`.
- [ ] **Step 4:** Run `pnpm test`, `pnpm check`, `pnpm lint`. Expected: all pass, tsc error count equal to `main`'s. Report Passed / Failed / Not run / Unavailable as `dango-verify-change` asks (mobile and Android not run here).
- [ ] **Step 5:** Add the log line, then commit `docs: log the settings slice`.
