import { ActionIcon, Tooltip, UnstyledButton } from '@mantine/core'
import {
  type ArtifactKind,
  artifactKindLabel,
  collectArtifactVersions,
  deriveMessageArtifacts,
  inferArtifactTitle,
  isContainRenderableCode,
  isLegacyDefaultTitle,
  isRenderableCodeLanguage,
  normalizeArtifactKind,
} from '@shared/artifacts'
import type { MessageArtifact as MessageArtifactRecord } from '@shared/types/session'
import {
  IconChevronRight,
  IconCode,
  IconFileTypeHtml,
  IconFileTypeSvg,
  IconFileTypeTxt,
  IconLayoutSidebarRightExpand,
  IconPlayerStop,
  IconReload,
} from '@tabler/icons-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLayoutMode } from '@/hooks/useLayoutMode'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { getMessageThreadContext } from '@/stores/sessionActions'
import { uiStore, useUIStore, type WorkspaceArtifactVersion, type WorkspacePanelState } from '@/stores/uiStore'
import { getMessageText } from '../../shared/utils/message'
import Markdown from './Markdown'
import { MessageMermaid } from './Mermaid'
import { HtmlWorkspaceView } from './workspace/HtmlWorkspaceView'
import { WorkspaceCodeView } from './workspace/WorkspaceCodeView'

export { deriveMessageArtifacts, isContainRenderableCode, isRenderableCodeLanguage }

export type RenderableCodeLanguage = 'html'
export type CodeBlockLanguage = 'html' | 'js' | 'javascript' | 'css'

function resolvedTitle(artifact: Pick<MessageArtifactRecord, 'title' | 'content' | 'type' | 'language'>): string {
  const kind = normalizeArtifactKind(artifact.type)
  if (isLegacyDefaultTitle(artifact.title)) {
    return inferArtifactTitle(artifact.content, kind, artifact.language)
  }
  return artifact.title || artifactKindLabel(kind, artifact.language)
}

function toVersion(artifact: MessageArtifactRecord, messageId?: string): WorkspaceArtifactVersion {
  const kind = normalizeArtifactKind(artifact.type)
  return {
    id: artifact.id,
    messageId,
    kind,
    content: artifact.content,
    language: artifact.language,
    title: resolvedTitle(artifact),
    version: artifact.version,
  }
}

export function toWorkspacePanelState(
  artifact: MessageArtifactRecord,
  messageId?: string,
  versions: Array<MessageArtifactRecord & { messageId?: string }> = []
): WorkspacePanelState {
  const list: Array<MessageArtifactRecord & { messageId?: string }> = versions.length
    ? versions
    : [{ ...artifact, messageId }]
  const mapped = list.map((item) => toVersion(item, item.messageId ?? messageId))
  const kind = normalizeArtifactKind(artifact.type)
  const versionIndex = Math.max(
    0,
    mapped.findIndex((item) => item.id === artifact.id)
  )
  return {
    kind,
    content: artifact.content,
    language: artifact.language,
    title: resolvedTitle(artifact),
    messageId,
    artifactId: artifact.id,
    versions: mapped,
    versionIndex,
  }
}

/**
 * The open inspector, brought up to date with a message's streaming artifact. Versions from other messages and the
 * version on screen are kept; only this message's entry changes.
 */
function syncPanelWithArtifact(
  shown: WorkspaceContentState,
  artifact: MessageArtifactRecord,
  messageId: string
): WorkspacePanelState {
  const versions = shown.versions ?? []
  if (versions.length <= 1) return toWorkspacePanelState(artifact, messageId)
  const next = toVersion(artifact, messageId)
  return {
    ...shown,
    versions: versions.map((item) => (item.messageId === messageId ? { ...next, version: item.version } : item)),
  }
}

type WorkspaceContentState = NonNullable<WorkspacePanelState>

// Messages whose artifact already opened the inspector by itself: once per message, across re-mounts (the list is
// virtualised, so a message mounts again each time it scrolls back into view).
const autoOpenedMessages = new Set<string>()

