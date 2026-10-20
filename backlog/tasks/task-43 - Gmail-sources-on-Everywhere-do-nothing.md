---
id: TASK-43
title: Gmail sources on Everywhere do nothing
status: Ideas
assignee: []
created_date: '2026-10-20 18:24'
labels:
  - pm-pilot
dependencies: []
ordinal: 61000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A Gmail source added to Everywhere never gets client matchers, so slice 10 stores and acts on nothing for it, silently. Maintainer to decide: refuse Everywhere for Gmail in Add a source, or say on the row that it needs a client scope.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A Gmail source can't silently do nothing: either Everywhere is refused for Gmail or the row explains why it is idle
<!-- AC:END -->
