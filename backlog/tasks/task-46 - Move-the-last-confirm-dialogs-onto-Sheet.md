---
id: TASK-46
title: Move the last confirm dialogs onto Sheet
status: Ideas
assignee: []
created_date: 2026-10-21 02:42
updated_date: '2026-11-08T15:34:00Z'
labels:
  - a11y
dependencies: []
ordinal: 64000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
From slice 09 Task 6 review: three dialogs confirming the user's own action still use AdaptiveModal (allow-listed in components/ui/sheetInventory.test.ts): MessageEdit 'Discard Changes?' (trapFocus={false}), CompressionModal, and ImportedConversationView, whose 'Delete imported source' deletes with no confirmation at all. Also: ContextOverflow's Cancel continues the send (now visible on phone too), and the sheet inventory only scans for AdaptiveModal, not raw Mantine Modal or vaul Drawer.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The three dialogs use Sheet with first focus on the safe action and Esc cancelling
- [x] #2 Deleting an imported source asks first
- [ ] #3 The inventory test also flags raw Modal/Drawer.Root for decisions
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Slice 09 Task 10 adds three more confirm overlays on Mantine Modal (allow-listed in sheetInventory.test.ts): SummaryMessage delete, KnowledgeBase delete, MemoryBankWorkspace 'Clear memories'.

2026-11-08 board check (main da41b5f): AC #2 fixed in #110 — ImportedConversationView opens DeleteImportedSourceSheet (Cancel focused, Esc cancels) before deleting; DeleteImportedSourceSheet.test.tsx passes. Still open: the other five confirm dialogs (MessageEdit discard, CompressionModal, SummaryMessage delete, KnowledgeBase delete, MemoryBankWorkspace clear) and the inventory test (AC #1, #3); a failed imported-source delete shows nothing.
<!-- SECTION:NOTES:END -->
