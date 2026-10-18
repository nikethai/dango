---
id: TASK-15
title: >-
  Web build: #root is aria-hidden because a hidden MUI search dialog stays
  mounted
status: Ideas
assignee: []
created_date: '2026-10-18 07:17'
labels:
  - a11y
dependencies: []
type: bug
ordinal: 33000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Found in slice 02's headless walk: on the web build #root carries aria-hidden from the hidden MUI SearchDialog (routes/__root.tsx), so screen readers and getByRole miss the page's controls. Pre-existing. Fix in slice 9's accessibility pass (or when 6c replaces Search with ⌘K): unmount the dialog when closed or use a non-modal container.
<!-- SECTION:DESCRIPTION:END -->
