---
type: plan
status: draft
description: "Remove or clean-room rewrite every upstream-derived file so Dango can leave GPL-3.0-only"
generated: { by: claude/opus-5.5, at: 2026-10-17T13:50:00+07:00 }
---
# Clean-room rewrite and relicensing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reach a state where no file in the repo is upstream-authored or upstream-derived, proven by a repeatable scan, so the maintainer can choose a new license.

**Architecture:** The work runs in four stages:
1. A provenance scanner, checked into the repo, defines what "clean" means and runs on every PR.
2. Upstream files are deleted where the code is dead.
3. Everything else is rebuilt per work package (WP), by implementers who see only a written behaviour spec and not the upstream files. The UI packages (WP07, WP09, WP10) are clean-roomed from the upstream-derived UI the redesign left. The 2026-10-28 audit measured that the redesign mostly edited old UI files in place, so this is nearly all of the old UI.
4. A final gate: a full scan, a dependency license check and a legal review, then the license swap.

**Tech Stack:**
- Node ESM scripts, tested with Vitest
- `git blame` and `git cat-file`
- GitHub Actions
- Everything already in the app: React 18, Tauri 2, Jotai, Zustand, i18next

**Spec:**
- [Upstream provenance after the redesign](../research/2026-10-28-upstream-provenance-after-redesign.md), with its [`files.csv`](../research/2026-10-28-upstream-provenance-after-redesign/files.csv). This is the work list: every file that is not clean on `main` at `2e3a77ce`, with its class and its WP. In this plan, `files.csv` means this file.
- [Upstream provenance audit](../research/2026-10-17-upstream-provenance.md), the pre-redesign baseline at `3f7c2725`, kept for before and after counts
- [Redesign brief](2026-10-16-redesign-brief.md) and [UX flows](2026-10-16-ux-flows.md), the source specs for the UI packages

## Global Constraints

- **License.** It stays `GPL-3.0-only` until Task 17. Do not touch `LICENSE`, `NOTICE` or the `license` field in `package.json` before then.
- **History.** Do not squash, rewrite or delete git history before Task 17. The history is the evidence of who wrote what.
- **No new upstream code.** Never merge, cherry-pick or port code from `upstream/*` again. Keep the `upstream` remote only as a scan baseline.
- **Scan baseline.** These upstream refs are pinned, so results don't drift as upstream moves on:
  - `fe80192097fb5e6b32b0a6ac671361e0283cdd74`, the fork point
  - `40cbd8745c33ed67affc0854a9b59f244919fe5e`, upstream `main` on 2026-10-17
  - `0ac6385ae1ff5bf778777826da3c5edcd55b61b8`, upstream `main` on 2026-09-24, the newest at the 2026-10-28 audit

  The audited ref is `2e3a77cebb305b91c47f96eb803ea66be67ef779`, which is `main` after the redesign. The pre-redesign audit used `3f7c27254b6866b7a1582e2cd6eb28abfb527e5c`. To pick up a newer upstream release, add its commit to the list and refresh the audit.
- **Team authors.** A blamed line counts as team when its commit's author email matches `/thong|nikethai|canvilled|huyminh|huynguyen|noreply@anthropic\.com/i` **and** the commit is not reachable from any pinned upstream baseline. Every other line counts as upstream.
  - `noreply@anthropic.com` is the author of commits Claude made for the team: 352 on the fork as of 2026-10-28. Leaving it out would credit about 90,000 lines to upstream.
  - Upstream has two commits from that address, `2168dd3d` and `a01fe3f9`, on side branches that none of the pinned baselines reach. The reachability check keeps them upstream if a later baseline ever includes them.
  - If anyone else commits, add their address to `config.json` before their first PR.
- **Clean bar.** A file is clean when it has 0 upstream blame lines under `git blame -w -M -C -C` and 0 copy-check matches, apart from boilerplate hashes listed in `scripts/provenance/allowlist.txt`.
- **PR gate (ratchet).** A PR may not add upstream-derived code. Many files stay upstream-derived until their own WP rewrites them, and earlier WPs still have to edit them: Task 1 touches `package.json`, and every WP rewires callers in other packages. So the gate checks each changed file against the PR's merge base with `main`, not against the clean bar. It fails when:
  - a file added by the PR is not clean;
  - a file that was clean at the merge base is no longer clean;
  - a file that was already flagged has more upstream blame lines, or more copy-matched lines, than at the merge base.

  Editing or shrinking a flagged file passes, because edited lines are credited to their new author. Whether a WP is finished is checked separately, with `--summary`, when the WP's rows are at 0.
