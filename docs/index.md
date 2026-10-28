---
okf_version: "0.2"
---
# Dango docs

Start here. [log.md](log.md) lists what changed, newest first. Work items and ideas live on the board in [`backlog/`](../backlog/).

# Decisions

* [0001-user-approved-knowledge-authority](adr/0001-user-approved-knowledge-authority.md) - User-approved knowledge authority (stable)
* [0002-project-scoped-knowledge](adr/0002-project-scoped-knowledge.md) - Project-scoped knowledge (stable)
* [0003-explicit-knowledge-source-connections](adr/0003-explicit-knowledge-source-connections.md) - Explicit knowledge source connections (stable)
* [0004-personal-assistant-capability-boundaries](adr/0004-personal-assistant-capability-boundaries.md) - Personal assistant capability boundaries (stable)
* [0005-independent-mobile-quick-chat](adr/0005-independent-mobile-quick-chat.md) - Independent mobile Quick Chat (stable)
* [0006-optional-hosted-sync-service](adr/0006-optional-hosted-sync-service.md) - Optional hosted sync service (stable)
* [0007-automatic-method-learning](adr/0007-automatic-method-learning.md) - Automatic method learning within existing authority (stable)
* [0008-central-hosted-knowledge-authority](adr/0008-central-hosted-knowledge-authority.md) - Central authority for hosted knowledge (stable)
* [0009-user-held-sync-recovery-key](adr/0009-user-held-sync-recovery-key.md) - User-held recovery key for encrypted sync (stable)
* [0010-pm-pilot-first-user](adr/0010-pm-pilot-first-user.md) - Small-agency PM as first external user (stable)
* [0011-maintainer-first-shared-core](adr/0011-maintainer-first-shared-core.md) - Maintainer first on a shared knowledge core; PM pilot as the next source (stable)
* [0012-rename-to-dango](adr/0012-rename-to-dango.md) - Rename the app from Chaeboxi to Dango, including internal identifiers, with a one-time data move (stable)
* [0013-everywhere-layer](adr/0013-everywhere-layer.md) - Knowledge in two layers: each scope plus a built-in Everywhere scope (stable)
* [0014-okf-knowledge-document-format](adr/0014-okf-knowledge-document-format.md) - OKF for curated knowledge documents, with Dango-owned approval, scope and revision controls (stable)
* [continuity/](adr/continuity/) - Continuity import ADRs 001–005 from the August growth discovery

# Specs

