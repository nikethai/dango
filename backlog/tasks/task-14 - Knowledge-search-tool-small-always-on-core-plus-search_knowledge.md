---
id: TASK-14
title: 'Knowledge search tool: small always-on core plus search_knowledge'
status: Ideas
assignee: []
created_date: '2026-10-18 05:41'
labels:
  - knowledge
dependencies: []
references:
  - docs/specs/2026-10-18-knowledge-search-tool.md
type: feature
ordinal: 32000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Plan: docs/specs/2026-10-18-knowledge-search-tool.md. Slice 4 caps approved knowledge in each prompt at 1,500 tokens, so with many notes Everywhere facts silently drop out. Replace with an always-on core (built-in, preferences, scope items; 1,000 tokens) plus a search_knowledge tool over knowledgeForTurn(scopeId); fallback to slice 4 for models without tools. Chosen over a background pre-selection agent (extra model call per turn).
<!-- SECTION:DESCRIPTION:END -->
