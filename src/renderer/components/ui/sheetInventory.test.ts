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
 * AdaptiveModal uses found on 2026-10-21. None is an approval or a permission: most are forms, viewers, settings
 * editors or previews, and three confirm the user's own action (MessageEdit's discard, CompressionModal and
 * ImportedConversationView's delete; TASK-46 moves them). ClearSessionList and ContextOverflow moved onto Sheet (R24).
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

/**
 * Overlays built directly on Mantine's Modal or Drawer (also through components/layout/Overlay's re-exports) or on
 * vaul's Drawer.Root / Drawer.NestedRoot, found on 2026-10-21. Most are menus, pickers, viewers or editors. Three
 * confirm the user's own destructive action (SummaryMessage's delete, KnowledgeBase's delete, MemoryBankWorkspace's
 * Clear memories) and belong with TASK-46. None is an approval or a permission. A new approval, permission or confirm
 * goes through Sheet; do not add it here.
 */
const RAW_OVERLAY_ALLOWED = [
  'components/ActionMenu.tsx',
  'components/AdaptiveSelect.tsx',
  'components/InputBox/ComposerToolsMenu.tsx',
  'components/ModelSelector/MobileModelSelector.tsx',
  'components/chat/SummaryMessage.tsx',
  'components/knowledge-base/ChunksPreviewModal.tsx',
  'components/knowledge-base/KnowledgeBase.tsx',
  'components/knowledge-base/RemoteRetryModal.tsx',
  'components/settings/integrations/AccountFormModal.tsx',
  'components/settings/mcp/ConfigModal.tsx',
  'components/settings/memory/MemoryBankWorkspace.tsx',
  'modals/ArtifactPreview.tsx',
  'routes/image-creator/-components/MobileDrawers.tsx',
  'routes/settings/commands.tsx',
  'routes/settings/skills.tsx',
]

/** The wrappers themselves: Overlay re-exports Mantine's Modal and Drawer; AdaptiveModal is allow-listed above. */
const RAW_OVERLAY_OWNERS = ['components/layout/Overlay.tsx', 'components/common/AdaptiveModal.tsx']

/** Local names a file imports for `name` from one of `sources` (import { Modal } / import { Modal as M }). */
function importedAs(src: string, name: string, sources: RegExp): string[] {
  const names: string[] = []
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'([^']+)'/g)) {
    if (!sources.test(m[2])) continue
    for (const part of m[1].split(',')) {
      const [imported, local] = part.trim().split(/\s+as\s+/)
      if (imported === name) names.push(local ?? imported)
    }
  }
  return names
}

const MANTINE_OR_OVERLAY = /^@mantine\/core$|(^|\/)layout\/Overlay$/

/** Renders a Mantine Modal or Drawer (directly or via Overlay), or a vaul Drawer.Root / Drawer.NestedRoot. */
function rendersRawOverlay(src: string): boolean {
  const tags = [...importedAs(src, 'Modal', MANTINE_OR_OVERLAY), ...importedAs(src, 'Drawer', MANTINE_OR_OVERLAY)].map(
    (local) => new RegExp(`<${local}(\\.Root)?[\\s>]`)
  )
  for (const local of importedAs(src, 'Drawer', /^vaul$/)) tags.push(new RegExp(`<${local}\\.(Nested)?Root[\\s>]`))
  return tags.some((re) => re.test(src))
}

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

  it('no file outside the allow-list builds an overlay on Mantine Modal/Drawer or vaul Drawer.Root', () => {
    const offenders = files
      .filter((f) => !RAW_OVERLAY_OWNERS.includes(f.path) && rendersRawOverlay(f.src))
      .map((f) => f.path)
      .filter((p) => !RAW_OVERLAY_ALLOWED.includes(p))
    expect(offenders).toEqual([])
  })

  it('every raw-overlay allow-listed file still renders one (remove entries once a file moves off it)', () => {
    const stale = RAW_OVERLAY_ALLOWED.filter((p) => {
      const file = files.find((f) => f.path === p)
      return !file || !rendersRawOverlay(file.src)
    })
    expect(stale).toEqual([])
  })

  it('the raw-overlay check sees each import form', () => {
    expect(rendersRawOverlay("import { Button, Modal } from '@mantine/core'\n<Modal opened")).toBe(true)
    expect(rendersRawOverlay("import { Modal as M } from '@mantine/core'\n<M.Root opened>")).toBe(true)
    expect(rendersRawOverlay("import { Drawer } from '@mantine/core'\n<Drawer\n opened")).toBe(true)
    expect(rendersRawOverlay("import { Modal } from '../layout/Overlay'\n<Modal opened")).toBe(true)
    expect(rendersRawOverlay("import { Drawer } from 'vaul'\n<Drawer.Root open>")).toBe(true)
    expect(rendersRawOverlay("import { Drawer } from 'vaul'\n<Drawer.NestedRoot open>")).toBe(true)
    // MUI's Drawer (the sidebar) and a vaul Drawer without a root are not raw overlays.
    expect(rendersRawOverlay("import Drawer from '@mui/material/Drawer'\n<Drawer open>")).toBe(false)
    expect(rendersRawOverlay("import { Sheet } from '@/components/ui/Sheet'\n<Sheet opened>")).toBe(false)
  })

  it('the decision modals (delete chats, context overflow) render Sheet', () => {
    for (const p of ['modals/ClearSessionList.tsx', 'modals/ContextOverflow.tsx']) {
      const file = files.find((f) => f.path === p)
      expect({ p, sheet: /<Sheet[\s>]/.test(file?.src ?? '') }).toEqual({ p, sheet: true })
    }
  })
})