* [2026-09-05-daily-copilot-design](specs/2026-09-05-daily-copilot-design.md) - Dependable Daily Copilot — Proposed Technical Design (draft)
* [2026-09-06-product-refinement](specs/2026-09-06-product-refinement.md) - Personal assistant product refinement (draft)
* [2026-10-05-personal-assistant-design](specs/2026-10-05-personal-assistant-design.md) - Dango personal assistant design (draft)
* [2026-10-13-pm-pilot-design](specs/2026-10-13-pm-pilot-design.md) - Dango PM pilot design (stable)
* [2026-10-14-pm-pilot-phase-1-client-memory](specs/2026-10-14-pm-pilot-phase-1-client-memory.md) - PM Pilot Phase 1: Client Memory Implementation Plan (deprecated; see slice 10)
* [2026-10-16-redesign-brief](specs/2026-10-16-redesign-brief.md) - Total redesign brief: structure first, then a new look (draft)
* [2026-10-16-ux-flows](specs/2026-10-16-ux-flows.md) - UX flows for the redesign: trigger, steps, states and exits for every user journey (draft)
* [2026-10-17-clean-room-relicense](specs/2026-10-17-clean-room-relicense.md) - Remove or clean-room rewrite every upstream-derived file so Dango can leave GPL-3.0-only (draft)
* [2026-10-17-dango-theme-first-slice](specs/2026-10-17-dango-theme-first-slice.md) - First code slice of the redesign: Dango tokens, sidebar, composer, ReviewItem (draft)
* [2026-10-17-redesign-roadmap](specs/2026-10-17-redesign-roadmap.md) - The whole Dango redesign as thirteen plans: order, dependencies, the shared types every slice codes against, and how to run the plans (draft)
* [2026-10-17-slice-01b-shared-foundations](specs/2026-10-17-slice-01b-shared-foundations.md) - Slice 1b of the redesign: the shared pieces later slices import: Sheet with focus rules, undo with a 5 s toast and ⌘Z, the eight-state Mascot, the Review entries store, BackgroundJob types and the /new route (draft)
* [2026-10-17-slice-02-settings](specs/2026-10-17-slice-02-settings.md) - Slice 2 of the redesign: Settings in five sections plus Advanced, Agents replaces Copilots, Trust sheet, Memory and privacy layout, and the trust, cost, thinking and background-pause settings (draft)
* [2026-10-17-slice-03-scopes](specs/2026-10-17-slice-03-scopes.md) - Slice 3 of the redesign: projects become scopes, with Everywhere, client scopes, a scope page, the scope pill in the composer and moving chats between scopes (draft)
* [2026-10-17-slice-04-knowledge](specs/2026-10-17-slice-04-knowledge.md) - Slice 4 of the redesign: approved knowledge per scope and Everywhere, proposals from chat, approve, edit, remove, move, conflicts, undo, the Knowledge tab, and the one-time move of old memory (draft)
* [2026-10-17-slice-05-review-home](specs/2026-10-17-slice-05-review-home.md) - Slice 5: Review becomes the home screen: the feed, default renderers, keys, Trust arrival for non-knowledge actions, toolbar, empty states and the sidebar badge (draft)
* [2026-10-17-slice-06a-chat-thread](specs/2026-10-17-slice-06a-chat-thread.md) - Slice 6a of the redesign: the thinking live line, one-line tool blocks, the plan card with progress folded in, and artifacts in the inspector (draft)
* [2026-10-17-slice-06b-chat-actions-errors](specs/2026-10-17-slice-06b-chat-actions-errors.md) - Slice 6b of the redesign: message actions, the chat menu with undo, model errors with the fix as the button, rate-limit retries, ability checks, the cost sheet and the composer's / menu, drop overlay and first-chat suggestions (draft)
* [2026-10-17-slice-06c-permission-swarm-search](specs/2026-10-17-slice-06c-permission-swarm-search.md) - Slice 6c of the redesign: the tool permission sheet with per-scope grants, Swarm as one toggle with a live card and a folded result, and Search as a ⌘K overlay over chats, knowledge and sources (draft)
* [2026-10-17-slice-07-sources-background](specs/2026-10-17-slice-07-sources-background.md) - Slice 7 of the redesign: Settings › Sources, the add-source sheet (SR1–SR2), first sync and background review as background jobs with retries (SR3), Stop, and revoking a source (draft)
* [2026-10-17-slice-08-quick-chat-menu-bar](specs/2026-10-17-slice-08-quick-chat-menu-bar.md) - Slice 8 of the redesign: Quick Chat restyled to the QuickChat component, Rewrite replaces the Writing assistant, the menu bar item with mascot states, and the notification rules (draft)
* [2026-10-17-slice-09-first-run-responsive-a11y](specs/2026-10-17-slice-09-first-run-responsive-a11y.md) - Slice 9 of the redesign: the five-step first run replaces the Welcome dialog, the three window sizes (wide, rail + sheet, phone tabs), and the accessibility pass (one live region per turn, reduced motion, sheet focus, keyboard Review, targets, contrast), ending in a light and dark QA walk (draft)
* [2026-10-17-slice-10-pm-pilot-sources](specs/2026-10-17-slice-10-pm-pilot-sources.md) - Slice 10: Gmail and Asana as source kinds of client scopes, and flow 10 (route, retrieve, judge, act by tier; sent replies read back as proposals) on the shared core (draft)
* [260905-daily-copilot/](specs/260905-daily-copilot/) - Daily copilot roadmap, phases and evaluation

