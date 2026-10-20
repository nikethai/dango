---
id: TASK-15
title: >-
  Web build: #root is aria-hidden because a hidden MUI search dialog stays
  mounted
status: Done
assignee: []
created_date: '2026-10-18 07:17'
updated_date: '2026-10-20 03:38'
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

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed in slice 06c (feat/redesign-06c-permission-swarm-search): the MUI SearchDialog is replaced by SearchOverlay, which renders nothing while closed and is not an MUI Dialog. Verified by a jsdom test (#root has no aria-hidden, closed and open) and a headless Playwright walk of the web build (light/dark, 1280/375 px).
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Root cause was the always-mounted MUI SearchDialog hidden with display:none, which set aria-hidden on #root. Slice 06c's ⌘K overlay unmounts when closed, so #root is never hidden. Verified in jsdom and in a headless browser walk.
<!-- SECTION:FINAL_SUMMARY:END -->