- **Clean-room rule.** The implementer of a WP must not open the files listed for that WP in `files.csv`, their git history, or the upstream repo. They work from the WP spec and the public interfaces of clean modules only. Only the spec writer reads the upstream files, and the spec contains no code.
- **AI implementers.** Give the agent only the WP spec, `AGENTS.md` and the clean modules it calls. Never paste an upstream file into the prompt and never ask it to "rewrite this file". The upstream repo is public and may be in model training data, which is why the scanner runs on every PR.
- **Allowed carry-overs.** Only functional identifiers needed so existing user data still loads may be kept: storage keys, settings and session JSON field names, provider IDs, IPC command names. Each WP spec lists them under "Compatibility boundary". Anything not listed is renamed or redesigned.
- **Repo conventions.** Biome formatting, the `pnpm check`, `pnpm lint` and `pnpm test` gates, specs in `docs/specs/`, one line in `docs/log.md` per spec, and OKF 0.2 frontmatter, all as described in `AGENTS.md`.
- **Commit trailers.** Each WP commit carries `Clean-room: WPxx` and a `Signed-off-by:` line (DCO).
- **Runs after the redesign (maintainer decision, 2026-10-17).** Start Task 1 only after every slice in the [redesign roadmap](2026-10-17-redesign-roadmap.md) has merged. The redesign PRs are not bound by this plan: they may edit existing files, and the clean-room rule and provenance gate do not apply to them. This plan then measures and cleans what they left. **Met on 2026-10-22:** PR #110 was the last redesign merge, and the [2026-10-28 audit](../research/2026-10-28-upstream-provenance-after-redesign.md) measured what is left.

## Review Focus

1. **Existing installs.** Settings, sessions, blobs and provider keys written by the current release must still load after the stores and platform packages are replaced. This is pinned by a snapshot round-trip test in Task 7.
2. **An AI implementer reproducing upstream code from memory.** Every PR must fail CI if it adds upstream-derived lines, whether in a new file or an existing one. It must still pass when it only rewires an upstream-derived caller. Both are pinned by the ratchet tests in Task 1.
3. **Missing translations after the i18n rebuild.** If a key is missing, the user sees the raw key instead of text. Every `t()` key used in source must exist in English and in every shipped locale. This is pinned in Task 14.
4. **Platform drift.** Desktop, web and mobile must keep the same storage and blob behaviour after the platform rewrite. One contract suite runs against all three implementations, pinned in Task 8.
5. **Custom provider configs.** An existing OpenAI-compatible custom provider must keep its base URL, model list and key after the provider rewrite. This is pinned by a fixture test in Task 9.

---

## Clean-room procedure (used by Tasks 6–15)

Each WP task names its files, its spec path, its compatibility boundary and any extra tests. The steps are always these:

- [ ] **Spec.** The spec writer reads the WP's upstream files and writes `docs/specs/clean-room/WPxx-<name>.md` from `_template.md`. It contains numbered observable behaviours, the compatibility boundary, and test cases as tables of input → expected output. It contains no code and no internal names outside the boundary. The second maintainer checks it for code before it is used. Add a line to `docs/log.md`.
- [ ] **Failing tests.** The implementer writes Vitest tests from the spec's test tables, in new files. Run `pnpm test -- <new test files>`; they should FAIL because the module does not exist yet.
- [ ] **Implement.** Write the module in new files and new paths from the spec alone. Run `pnpm test -- <new test files>`; they should PASS.
- [ ] **Switch and delete.** Point the callers at the new module and delete every file of the WP in the same PR. Then:
  - Run `pnpm check && pnpm lint && pnpm test`; all should PASS.
  - For UI WPs, also run `pnpm build:web` and open the affected screens in `pnpm dev`.
- [ ] **Scan.** Run `pnpm provenance --changed --fail`. It should exit 0: every new file is clean, and no changed file gained upstream lines (the PR gate above). Then run `pnpm provenance --summary`; the WP's rows should be at 0. If a hit is boilerplate, add its hash and a reason to `allowlist.txt`; the reviewer signs off on each entry.
- [ ] **Commit** with the trailers above, then move the WP's Backlog card to Done using the `backlog` CLI.

---

### Task 1: Provenance scanner and CI gate

**Files:**
- Create: `scripts/provenance/scan.mjs`, `scripts/provenance/cli.mjs`, `scripts/provenance/config.json`, `scripts/provenance/allowlist.txt`
- Test: `scripts/provenance/scan.test.mjs`
- Create: `.github/workflows/provenance.yml`
- Modify: `package.json` (add a `"provenance": "node scripts/provenance/cli.mjs"` script)
- Modify: `vitest.config.mts:13` (add `'scripts/**/*.test.mjs'` to `include`; today it covers only `src/**` and `test/integration/**`)