# Research

* [2026-08-11-computer-use-industry-parity](research/2026-08-11-computer-use-industry-parity.md) - Research Report: Computer Use Parity (Claude / GPT / Perplexity → Dango)
* [2026-10-05-copilotkit-reference-review](research/2026-10-05-copilotkit-reference-review.md) - CopilotKit reference review for Dango
* [2026-10-13-work-source-access](research/2026-10-13-work-source-access.md) - Work source access feasibility
* [2026-10-17-upstream-provenance](research/2026-10-17-upstream-provenance.md) - Which files on main still contain code, text or assets from the upstream GPLv3 project, before the redesign
* [2026-10-28-upstream-provenance-after-redesign](research/2026-10-28-upstream-provenance-after-redesign.md) - Upstream-derived code left on main after the redesign merged, with a work package for every flagged file
* [feature-gap-synthesis](research/feature-gap-synthesis.md) - Dango Feature Gap Synthesis (v2 — Evidence-Based)
* [provider-usage-adapter-spikes](research/provider-usage-adapter-spikes.md) - Provider usage adapter spikes (v1)
* [research-agent-video-url-reader-2026-08-10](research/research-agent-video-url-reader-2026-08-10.md) - Research Report: Agent Tool for Reading YouTube / Vimeo / TikTok / Facebook Video URLs
* [research-openclaw](research/research-openclaw.md) - OpenClaw Research Report
* [research-perplexity-scraping](research/research-perplexity-scraping.md) - Research Report: Perplexity-like Web Search & Scraping for AI Chat Apps
* [research-use-browser-use-computer-2026-08-11](research/research-use-browser-use-computer-2026-08-11.md) - Research Report: Use Browser & Use Computer for Dango

# Reference

Feature and architecture docs for the code as it is today:

* [adding-new-provider](adding-new-provider.md) - Adding a New Provider (Registry Architecture)
* [adding-provider](adding-provider.md) - Adding a New Provider to Dango
* [agents-multi-agent-rooms](agents-multi-agent-rooms.md) - Agents & multi-agent team rooms
* [browser-agent](browser-agent.md) - Browser Agent (use_browser)
* [code-standards](code-standards.md) - Code Standards
* [codebase-summary](codebase-summary.md) - Codebase Summary
* [computer-use](computer-use.md) - Computer Use (use_computer)
* [deployment-guide](deployment-guide.md) - Deployment Guide
* [design-guidelines](design-guidelines.md) - Dango Design Guidelines
* [hooks-and-commands](hooks-and-commands.md) - Commands and Hooks
* [integrations](integrations.md) - Integrations (Connected Accounts)
* [memory](memory.md) - Long-term Memory
* [new-session-mechanism](new-session-mechanism.md) - New Session Mechanism
* [openclaw-remote-setup](openclaw-remote-setup.md) - OpenClaw Remote Access via Cloudflare Tunnel
* [project-overview-pdr](project-overview-pdr.md) - Dango — Project Overview & Product Development Requirements
* [project-workspaces](project-workspaces.md) - Project Workspaces
* [provider-usage-status](provider-usage-status.md) - Provider Usage Status
* [rag](rag.md) - RAG / Knowledge Base
* [session-module-split-plan](session-module-split-plan.md) - Session Module Split Plan
* [skills](skills.md) - Skills
* [storage](storage.md) - Storage Architecture
* [system-architecture](system-architecture.md) - System Architecture
* [system-notifications](system-notifications.md) - System Notifications
* [testing](testing.md) - Testing Strategy and Implementation
* [token-estimation](token-estimation.md) - Token Estimation
* [video-url-reader](video-url-reader.md) - Video URL Reader (Agent Tool)

# Archive

* [archive/](archive/) - Finished plans and notes from earlier tools (plans/, claudedocs/, tasks/, superpowers). Read-only history.
