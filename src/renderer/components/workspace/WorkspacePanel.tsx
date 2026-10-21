/**
 * Side workspace pane — Claude Artifacts–style preview for html/markdown/svg/mermaid/code.
 */

import { ActionIcon, Tooltip } from '@mantine/core'
import {
  type ArtifactKind,
  artifactKindLabel,
  inferArtifactTitle,
  isLegacyDefaultTitle,
  normalizeArtifactKind,
} from '@shared/artifacts'
import type { Session } from '@shared/types'
import {
  IconArrowsMaximize,
  IconArrowsMinimize,
  IconChevronLeft,
  IconChevronRight,
  IconCopy,
  IconDownload,
  IconReload,
  IconX,
} from '@tabler/icons-react'
import type React from 'react'
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/packages/navigator'
import platform from '@/platform'
import * as toastActions from '@/stores/toastActions'
import {
  useUIStore,
  WORKSPACE_MAX_WIDTH_PX,
  WORKSPACE_MIN_WIDTH_PX,
  type WorkspaceArtifactVersion,
  type WorkspacePanelState,
} from '@/stores/uiStore'
import { InspectorFrame } from '../layout/InspectorFrame'
import Toolbar from '../layout/Toolbar'
import WindowControls from '../layout/WindowControls'
import Markdown from '../Markdown'
import { MessageMermaid } from '../Mermaid'
import { artifactFileName } from './artifactFile'
import { HtmlWorkspaceView } from './HtmlWorkspaceView'
import { WorkspaceCodeView } from './WorkspaceCodeView'

const EXIT_MS = 260
// One width range, owned by the store; re-exported here, where slice 6a first published it.
export { WORKSPACE_MAX_WIDTH_PX, WORKSPACE_MIN_WIDTH_PX }
const EASE = 'cubic-bezier(0.32, 0.72, 0, 1)'

type WorkspaceContent = NonNullable<WorkspacePanelState>

function resolvePanelSource(panel: WorkspaceContent): {
  kind: ArtifactKind
  content: string
  language?: string
  title: string
} {
  const versions = panel.versions ?? []
  const index = panel.versionIndex ?? Math.max(0, versions.length - 1)
  const current: WorkspaceArtifactVersion | undefined = versions[index]
  const kind = normalizeArtifactKind(current?.kind ?? panel.kind)
  const content = current?.content ?? panel.content ?? panel.htmlCode ?? ''
  const language = current?.language ?? panel.language
  const rawTitle = current?.title ?? panel.title
  const title = isLegacyDefaultTitle(rawTitle) ? inferArtifactTitle(content, kind, language) : rawTitle
  return { kind, content, language, title: title || artifactKindLabel(kind, language) }
}

function WorkspacePreview(props: {
  kind: ArtifactKind
  content: string
  language?: string
  reloadSign: number
  theme: 'light' | 'dark'
}) {
  const { kind, content, language, reloadSign, theme } = props
  if (kind === 'html') {
    return <HtmlWorkspaceView htmlCode={content} kind="html" reloadSign={reloadSign} />
  }
  if (kind === 'svg') {
    return <HtmlWorkspaceView htmlCode={content} kind="svg" reloadSign={reloadSign} />
  }
  if (kind === 'markdown') {
    return (
      <div className="workspace-markdown">
        <Markdown enableMermaidRendering>{content}</Markdown>
      </div>
    )
  }
  if (kind === 'mermaid') {
    return (
      <div className="workspace-mermaid">
        <MessageMermaid source={content} theme={theme} />
      </div>
    )
  }
  return <WorkspaceCodeView code={content} language={language} />
}

/**
 * The inspector for chats and artifacts. InspectorFrame picks the shell for the window size (slice 9 RS1, RS2): at
 * wide this aside, docked at 380–460 px with its resizer and full screen mode; below 1200 px a sheet with the same
 * header and body, without the resizer or full screen.
 */