**Interfaces:**
- Produces:
  - `normalizeLines(text: string): { line: number; text: string }[]`
  - `shingleHashes(lines, k = 4): { from: number; to: number; hash: string }[]`
  - `buildCorpus(repo: string, refs: string[]): Promise<Map<string, Set<string>>>`
  - `matchFile(text: string, corpus): { significant: number; matched: number; sources: string[] }`
  - `blameFile(repo, ref, path, teamPattern: RegExp, baselineRefs: string[]): Promise<{ team: number; upstream: number }>`
  - `classify(r: { identical: boolean; team: number; upstream: number; significant: number; matched: number }): 'identical' | 'upstream' | 'mixed' | 'trace' | 'clean'`
  - `ratchet(base: FileResult | null, head: FileResult): { ok: boolean; reason?: string }`. `base` is the file at the merge base, or `null` for a file the PR adds; `FileResult` holds the classification and its counts.
- CLI flags:
  - `--ref <ref>` (default `HEAD`)
  - `--paths <glob…>`
  - `--changed`: files changed against the merge base with `origin/main`, each scanned at both ends and judged by `ratchet`
  - `--fail`: exit 1 on any failure. With `--changed` that means a ratchet failure; otherwise, any non-clean, non-allowlisted file.
  - `--csv <out>`
  - `--summary` (counts per WP, using `files.csv` for the mapping)
  - `--all` (turn off the `config.json` exclusions; used for the baseline regression)

- [ ] **Step 1: Write the failing tests.** In `scripts/provenance/scan.test.mjs`:
  - **Normalisation:**
    - `normalizeLines('  const   a = 1234567890\n}\nimport x from "y"\nshort')` returns `[{ line: 0, text: 'const a = 1234567890' }]`.
    - Lines shorter than 10 characters, and lines matching `^[\s{}()\[\];,]*$|^(import|export \{|\} from|//|/\*|\*|<\/)`, are dropped.
  - **Shingles:** 5 significant lines give 2 shingles. The first covers `{ from: 0, to: 3 }`, and each hash is 16 hex characters (the first 16 of an md5 of the 4 lines joined with `\n`).
  - **Matching:**
    - A file sharing exactly 4 consecutive significant lines with the corpus gives `matched === 4`.
    - A file sharing 3 gives `matched === 0`.
  - **Classification:**
    - `identical: true` gives `'identical'`.
    - A share of 0.85 gives `'upstream'`, 0.5 gives `'mixed'`.
    - `upstream: 2` with a share of 0.05 gives `'trace'`.
    - All zero gives `'clean'`.
    - Share is `max(upstream / (team + upstream), matched / significant)`. Thresholds: ≥ 0.8 is upstream, ≥ 0.1 is mixed.
  - **Baseline regression** (skipped when the `fe801920` or `0ac6385a` object is missing): `--ref 2e3a77ce --all` reproduces the 2026-10-28 audit's class counts over all 2,437 files: identical 268, upstream 226, mixed 169, trace 297, clean 1,477.
  - **Team pattern:**
    - A line authored by `noreply@anthropic.com` on the fork counts as team.
    - A line whose commit is reachable from a baseline ref counts as upstream, even when its author matches the team pattern.
  - **Ratchet:**
    - A new file with 4 upstream lines fails.
    - A clean file that gains an upstream match fails.
    - A mixed file whose import line is rewired passes.
    - A mixed file that gains 4 copy-matched lines fails.
    - A mixed file that loses lines passes.
- [ ] **Step 2: Run the tests.** `pnpm test -- scripts/provenance`; expect FAIL because the module is not found.
- [ ] **Step 3: Implement `scan.mjs` and `cli.mjs`.**
  - Blame uses `git blame -w -M -C -C --line-porcelain`. It reads each line's commit and `author-mail`, and checks the commit against the baselines with `git merge-base --is-ancestor`, cached per commit.
  - Identical files are detected by blob SHA membership in `git rev-list --objects fe801920 0ac6385a`.
  - The corpus covers every text blob in the trees of the three pinned baseline refs, filtered by extension: `ts tsx js jsx mjs cjs mts css scss rs json html astro svelte yml yaml sh md kt swift`.
  - `config.json` holds the team pattern, the pinned refs and the path exclusions: every `pnpm-lock.yaml` and `Cargo.lock`, plus `LICENSE`, `NOTICE` and `docs/archive/`. `--all` turns off only the path exclusions.
  - Binaries and files ending in `.lock` are never blamed. `ios/App/Podfile.lock` is therefore in scope but always classed clean. The audit counts depend on this, so keep it as is.
  - Run file blames 8 in parallel. A full blame of `main` takes about 15 minutes on 2 cores, so `--changed` is what CI runs.
