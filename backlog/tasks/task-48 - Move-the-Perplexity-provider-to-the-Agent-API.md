---
id: TASK-48
title: Move the Perplexity provider to the Agent API
status: Ideas
assignee: []
created_date: '2026-10-30T15:05:00Z'
labels:
  - providers
dependencies: []
references:
  - https://community.perplexity.ai/t/sonar-moving-to-agents-api/6061
  - https://llmgateway.io/blog/perplexity-sonar-api-retirement
priority: high
type: bug
ordinal: 66000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Perplexity retired its Sonar chat completions API on 2026-09-27 (announced by Perplexity staff in August), moving to the Agent API. Dango's Perplexity provider still calls that API through `@ai-sdk/perplexity` 3.0.x with the Sonar model ids sonar, sonar-pro, sonar-reasoning, sonar-reasoning-pro and sonar-deep-research, so Perplexity chats are probably failing today (not confirmed against a live key). `@ai-sdk/perplexity` 3.1.0 moves to the Agent API, despite being a minor version: model ids and provider options change, and sonar-pro and sonar-reasoning-pro reportedly have no direct successor. The dependency update in `chore/ai-sdk-6-latest` holds the package at `~3.0.63` so this change does not ship by accident. Perplexity is only a chat provider in Dango; web search does not use it.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Perplexity chat with a real API key streams an answer on the Agent API
- [ ] #2 Saved Perplexity chats and settings that name a retired Sonar model id still open, and the user is shown which model replaces it or that it is gone
- [ ] #3 The writing wire-policy tests in perplexity-writing.test.ts cover the Agent API request format
- [ ] #4 The `@ai-sdk/perplexity` range in package.json no longer pins 3.0.x
<!-- AC:END -->