export async function getPreviousArtifactVersion(
  sessionId: string,
  messageId: string
): Promise<MessageArtifactRecord | undefined> {
  const messageList = await getMessageThreadContext(sessionId, messageId)
  const messageIndex = messageList.findIndex((message) => message.id === messageId)
  if (messageIndex <= 0) {
    return undefined
  }

  for (let index = messageIndex - 1; index >= 0; index -= 1) {
    const artifact = messageList[index].artifacts?.[0]
    if (artifact) {
      return artifact
    }
    const previousMessageText = getMessageText(messageList[index])
    if (messageList[index].role === 'assistant' && isContainRenderableCode(previousMessageText)) {
      return deriveMessageArtifacts(previousMessageText)?.[0]
    }
  }

  return undefined
}

async function collectThreadArtifactVersions(
  sessionId: string,
  messageId: string,
  current: MessageArtifactRecord
): Promise<Array<MessageArtifactRecord & { messageId?: string }>> {
  const messageList = await getMessageThreadContext(sessionId, messageId)
  const stored: Array<MessageArtifactRecord & { messageId?: string }> = []
  for (const message of messageList) {
    const artifact = message.artifacts?.[0]
    if (artifact) {
      stored.push({ ...artifact, messageId: message.id })
    }
  }
  if (!stored.some((item) => item.id === current.id)) {
    stored.push({ ...current, messageId })
  }
  return collectArtifactVersions({ ...current, messageId }, stored)
}

function ArtifactKindIcon({ kind }: { kind: ArtifactKind }) {
  if (kind === 'html') return <IconFileTypeHtml size={15} stroke={1.5} />
  if (kind === 'svg') return <IconFileTypeSvg size={15} stroke={1.5} />
  if (kind === 'markdown') return <IconFileTypeTxt size={15} stroke={1.5} />
  return <IconCode size={15} stroke={1.5} />
}

export function MessageArtifact(props: {
  sessionId: string
  messageId: string
  messageContent: string
  preview: boolean
  setPreview: (preview: boolean) => void
  /** When true, open side workspace once after the artifact is ready (auto-preview setting). */
  autoOpenWorkspace?: boolean
  generating?: boolean
  artifact?: MessageArtifactRecord
}) {
  const {
    sessionId,
    messageId,
    messageContent,
    preview,
    setPreview,
    autoOpenWorkspace = false,
    generating = false,
    artifact,
  } = props

  const layoutMode = useLayoutMode()
  // Only a reply streamed while this card was on screen may open the inspector, never one loaded from history.
  const sawGenerating = useRef(false)
  if (generating) sawGenerating.current = true

  const derived = useMemo(() => artifact ?? deriveMessageArtifacts(messageContent)?.[0], [artifact, messageContent])

  useEffect(() => {
    if (!derived?.content) return
    const { workspacePanel: shown, setWorkspacePanel } = uiStore.getState()
    // The inspector already shows this message: keep it in step with the stream (that is not opening it).
    if (shown?.messageId === messageId) {
      const current = shown.versions?.find((item) => item.messageId === messageId)?.content ?? shown.content
      if (current !== derived.content) setWorkspacePanel(syncPanelWithArtifact(shown, derived, messageId))
      return
    }
    if (!autoOpenWorkspace || !sawGenerating.current) return
    if (generating && derived.content.length < 24) return
    // Below 1200 px the inspector is a modal sheet: it opens only from the card's Open button (slice 9 RS1, RS2).
    if (layoutMode !== 'wide') return
    // Once per message: a pane the user closed stays closed for the rest of the reply.
    if (autoOpenedMessages.has(messageId)) return
    autoOpenedMessages.add(messageId)
    setWorkspacePanel(toWorkspacePanelState(derived, messageId))
  }, [autoOpenWorkspace, derived, generating, messageId, layoutMode])

  if (!derived) return null

  return (
    <ArtifactWithButtons
      artifact={derived}
      sessionId={sessionId}
      messageId={messageId}
      preview={preview}
      setPreview={setPreview}
    />
  )
}