- [ ] **Step 4: Run the tests.** `pnpm test -- scripts/provenance`; expect PASS. Then run `pnpm provenance --ref 2e3a77ce --summary`; it should print 16 WPs whose totals match the table in the 2026-10-28 audit (951 files, 79,699 lines).
- [ ] **Step 5: CI.**
  - `provenance.yml` runs on `pull_request`.
  - It checks out with `fetch-depth: 0`, then runs `git fetch https://github.com/chatboxai/chatbox.git 0ac6385ae1ff5bf778777826da3c5edcd55b61b8 40cbd8745c33ed67affc0854a9b59f244919fe5e` and `pnpm provenance --changed --fail`. `fe801920` is already in the fork's own history.
  - Tag both baselines:
    - `git tag provenance-baseline-2026-10-17 3f7c2725`
    - `git tag provenance-baseline-2026-10-28 2e3a77ce`
    - `git push origin provenance-baseline-2026-10-17 provenance-baseline-2026-10-28`
- [ ] **Step 6: Commit** with the message `build(provenance): add upstream provenance scanner and PR gate`.

### Task 2: Clean-room process docs

**Files:**
- Create: `docs/clean-room.md`, `docs/specs/clean-room/_template.md`, `CONTRIBUTING.md`
- Replace: `.github/PULL_REQUEST_TEMPLATE.md` and `.github/ISSUE_TEMPLATE/*` (identical upstream files, written fresh)
- Modify: `docs/index.md`, `docs/log.md`

- [ ] **Step 1: Write `docs/clean-room.md`.** It holds three things:
  - The Global Constraints above.
  - A roles table:

    | Role | Who | Reads upstream files? |
    |---|---|---|
    | Spec writer | A maintainer | Yes |
    | Implementer | A fresh agent or a person | No |
    | Reviewer | The other maintainer | Only to check the spec |

  - An honest limitation: both maintainers have read upstream code, so the implementer should be a fresh agent given the spec only, with a human reviewer.
- [ ] **Step 2: Write `_template.md`** with these sections: Purpose · Behaviours (numbered) · Compatibility boundary (exact keys and IDs) · Test cases (tables) · Out of scope · Upstream files covered (paths only).
- [ ] **Step 3: Write `CONTRIBUTING.md` and the new templates.**
  - `CONTRIBUTING.md` requires DCO `Signed-off-by` and asks contributors to agree to licensing under the project's chosen license.
  - Write the PR template and issue templates fresh. The PR template has the checkboxes "Clean-room WP: __" and "`pnpm provenance --changed --fail` passes".
- [ ] **Step 4: Scan.** `pnpm provenance --paths .github CONTRIBUTING.md docs/clean-room.md --fail`; expect exit 0.
- [ ] **Step 5: Commit and log.** Commit with `docs: add clean-room process and contribution terms` and add a log line.

### Task 3: WP00 — delete dead upstream code

**Files:** the 65 rows with `work_package = WP00` in `files.csv` (2,955 lines). The largest are:
- `pages/SettingDialog/AdvancedSettingTab.tsx`
- `index.ejs`
- `storage/SQLiteImageGenerationStorage.ts`
- `knowledge-base/RemoteRetryModal.tsx`
- `common/ConfirmDeleteButton.tsx`
- `components/ui/command.tsx`, which the redesign stopped using
- `mcp/MCPMenu.tsx`
- 9 unused icon components
- 17 unused provider PNGs in `static/icons/providers/`
- `static/wechat_qrcode.png`

The usage check resolves `@/`, `@shared/` and relative imports in `src/`. A separate check of build and test config, scripts and workflows found no references to `index.ejs`, `index.web.ejs`, `setupTests.ts`, `test.tsx` or `static/_headers`: Vite uses `index.html`, and Vitest has `setupFiles: []`.

Some tests keep lists of file paths and will fail once those files are deleted. `components/ui/sheetInventory.test.ts` lists `knowledge-base/RemoteRetryModal.tsx`, and a comment in `storage/exportFilter.test.ts` names `AdvancedSettingTab.tsx`.

- [ ] **Step 1: Delete in one pass.** `git rm` every WP00 path.
- [ ] **Step 2: Build.** Run `pnpm check && pnpm build:web && pnpm test`.
- [ ] **Step 3: Restore what is still used, update what only lists it.**
  - For each import error, restore that one file and change its WP in `files.csv` to the matching topic WP.
  - For a test that fails only because a path list or comment names a deleted file, remove the entry, such as the `RemoteRetryModal.tsx` line in `sheetInventory.test.ts`. Run `git grep` for each deleted file name to find these.
  - Re-run Step 2 until it passes.