function WorkspacePanel({ session }: { session?: Session }) {
  const { t } = useTranslation()
  const docked = useLayoutMode() === 'wide'
  const panel = useUIStore((s) => s.workspacePanel)
  const storedWidthPx = useUIStore((s) => s.workspaceWidthPx)
  const widthPx = Math.min(WORKSPACE_MAX_WIDTH_PX, Math.max(WORKSPACE_MIN_WIDTH_PX, storedWidthPx))
  const expanded = useUIStore((s) => s.workspaceExpanded)
  const realTheme = useUIStore((s) => s.realTheme)
  const setWorkspacePanel = useUIStore((s) => s.setWorkspacePanel)
  const setWorkspaceExpanded = useUIStore((s) => s.setWorkspaceExpanded)
  const setWorkspaceWidthPx = useUIStore((s) => s.setWorkspaceWidthPx)
  const [tab, setTab] = useState<'preview' | 'code'>('preview')
  const [reloadSign, setReloadSign] = useState(0)
  const [display, setDisplay] = useState<WorkspaceContent | null>(null)
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number | null>(null)
  const panelRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (closeTimer.current) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
    if (panel) {
      setDisplay(panel)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => setOpen(true))
      })
      return
    }
    setOpen(false)
    closeTimer.current = window.setTimeout(() => {
      setDisplay(null)
      closeTimer.current = null
    }, EXIT_MS)
    return () => {
      if (closeTimer.current) {
        window.clearTimeout(closeTimer.current)
        closeTimer.current = null
      }
    }
  }, [panel])

  const source = display ? resolvePanelSource(display) : null
  const versions = display?.versions ?? []
  const versionIndex = display?.versionIndex ?? Math.max(0, versions.length - 1)
  const sourceKind = source?.kind
  const contentKey = display ? `${display.versions?.[0]?.id ?? display.artifactId ?? display.messageId ?? ''}` : ''

  useEffect(() => {
    if (!contentKey || !sourceKind) return
    setTab(sourceKind === 'code' ? 'code' : 'preview')
    setReloadSign(0)
  }, [contentKey, sourceKind])

  useEffect(() => {
    // Below 1200 px the sheet owns Esc (useSheetFocus), and full screen does not apply.
    if (!docked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !panel) return
      e.preventDefault()
      if (expanded) {
        setWorkspaceExpanded(false)
        return
      }
      setWorkspacePanel(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [docked, panel, expanded, setWorkspaceExpanded, setWorkspacePanel])

  // The docked pane takes focus when it opens, not on each update (a streaming artifact replaces `panel` per token)
  // nor when the window size changes; a sheet places first focus itself.
  const hasPanel = Boolean(panel)
  // biome-ignore lint/correctness/useExhaustiveDependencies: only on open
  useEffect(() => {
    if (docked && open && hasPanel && panelRef.current) {
      panelRef.current.focus({ preventScroll: true })
    }
  }, [open, hasPanel])

  const onResizePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      const startX = e.clientX
      const startW = widthPx
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: PointerEvent) => {
        setWorkspaceWidthPx(startW + (startX - ev.clientX))
      }
      const onUp = () => {
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointerup', onUp)
      }
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointerup', onUp)
    },
    [widthPx, setWorkspaceWidthPx]
  )

  const showVersion = (nextIndex: number) => {
    if (!display || !versions[nextIndex]) return
    const next = versions[nextIndex]
    setWorkspacePanel({
      ...display,
      kind: next.kind,
      content: next.content,
      language: next.language,
      title: next.title,
      messageId: next.messageId ?? display.messageId,
      artifactId: next.id,
      versions,
      versionIndex: nextIndex,
    })
  }

  if (!display && !open) return null
  if (!display || !source) return null

  const title = source.title || t('Artifact')
  const sourceText = source.content
  const kicker = artifactKindLabel(source.kind, source.language)
  const close = () => setWorkspacePanel(null)
  const toggleExpanded = () => setWorkspaceExpanded(!expanded)
  const canPage = versions.length > 1

  const copySource = () => {
    if (!sourceText) return
    copyToClipboard(sourceText)
    toastActions.add(t('copied to clipboard'))
  }

  const download = () => {
    if (!sourceText) return
    const filename = artifactFileName({ title: source.title, kind: source.kind, language: source.language })
    void platform.exporter.exportTextFile(filename, sourceText).catch(() => {
      toastActions.add(t('Download failed'))
    })
  }

  const fullScreen = docked && expanded

  const body = (
    <div className="workspace-panel-inner">
      <header className="workspace-panel-header">
        <div className="workspace-panel-header-left min-w-0">
          <span className="workspace-panel-kicker">{kicker}</span>
          {/* In a sheet the title is the sheet's heading. */}
          {docked ? (
            <span className="workspace-panel-title" title={title}>
              {title}
            </span>
          ) : null}
          {canPage ? (
            <div className="workspace-version-pager">
              <Tooltip label={t('Previous version')} openDelay={200}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={22}
                  radius="md"
                  disabled={versionIndex <= 0}
                  onClick={() => showVersion(versionIndex - 1)}
                  aria-label={t('Previous version')}
                >
                  <IconChevronLeft size={13} stroke={1.7} />
                </ActionIcon>
              </Tooltip>
              <span className="workspace-version-label tabular-nums">
                {t('v{{version}}', { version: versions[versionIndex]?.version ?? versionIndex + 1 })}
              </span>
              <Tooltip label={t('Next version')} openDelay={200}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={22}
                  radius="md"
                  disabled={versionIndex >= versions.length - 1}
                  onClick={() => showVersion(versionIndex + 1)}
                  aria-label={t('Next version')}
                >
                  <IconChevronRight size={13} stroke={1.7} />
                </ActionIcon>
              </Tooltip>
            </div>
          ) : null}
        </div>

        <div className="workspace-panel-header-actions">
          <div className="workspace-tabs" role="tablist" aria-label={t('Artifact view')}>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'preview'}
              className={cn('workspace-tab', tab === 'preview' && 'is-on')}
              onClick={() => setTab('preview')}
            >
              {t('Preview')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'code'}
              className={cn('workspace-tab', tab === 'code' && 'is-on')}
              onClick={() => setTab('code')}
            >
              {t('Code')}
            </button>
          </div>
          <div className="workspace-header-icons" role="toolbar" aria-label={t('Artifact actions')}>
            {docked ? (
              <Tooltip label={expanded ? t('Exit full screen') : t('Full screen')} openDelay={200}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size={26}
                  radius="md"
                  onClick={toggleExpanded}
                  aria-label={expanded ? t('Exit full screen') : t('Full screen')}
                  aria-pressed={expanded}
                  className="workspace-action-btn workspace-header-expand"
                >
                  {expanded ? (
                    <IconArrowsMinimize size={14} stroke={1.6} />
                  ) : (
                    <IconArrowsMaximize size={14} stroke={1.6} />
                  )}
                </ActionIcon>
              </Tooltip>
            ) : null}
            <Tooltip label={t('Refresh')} openDelay={200}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size={26}
                radius="md"
                onClick={() => setReloadSign((n) => n + 1)}
                aria-label={t('Refresh')}
                className="workspace-action-btn"
              >
                <IconReload size={14} stroke={1.6} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('Copy')} openDelay={200}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size={26}
                radius="md"
                onClick={copySource}
                aria-label={t('Copy')}
                className="workspace-action-btn"
              >
                <IconCopy size={14} stroke={1.6} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label={t('Download')} openDelay={200}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size={26}
                radius="md"
                onClick={download}
                aria-label={t('Download')}
                className="workspace-action-btn"
              >
                <IconDownload size={14} stroke={1.6} />
              </ActionIcon>
            </Tooltip>
            {fullScreen && session ? <Toolbar session={session} compact /> : null}
            <Tooltip label={t('Close')} openDelay={200}>
              <ActionIcon
                variant="subtle"
                color="gray"
                size={26}
                radius="md"
                onClick={close}
                aria-label={t('Close')}
                className="workspace-action-btn workspace-action-close"
              >
                <IconX size={14} stroke={1.6} />
              </ActionIcon>
            </Tooltip>
            {fullScreen ? <WindowControls className="workspace-window-controls" /> : null}
          </div>
        </div>
      </header>

      <div
        className="workspace-panel-body"
        key={`${display.artifactId ?? display.messageId ?? ''}-${tab}-${reloadSign}-${versionIndex}`}
      >
        {tab === 'code' ? (
          <WorkspaceCodeView code={sourceText} language={source.language || source.kind} />
        ) : (
          <WorkspacePreview
            kind={source.kind}
            content={sourceText}
            language={source.language}
            reloadSign={reloadSign}
            theme={realTheme}
          />
        )}
      </div>
    </div>
  )

  return (
    <InspectorFrame
      opened={Boolean(panel)}
      onClose={close}
      title={title}
      docked={(inner) => (
        <aside
          ref={panelRef}
          className={cn('workspace-panel', open && 'is-open', !open && 'is-closing', expanded && 'is-expanded')}
          style={
            {
              '--workspace-w': `${widthPx}px`,
              width: !open ? 0 : expanded ? '100%' : `min(${widthPx}px, 42%)`,
              // Docked width is clamped to 380–460 px: the 42% cap never takes it under the minimum.
              minWidth: open && !expanded ? `${WORKSPACE_MIN_WIDTH_PX}px` : undefined,
              transition: `width ${EXIT_MS}ms ${EASE}`,
            } as React.CSSProperties
          }
          aria-label={t('Artifact')}
          aria-hidden={!open}
          tabIndex={-1}
        >
          {!expanded ? (
            <div
              className="workspace-panel-resizer"
              onPointerDown={onResizePointerDown}
              role="separator"
              aria-orientation="vertical"
              aria-valuenow={widthPx}
              aria-valuemin={WORKSPACE_MIN_WIDTH_PX}
              aria-valuemax={WORKSPACE_MAX_WIDTH_PX}
              aria-label={t('Resize workspace')}
            />
          ) : null}

          <div className="workspace-panel-shell">{inner}</div>
        </aside>
      )}
    >
      {body}
    </InspectorFrame>
  )
}

export default memo(WorkspacePanel)

/** Whether the workspace chrome is visible or animating (for session shell class). */
export function useWorkspaceChromeActive(): boolean {
  const panel = useUIStore((s) => s.workspacePanel)
  const [active, setActive] = useState(Boolean(panel))

  useEffect(() => {
    if (panel) {
      setActive(true)
      return
    }
    const t = window.setTimeout(() => setActive(false), EXIT_MS)
    return () => window.clearTimeout(t)
  }, [panel])

  return active
}
