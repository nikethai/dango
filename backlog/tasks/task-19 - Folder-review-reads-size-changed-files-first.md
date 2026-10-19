---
id: TASK-19
title: Folder review reads size-changed files first
status: Ideas
assignee: []
created_date: '2026-10-19 10:53'
labels:
  - sources
  - performance
dependencies: []
ordinal: 37000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Folder listings carry no revision, so the folder read rotates through the least recently checked files; with thousands of files a changed file can wait weeks to be read. Storing each file's size beside its revision lets changed files be checked first. Found in the slice 07 final review (docs/specs/2026-10-17-slice-07-sources-background.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 A file whose size changed since the last read is read in the next run, regardless of folder size
<!-- AC:END -->