- [ ] **Step 4: Dev routes (maintainer decision).** `src/renderer/routes/dev/*` holds 5 identical upstream files and 1 upstream file, about 1,040 lines; they are listed under WP09. The redesign also added `dev/design-system.tsx`, which is a trace only. Delete the upstream ones unless the maintainer keeps Dev tools in Advanced; if they are kept, they stay in Task 13.
- [ ] **Step 5: Scan and commit.** Run `pnpm provenance --summary`; WP00 should show 0 files. Commit with `chore: remove unused upstream code and assets`.

### Task 4: WP13 — build config and tooling

**Files:** the WP13 rows:
- `package.json`, `.gitignore`, `tailwind.config.js`, `biome.json`, `tsconfig.json`, `vitest.config.mts`
- `vite.renderer.config.mts`, which is mixed
- `.npmrc`, `.gitattributes`, `postcss.config.js`, `i18next-parser.config.mjs`, `pnpm-workspace.yaml`
- `patches/libsql@0.5.22.patch`, `scripts/delete-source-maps.cjs`
- To delete: `.eslintrc.js`, `.eslintignore`, `.prettierrc` (the repo uses Biome) and `script/translate.mjs` (replaced in Task 14)

**Interfaces:** the config must produce the same build outputs, the same path aliases (`@/*` → `src/renderer/*`, `@shared/*` → `src/shared/*`) and the same env-var surface. Rename the `CHATBOX_*` vars to `DANGO_*`, keeping the old names as fallbacks for one release.

- [ ] **Step 1: Rewrite the config from tool docs.** Write each config file from the tool's own documentation and your current needs, not from the old file. Check whether the libsql patch is still needed with `grep -r libsql src`; if nothing uses libsql, drop the dependency and the patch.
- [ ] **Step 2: Rebuild everything.** Run `pnpm install && pnpm check && pnpm lint && pnpm test && pnpm build:web && pnpm build`; all should PASS.
- [ ] **Step 3: Scan and commit.** Run `pnpm provenance --paths <WP13 paths> --fail`, then commit with `build: rewrite build and tooling config`.

### Task 5: WP14 and WP15 — assets, docs, repo meta

**Files:** the WP14 and WP15 rows, except the `.github` templates already replaced in Task 2.

- [ ] **Step 1: Assets.**
  - Old app icons: `assets/icon*.png`, `icon.svg`, `iconTemplate*`. Delete them if `src-tauri/icons` is the live set, which is clean; otherwise replace them with the Dango icon.
  - Third-party brand logos: re-download each from the brand's official press kit or another permissively licensed source, and record the source in `src/renderer/static/logos/SOURCES.md`.
  - `assets/installer.nsh` and `entitlements.mac.plist`: write fresh from the Tauri docs.
- [ ] **Step 2: Docs.**
  - Rewrite these from the current code: `docs/adding-new-provider.md` and `docs/adding-provider.md` (merge into one), `docs/testing.md`, `ERROR_HANDLING.md`, `README.md` and `test/cases/*.md`.
  - Delete `docs/session-module-split-plan.md` (identical upstream), `scripts/ralph/*` and `team-sharing/*` (upstream self-hosting kit).
- [ ] **Step 3: `docs/archive/` (maintainer decision).** It has 6 upstream-text files. Either delete them, overriding the read-only rule with a log line, or accept them as a documented exception at the final gate.
- [ ] **Step 4: Scan and commit.** Run `pnpm build:web`, then `pnpm provenance --paths assets docs README.md test/cases team-sharing scripts --fail`, then commit with `docs: replace upstream docs, templates and assets`.

### Task 6: WP11 — shared utilities and hooks

**Files:** the WP11 rows (53), including:
- `lib/format-chat.tsx`
- `shared/file-extensions.ts`
- `shared/request/request.ts`
- `shared/utils/message.ts`, `renderer/utils/message.ts`
- `shared/utils/cache.ts`, `utils/model-tester.ts`
- `shared/utils/word_count.ts` (third-party MIT; confirm and keep the header, or replace)

**Spec:** `docs/specs/clean-room/WP11-utilities.md`

**Interfaces:** Produces whatever the spec names. Prefer a maintained library over a hand-written helper where one exists: `ky` or `ofetch` for requests, `lru-cache` for the cache, `mime` for file extensions.

- [ ] Follow the Clean-room procedure. Leaf functions first; hooks after.

### Task 7: WP04 — stores, storage, migration, types

**Files:** the WP04 rows (62). The largest are:
- `stores/migration.ts`, `sessionHelpers.ts`, `chatStore.ts`
- `stores/session/generation.ts`, `stores/session/forks.ts`
- `shared/types/settings.ts`, `shared/types/session.ts`