export function ArtifactWithButtons(props: {
  artifact: MessageArtifactRecord
  sessionId?: string
  messageId?: string
  preview: boolean
  setPreview: (preview: boolean) => void
}) {
  const { artifact, sessionId, messageId, preview, setPreview } = props
  const { t } = useTranslation()
  const [reloadSign, setReloadSign] = useState(0)
  const isSmallScreen = useIsSmallScreen()
  const setWorkspacePanel = useUIStore((s) => s.setWorkspacePanel)
  const theme = useUIStore((s) => s.realTheme)
  const kind = normalizeArtifactKind(artifact.type)
  const title = resolvedTitle(artifact)
  const typeLabel = artifactKindLabel(kind, artifact.language)

  const openWorkspace = () => {
    if (!artifact.content) return
    const open = (versions?: Array<MessageArtifactRecord & { messageId?: string }>) => {
      setWorkspacePanel(toWorkspacePanelState(artifact, messageId, versions))
    }
    if (sessionId && messageId) {
      void collectThreadArtifactVersions(sessionId, messageId, artifact).then(open)
      return
    }
    open()
  }

  const onReplay = () => {
    setReloadSign((n) => n + 1)
  }
  const onPreview = () => {
    if (!isSmallScreen) {
      openWorkspace()
      return
    }
    setPreview(true)
    setReloadSign((n) => n + 1)
  }
  const onStopPreview = () => {
    setPreview(false)
  }

  if (!preview) {
    const versionMeta = artifact.version && artifact.version > 1 ? `v${artifact.version}` : null
    return (
      <UnstyledButton
        type="button"
        className="artifact-card"
        onClick={onPreview}
        aria-label={`${title} · ${typeLabel}`}
      >
        <span className="artifact-card-icon" aria-hidden>
          <ArtifactKindIcon kind={kind} />
        </span>
        <span className="artifact-card-title">{title}</span>
        <span className="artifact-card-sub">{versionMeta ? `${typeLabel} · ${versionMeta}` : typeLabel}</span>
        <IconChevronRight size={13} stroke={2} className="artifact-card-chevron" aria-hidden />
      </UnstyledButton>
    )
  }

  return (
    <div className={cn('artifact-inline', isSmallScreen && 'artifact-inline--stack')}>
      <div className="artifact-inline-frame">
        <InlineArtifactPreview artifact={artifact} reloadSign={reloadSign} theme={theme} />
      </div>
      <div className="artifact-inline-tools" role="toolbar" aria-label={t('Artifact controls')}>
        <Tooltip label={t('Refresh')} openDelay={200}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={36}
            radius="xl"
            onClick={onReplay}
            aria-label={t('Refresh')}
            className="artifact-card-btn"
          >
            <IconReload size={16} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('Open')} openDelay={200}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={36}
            radius="xl"
            onClick={openWorkspace}
            aria-label={t('Open')}
            className="artifact-card-btn"
          >
            <IconLayoutSidebarRightExpand size={16} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
        <Tooltip label={t('Close preview')} openDelay={200}>
          <ActionIcon
            variant="subtle"
            color="gray"
            size={36}
            radius="xl"
            onClick={onStopPreview}
            aria-label={t('Close preview')}
            className="artifact-card-btn"
          >
            <IconPlayerStop size={16} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
      </div>
    </div>
  )
}

function InlineArtifactPreview(props: {
  artifact: MessageArtifactRecord
  reloadSign: number
  theme: 'light' | 'dark'
}) {
  const { artifact, reloadSign, theme } = props
  const kind = normalizeArtifactKind(artifact.type)
  if (kind === 'html') {
    return (
      <HtmlWorkspaceView
        htmlCode={artifact.content}
        kind="html"
        reloadSign={reloadSign}
        className="artifact-inline-iframe"
      />
    )
  }
  if (kind === 'svg') {
    return (
      <HtmlWorkspaceView
        htmlCode={artifact.content}
        kind="svg"
        reloadSign={reloadSign}
        className="artifact-inline-iframe"
      />
    )
  }
  if (kind === 'markdown') {
    return (
      <div className="artifact-inline-markdown">
        <Markdown>{artifact.content}</Markdown>
      </div>
    )
  }
  if (kind === 'mermaid') {
    return (
      <div className="artifact-inline-markdown">
        <MessageMermaid source={artifact.content} theme={theme} />
      </div>
    )
  }
  return <WorkspaceCodeView code={artifact.content} language={artifact.language} />
}

export function Artifact(props: { htmlCode: string; reloadSign?: number; className?: string }) {
  const { htmlCode, reloadSign, className } = props
  return <HtmlWorkspaceView htmlCode={htmlCode} reloadSign={reloadSign} className={className} />
}
