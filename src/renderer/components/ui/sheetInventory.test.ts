// A11Y1 rule 4 inventory (slice 09 Task 6): every sheet goes through Sheet, so it traps focus, closes on Esc and
// returns focus. Approvals and permissions never use AdaptiveModal.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { describe, expect, it } from 'vitest'

const RENDERER = resolve(process.cwd(), 'src/renderer')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.tsx') && !name.endsWith('.test.tsx')) out.push(full)
  }
  return out
}

const files = walk(RENDERER).map((full) => ({
  path: relative(RENDERER, full).split(sep).join('/'),
  src: readFileSync(full, 'utf8'),
}))

/** Files that may contain the dg-sheet class family: the component itself and the design-system page. */
const SHEET_OWNERS = ['components/ui/Sheet.tsx', 'routes/dev/design-system.tsx']

/**
 * AdaptiveModal uses found on 2026-10-21, none of them an approval or a permission (forms, viewers, settings
 * editors, previews). ClearSessionList and ContextOverflow were decisions and moved onto Sheet (R24).
 * A new approval or permission goes through Sheet; do not add it here.
 */
const ADAPTIVE_MODAL_ALLOWED = [
  'components/SystemPromptPresets.tsx',
  'components/chat/MemoryDockPopover.tsx',
  'components/common/CompressionModal.tsx',
  'components/session/SessionItem.tsx',
  'components/settings/GenerateAvatarButton.tsx',
  'components/settings/provider/AddProviderModal.tsx',
  'components/settings/provider/ImportProviderModal.tsx',
  'modals/AppStoreRating.tsx',
  'modals/AttachLink.tsx',
  'modals/ContentViewer.tsx',
  'modals/EdgeOneDeploySuccess.tsx',
  'modals/ExportChat.tsx',
  'modals/FileParseError.tsx',
  'modals/ImportChatGptArchive.tsx',
  'modals/ImportedConversationView.tsx',
  'modals/JsonViewer.tsx',
  'modals/MessageEdit.tsx',
  'modals/ModelEdit.tsx',
  'modals/ReportContent.tsx',
  'modals/SessionSettings.tsx',
  'modals/ThreadNameEdit.tsx',
  'modals/VideoAttachmentPreview.tsx',
  'modals/VideoPlayer.tsx',
  'routes/dev/storage.tsx',
  'routes/settings/chat.tsx',
  'routes/settings/provider/$providerId.tsx',
]

const rendersAdaptiveModal = (src: string) => /<AdaptiveModal[\s>]/.test(src)

describe('sheet inventory', () => {
  it('scans the renderer', () => {
    expect(files.some((f) => f.path === 'components/ui/Sheet.tsx')).toBe(true)
    expect(files.some((f) => f.path.endsWith('.test.tsx'))).toBe(false)
  })

  it('only Sheet (and the design-system page) uses the dg-sheet classes', () => {
    const offenders = files
      .filter((f) => !SHEET_OWNERS.includes(f.path) && f.src.includes('dg-sheet'))
      .map((f) => f.path)
    expect(offenders).toEqual([])
  })

  it('no file outside the allow-list renders AdaptiveModal', () => {
    const offenders = files
      .filter((f) => f.path !== 'components/common/AdaptiveModal.tsx' && rendersAdaptiveModal(f.src))
      .map((f) => f.path)
      .filter((p) => !ADAPTIVE_MODAL_ALLOWED.includes(p))
    expect(offenders).toEqual([])
  })

  it('every allow-listed file still renders AdaptiveModal (remove entries once a file moves off it)', () => {
    const stale = ADAPTIVE_MODAL_ALLOWED.filter((p) => {
      const file = files.find((f) => f.path === p)
      return !file || !rendersAdaptiveModal(file.src)
    })
    expect(stale).toEqual([])
  })

  it('the decision modals (delete chats, context overflow) render Sheet', () => {
    for (const p of ['modals/ClearSessionList.tsx', 'modals/ContextOverflow.tsx']) {
      const file = files.find((f) => f.path === p)
      expect({ p, sheet: /<Sheet[\s>]/.test(file?.src ?? '') }).toEqual({ p, sheet: true })
    }
  })
})