**Spec:** `docs/specs/clean-room/WP04-state-and-storage.md`

**Compatibility boundary:**
- `StorageKey` values
- the `session:{id}` and `file:{sessionId}:{msgId}:{uuid}` key formats
- settings and session JSON field names as written by `main` at `2e3a77ce`, which is config version 18 and includes the redesign's scopes, knowledge, Review entries and background jobs

The new `migration` supports data from the last release built before `2e3a77ce` onward only. Name that release in the spec. Dropping migrations for older upstream data versions is a maintainer decision, recorded in the spec.

- [ ] **Extra test (Review Focus 1).** Write `src/renderer/stores/__tests__/current-release-snapshot.test.ts`:
  - Load a scrubbed storage export from a real install of the current release, kept at `test/fixtures/current-release-store.json`.
  - Assert that every session, message count and provider key round-trips.
  - Assert that the settings produced by the new settings loader (named in the WP04 spec) serialise to the same JSON as the fixture settings, apart from fields the spec lists as migrated.
- [ ] Follow the Clean-room procedure. Follow `.claude/skills/dango-storage-migration` for the storage changes.

### Task 8: WP05 — platform, bootstrap, app shell

**Files:** the WP05 rows (39): `platform/*`, `index.tsx`, `Sidebar.tsx`, `setup/*`, `adapters/*`, `native/*`. They also include two files the redesign created: `theme/mantineTheme.ts`, whose 270 flagged lines of theme setup are carried over from upstream's `routes/__root.tsx`, and `theme/muiTheme.ts`, with 27 lines that blame credits to upstream.

**Spec:** `docs/specs/clean-room/WP05-platform.md`

**Compatibility boundary:** the Tauri IPC command names in `src-tauri/src/lib.rs`, which are already clean, and the storage layout from Task 7.

- [ ] **Extra test (Review Focus 4).** Write `src/renderer/platform/__tests__/platform-contract.test.ts`. One `describe.each([desktop with mocked IPC, web, test])` block runs the same cases against all three: set, get and delete a key; store and read back a blob; list keys after a restart of the store.
- [ ] Follow the Clean-room procedure, plus `.claude/skills/dango-cross-platform-change`. `Sidebar.tsx` is still mixed after the theme slice restyled it, so build it fresh. Write the theme files fresh from the Mantine and MUI docs and the Dango tokens.

### Task 9: WP03 — providers and model layer

**Files:** the WP03 rows (86):
- `shared/models/abstract-ai-sdk.ts`, `errors.ts`
- `model-calls/*`, `ModelSelector/*`, `model-setting-utils/*`
- `packages/model-errors/classify.ts`, new in the redesign, which carries error matching from upstream's `MessageErrTips.tsx`
- the `shared/providers/definitions/*` files flagged, including `minimax.ts` and `models/openai-responses.ts`, which were ported from newer upstream

**Spec:** `docs/specs/clean-room/WP03-providers.md`. The provider APIs themselves are documented by the vendors; write from their docs and the Vercel AI SDK docs.

**Compatibility boundary:** `ModelProviderEnum` values and the provider settings field names.

- [ ] **Extra test (Review Focus 5).** Write `src/shared/providers/__tests__/custom-provider-fixture.test.ts`:
  - Start from a settings fixture with an OpenAI-compatible custom provider (`apiHost: 'https://example.test/v1'`, two models, a key).
  - After the provider is resolved, assert that `baseURL === 'https://example.test/v1'`, the model IDs are unchanged and the key is unchanged.
- [ ] Follow the Clean-room procedure, plus `.claude/skills/dango-provider-change`.

### Task 10: WP02 — token estimation and context management

**Files:** the WP02 rows (19): `token-estimation/*` (computation-queue, analyzer, result-persister, task-executor), `context-management/*` and `model-context/index.ts`.

**Spec:** `docs/specs/clean-room/WP02-context.md`. It states the token budget rules and compaction thresholds as numbers, and that counts come from the tokenizer library.

- [ ] Follow the Clean-room procedure. Consider whether a simpler design, such as synchronous counting with a small cache instead of a queue and persister, meets the spec. A different structure also lowers the risk of the implementation converging on the upstream one.

### Task 11: WP06 — feature packages

**Files:** the WP06 rows (76).

- **Delete:** `packages/remote.ts`, the upstream hosted-cloud client (791 lines). Cloud is disabled per `AGENTS.md`; delete it together with its callers and the `stripChatboxPaidFeatures` remnants.
- **Replace the data:**
  - `settings/mcp/registries.ts` (615 lines, an upstream-compiled list): fetch from the official MCP registry, or curate your own list.
  - `packages/initial_data.ts` (563 lines of default sessions and copilots): write new defaults for the PM pilot, or ship none.
- **Clean-room:** the knowledge-base UI (`KnowledgeBaseDocuments.tsx`, `KnowledgeBase.tsx`, `KnowledgeBaseForm.tsx`; the Rust KB backend is already clean), the web-search settings and the MCP UI.

**Spec:** `docs/specs/clean-room/WP06-features.md`. Use the UX flows for the knowledge and sources screens.

- [ ] Delete `remote.ts` first. Then run `pnpm check && pnpm test` and commit with `chore: remove upstream cloud client`.
- [ ] Follow the Clean-room procedure for the rest.

### Task 12: WP08 — image creator

**Files:** the WP08 rows (12): `routes/image-creator/*`.

- [ ] **Maintainer decision.** The redesign moves Image studio to Advanced. Either rebuild it from a short spec, or remove it until it is wanted again; removing it is the cheaper path to clean.
- [ ] If rebuilding, follow the Clean-room procedure, with the spec at `docs/specs/clean-room/WP08-image-studio.md`.

### Task 13: WP07, WP09, WP10 — UI left after the redesign

**Files:** 244 files and about 14,300 upstream lines in total:
- **WP07 settings:** 56 rows, 3,369 lines
- **WP09 chat UI and components:** 168 rows, 9,574 lines
- **WP10 modals:** 20 rows, 1,400 lines

The largest are:
- `routes/settings/provider/$providerId.tsx`, `modals/SessionSettings.tsx`, `routes/settings/general.tsx`
- `InputBox/InputBox.tsx`, `chat/Message.tsx`, `Markdown.tsx`, `chat/MessageList.tsx`, `ActionMenu.tsx`
- `modals/MessageEdit.tsx`, `ModelEdit.tsx`

The redesign edited most of this UI in place rather than replacing it. Of the 206 files listed under these packages on 2026-10-17, 191 are still flagged (13,824 lines). One more, `static/Block.css` (109 lines), moved in from WP00 because the app uses it again.

It also added 52 new files here. Most are trace only, but two copy real upstream code:
- `routes/new.tsx` (131 lines, from upstream's `routes/index.tsx`)
- `settings/agents/AgentsSettings.tsx` (114 lines, from upstream's `routes/copilots.tsx`)

**Spec:** the [redesign brief](2026-10-16-redesign-brief.md) and [UX flows](2026-10-16-ux-flows.md) as shipped, which are team-authored. They describe the behaviour of the new UI, so the spec writer only adds a short WP spec where a flow leaves behaviour open, for example Markdown rendering rules.

- [ ] **Measure.** Run `pnpm provenance --summary` and confirm the WP07, WP09 and WP10 lists still match `files.csv`. Earlier tasks may have deleted some of these files along with their callers.
- [ ] **Delete dead files.** The files the redesign stopped importing are already in WP00 and go in Task 3. Delete any more that turn up unused.
- [ ] **Clean-room the rest.** For each remaining file, follow the Clean-room procedure: build the component fresh in new files from the flows and the spec, then delete the old file. Never edit an upstream-derived component into shape; restyling keeps it upstream-derived.
- [ ] **Done check.** `pnpm provenance --summary` shows WP07, WP09 and WP10 at 0 files.

### Task 14: WP01 — i18n rebuilt after the UI

**Files:** the WP01 rows (20):
- 13 non-English `translation.json` files
- `locales/en/translation.json`, which is mixed (its keys are upstream English sentences)
- `changelogs/changelog_{en,zh_Hans,zh_Hant}.ts`
- `i18n/index.ts`, `parser.ts`, `locales.ts`
- `for-key-scan.ts` is no longer imported, so it is deleted with WP00 in Task 3

This runs after Task 13, so the keys that only old UI used are already gone.

**Interfaces:**
- Keys become structured IDs, such as `settings.general.title`, written fresh per screen.
- English copy is written from the UX flows' copy rules, not by editing the old strings.
- Produces `scripts/i18n/translate.mjs`, a new machine-translation step that reads `en` and writes each locale.

- [ ] **Step 1: Failing coverage test (Review Focus 3).** Write `src/renderer/i18n/__tests__/key-coverage.test.ts`. It asserts that every key found by the i18next parser in `src/renderer` exists in `en` and in every shipped locale, and that no locale has keys missing from `en`. Run it; expect FAIL against the new key scheme.
- [ ] **Step 2: New i18n setup.** Write the new `i18n/index.ts` from the i18next docs, with English as the first-run language per `AGENTS.md`. Move the source to structured keys and write the new `en` copy.
- [ ] **Step 3: Old files out, new locales in.**
  - Delete the 13 old locale files and the three changelogs. Release notes come from your own GitHub releases instead.
  - Run `node scripts/i18n/translate.mjs` for the locales you choose to ship. Supporting fewer locales is fine.
- [ ] **Step 4: Verify.** Run `pnpm test -- src/renderer/i18n` (expect PASS), then `pnpm provenance --paths src/renderer/i18n --fail` (expect exit 0).
- [ ] **Step 5: Commit** with `feat(i18n): structured keys, new English copy, regenerated locales`.

### Task 15: WP12 sweep and trace sweep

**Files:**
- The remaining WP12 rows (155 on 2026-10-28, 90 of them new tests from the redesign). Most upstream tests will already have been deleted with their modules in Tasks 6–14.
- `test/integration/*`, including `file-conversation/test-harness.ts` and `context-management/context-management.test.ts`.
- All rows still classed `trace` in a fresh scan: 295 files and 1,532 lines on 2026-10-28. Most of them come from a few render helpers copied into new tests from `components/session/ThreadHistoryDrawer.test.tsx` and `chat/MessageList.test.tsx`. Write one clean shared test helper and switch the tests to it, rather than allowlisting each copy.

- [ ] **Step 1: List what is left.** Run `pnpm provenance --summary --csv /tmp/left.csv`. List the remaining WP12 and trace files.
- [ ] **Step 2: Integration tests.** For each remaining integration test, write a short spec of what it covers and rebuild it under the Clean-room procedure, or delete it if a unit test from an earlier WP covers the same behaviour.
- [ ] **Step 3: Trace lines.** For each trace file, the reviewer looks at the flagged lines (`git blame -w -M -C -C`) and either rewrites them or allowlists them as non-protectable boilerplate, with a reason.
- [ ] **Step 4: Verify.** `pnpm provenance --fail` across the whole repo should exit 0, apart from the documented exceptions (lock files, `LICENSE`, `NOTICE`, `docs/archive/` if kept).

### Task 16: Dependencies and brand

**Files:**
- Modify: `package.json`, `src-tauri/Cargo.toml`
- Create: `scripts/licenses/check.mjs`, `docs/research/<date>-dependency-licenses.md` (dated the day it is written)

- [ ] **Step 1: Write `scripts/licenses/check.mjs`.**
  - It wraps `pnpm licenses list --json --prod` and fails on any license outside an allowlist: MIT, ISC, BSD-2/3-Clause, Apache-2.0, 0BSD, Unlicense, CC0-1.0, BlueOak-1.0.0, MIT-0, Python-2.0, CC-BY-4.0, and the permissive side of dual licenses.
  - Record the choices for jszip → MIT, node-forge → BSD-3-Clause, dompurify → Apache-2.0 and harmony-reflect → Apache-2.0.
  - Resolve the 7 packages with no declared license, the two `@trapezedev` packages and the two FSL-1.1-MIT packages.
- [ ] **Step 2: Rust crates.** Run `cargo install cargo-deny && cargo deny init && cargo deny check licenses` in `src-tauri` with the same allowlist; expect PASS.
- [ ] **Step 3: Brand strings.** Rename the remaining "chatbox" strings in identifiers, env vars, Tailwind tokens and copy: 271 files at baseline. Use `rg -il chatbox` until only `NOTICE` and the fallback env reads remain.
- [ ] **Step 4: Verify and commit.** Run `pnpm check && pnpm test && pnpm build`, then commit with `chore: dependency license gate and brand cleanup`.

### Task 17: Final gate and relicense (maintainer)

- [ ] **Step 1: Full scan.** Run `pnpm provenance --fail --csv docs/research/<date>-provenance-final.csv`; it should exit 0. Attach the before and after counts to the ADR.
- [ ] **Step 2: Draft the ADR.** Write `docs/adr/00NN-relicense.md` (`status: draft`). It covers:
  - the target license
  - contributor consent: both maintainers sign, and any outside contributor since the fork must consent or their code is rewritten
  - the treatment of `docs/archive/`
  - the audit evidence
- [ ] **Step 3: Legal review.** A lawyer reviews the ADR, the clean-room docs and the final scan. The maintainer accepts the ADR (`status: stable` plus `verified`).
- [ ] **Step 4: Swap the license.**
  - Replace `LICENSE`.
  - Update `NOTICE`: drop the upstream-derived statement and keep the third-party notices, such as word-count if kept.
  - Update `package.json` `license` and the `src-tauri/Cargo.toml` `license` field.
  - Tag the release. Note that copies already released under GPL-3.0 stay available under GPL-3.0.
- [ ] **Step 5: History (only after Step 4).** Decide whether to collapse the pre-fork history using the cut at `fe801920`. Keep a private archive of the full history and both `provenance-baseline-*` tags either way.
