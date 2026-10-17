import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Box, Button, Flex, Stack, Text, Tooltip, UnstyledButton } from '@mantine/core'
import { useViewportSize } from '@mantine/hooks'
import {
  getFileAcceptString,
  getUnsupportedFileI18nKey,
  isAiReadableImageFile,
  isAiReadableVideoFile,
  isSupportedFile,
} from '@shared/file-extensions'
import { getConnector } from '@shared/integrations'
import { getOrCreateGatewayClient } from '@shared/models/openclaw'
import { getModel } from '@shared/providers'
import type { IntegrationAccount } from '@shared/types/integrations'
import {
  IconAlertCircle,
  IconArrowUp,
  IconBrain,
  IconChevronRight,
  IconFolder,
  IconLoader2,
  IconPlayerStopFilled,
  IconX,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useAtom, useAtomValue, useSetAtom } from 'jotai'
import _, { pick } from 'lodash'
import type React from 'react'
import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createModelDependencies } from '@/adapters'
import { useMyCopilots, useRemoteCopilots } from '@/hooks/useCopilots'
import { exportRoomPack } from '@/stores/roomPack'
import useInputBoxHistory from '@/hooks/useInputBoxHistory'
import { useKnowledgeBase } from '@/hooks/useKnowledgeBase'
import { useMessageInput } from '@/hooks/useMessageInput'
import { useProviders } from '@/hooks/useProviders'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useScopes } from '@/hooks/useScopes'
import { cn } from '@/lib/utils'
import { navigateToSettings } from '@/modals/Settings'
import type { GatewayCommandInfo } from '@/openclaw/gateway'
import {
  extractAgentSlugsFromText,
  getActiveAgentAtQuery,
  matchAgentBySlug,
  replaceActiveAgentAtWithToken,
  slugifyAgentName,
  stripAgentTokenFromText,
} from '@/packages/agents'
import {
  extractCommandNamesFromText,
  getActiveCommandSlashQuery,
  matchSystemSlashCommand,
  stripCommandSlashTokens,
} from '@/packages/commands'
import {
  getContextMessageIds,
  isAutoCompactionEnabled,
  isCompactionInProgress,
  runCompactionWithUIState,
  useContextTokens,
} from '@/packages/context-management'
import { trackingEvent } from '@/packages/event'
import {
  CREDENTIAL_CHIP_MAX,
  extractCredentialSlugsFromText,
  getActiveCredentialHashQuery,
  matchCredentialBySlug,
  replaceActiveCredentialHashWithToken,
  slugifyCredentialLabel,
} from '@/packages/integrations/hash-tokens'
import { searchEntries } from '@/packages/memory/bank-ops'
import { replacePromptTemplateVars } from '@/packages/model-calls/message-utils'
import { getModelContextWindowSync } from '@/packages/model-context'
import * as picUtils from '@/packages/pic_utils'
import {
  extractSkillNamesFromText,
  getActiveSkillDollarQuery,
  replaceActiveSkillDollarWithToken,
} from '@/packages/skills'
import { formatBytesForDisplay, formatDurationForDisplay, getVideoLimits } from '@/packages/video'
import { isWebSearchConfigured } from '@/packages/web-search/is-configured'
import platform, { platformCapabilities } from '@/platform'
import storage from '@/storage'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import * as atoms from '@/stores/atoms'
import { compactionUIStateMapAtom } from '@/stores/atoms/compactionAtoms'
import { composerTokenMenuAtom } from '@/stores/atoms/uiAtoms'
import * as chatStore from '@/stores/chatStore'
import { useSession, useSessionSettings } from '@/stores/chatStore'
import { useCommands } from '@/stores/commandsStore'
import { ensureIntegrationsStoreInit, useIntegrationsStore } from '@/stores/integrationsStore'
import { ensureMemoryStoreInit, useMemoryStore } from '@/stores/memoryStore'
import { usePromptPresets } from '@/stores/promptPresetsStore'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { DEFAULT_USAGE_BUDGET } from '@shared/providers/usage'
import { shouldHardStopSend, useUsageBudgetState } from '@/packages/usage-tracking'
import { mergeVoiceConfig, synthesizeSpeech } from '@shared/voice-copilot'
import { useSkills } from '@/stores/skillsStore'
import type { QuoteDraft } from '@/stores/uiStore'
import { useUIStore } from '@/stores/uiStore'
import { delay } from '@/utils'
import { decideClipboardPaste, extractClipboardNonImageFiles, imagePayloadFingerprint } from '@/utils/clipboardImages'
import { getModelDisplayName } from '@/utils/modelDisplayName'
import { getModelReadiness } from '@/utils/modelReadiness'
import { trackEvent } from '@/utils/track'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import type {
  CommandPackage,
  KnowledgeBase,
  MemoryAttachment,
  Message,
  MessageQuoteAttachment,
  SessionType,
  ShortcutSendValue,
  SkillPackage,
} from '../../../shared/types'
import {
  type AgentDetail,
  COMMAND_EXPLICIT_MAX,
  MAX_ROOM_AGENTS,
  ModelProviderEnum,
  type Session,
  type SessionSettings,
  SKILL_EXPLICIT_MAX,
} from '../../../shared/types'
import type { MemoryEntry } from '../../../shared/types/memory'
import * as dom from '../../hooks/dom'
import * as sessionHelpers from '../../stores/sessionHelpers'
import * as toastActions from '../../stores/toastActions'
import AgentRoomStrip from '../chat/AgentRoomStrip'
import { CompactionStatus } from '../chat/CompactionStatus'
import { MemoryDockPopover } from '../chat/MemoryDockPopover'
import {
  getActiveMemoryMentionQuery,
  getComposerSelectionOrDraft,
  replaceActiveMemoryMentionWithToken,
  slugifyMemoryLabel,
} from '../chat/memory-dock-utils'
import ReasoningEffortSelect from '../chat/ReasoningEffortSelect'
import TeamRoomActions from '../chat/TeamRoomActions'
import { CompressionModal } from '../common/CompressionModal'
import { ScalableIcon } from '../common/ScalableIcon'
import ProviderImageIcon from '../icons/ProviderImageIcon'
import ModelSelector from '../ModelSelector'
import AgentPicker, { filterAgents } from './AgentPicker'
import { FileMiniCard, ImageMiniCard, LinkMiniCard } from './Attachments'
import CommandPicker, { buildCommandPickerItems, type CommandPickerItem } from './CommandPicker'
import ComposerRichInput, { type ComposerRichInputHandle } from './ComposerRichInput'
import ComposerToolsMenu from './ComposerToolsMenu'
import CredentialPicker, { filterCredentials } from './CredentialPicker'
import DictateButton from './DictateButton'
import type { ComposerChipData } from './composer-chip-dom'
import { ImageUploadInput } from './ImageUploadInput'
import MemoryMentionPicker from './MemoryMentionPicker'
import { ModelReadinessNotice } from './ModelReadinessNotice'
import OpenClawCommandPicker, { filterOpenClawCommands, getCommandAlias } from './OpenClawCommandPicker'
import PresetPicker, { filterPresets } from './PresetPicker'
import {
  cleanupFile,
  cleanupLink,
  markFileProcessing,
  markLinkProcessing,
  onFileProcessed,
  onLinkProcessed,
  storeFilePromise,
  storeLinkPromise,
} from './preprocessState'
import QueuedMessageList from './QueuedMessageList'
import QuoteChip from './QuoteChip'
import { ScopePill } from './ScopePill'
import SkillPicker, { filterSkills } from './SkillPicker'
import TeamModeSelect from './TeamModeSelect'
import { voiceAuthFromSettings } from './VoiceHoldButton'

export type InputBoxPayload = {
  constructedMessage: Message
  needGenerating?: boolean
  onUserMessageReady?: () => void
}

export type InputBoxRef = {
  setQuote: (quote: QuoteDraft | string) => void
  insertMemory: (entry: MemoryEntry) => void
  getMemorySaveContent: () => string
}

export type InputBoxProps = {
  sessionId?: string
  sessionType?: SessionType
  generating?: boolean
  model?: {
    provider: string
    modelId: string
  }
  modelDisplayName?: string
  fullWidth?: boolean
  onSelectModel?(provider: string, model: string): void
  onSubmit?(payload: InputBoxPayload): Promise<void>
  onStopGenerating?(): boolean
  onStartNewThread?(): boolean
  onRollbackThread?(): boolean
  onClickSessionSettings?(): boolean | Promise<boolean>
  agentMode?: boolean
  onToggleAgentMode?(enabled: boolean): void
  workspaceRoot?: string
  onWorkspaceRootChange?(workspaceRoot: string | undefined): void
  browserArmed?: boolean
  onBrowserArmedChange?(armed: boolean): void
  computerArmed?: boolean
  onComputerArmedChange?(armed: boolean): void
  /** Prefill composer (e.g. empty-state starters). Remount with a new key when changing. */
  initialMessage?: string
  /**
   * Blank / new-chat draft room members (sessionId === 'new' has no chatStore session).
   * Used for Team mode visibility and room strip.
   */
  draftAgentIds?: string[]
  /** Persist room-member changes on blank home (NewChatAgentBar + dock strip). */
  onDraftAgentIdsChange?(ids: string[]): void
  draftRoomMode?: 'discuss' | 'work' | 'swarm'
  onDraftRoomModeChange?(mode: 'discuss' | 'work' | 'swarm'): void
  draftSettings?: Session['settings']
  onDraftSettingsChange?(next: Pick<SessionSettings, 'providerOptions'>): void
  /** The chat's scope (shown in the scope pill). */
  scopeId?: string
  /** Change the chat's scope; the scope pill renders only when this is given. */
  onScopeChange?(scopeId: string | undefined): void
}

function lastAssistantText(
  session:
    | {
        messages?: Array<{
          role?: string
          contentParts?: Array<{ type: string; text?: string }>
        }>
      }
    | null
    | undefined
): string {
  const messages = session?.messages
  if (!messages?.length) return ''
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    return (message.contentParts || [])
      .filter((part) => part.type === 'text' && typeof part.text === 'string')
      .map((part) => part.text || '')
      .join('\n')
      .trim()
  }
  return ''
}

async function playSpeechBytes(bytes: Uint8Array) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  const blob = new Blob([copy.buffer], { type: 'audio/mpeg' })
  const url = URL.createObjectURL(blob)
  try {
    const audio = new Audio(url)
    await new Promise<void>((resolve, reject) => {
      audio.onended = () => resolve()
      audio.onerror = () => reject(new Error('Audio playback failed'))
      void audio.play().catch(reject)
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

const InputBox = forwardRef<InputBoxRef, InputBoxProps>(
  (
    {
      sessionId,
      sessionType = 'chat',
      generating = false,
      model,
      modelDisplayName,
      fullWidth = false,
      onSelectModel,
      onSubmit,
      onStopGenerating,
      onStartNewThread,
      onRollbackThread,
      onClickSessionSettings,
      agentMode: controlledAgentMode,
      onToggleAgentMode,
      workspaceRoot: controlledWorkspaceRoot,
      onWorkspaceRootChange,
      browserArmed: controlledBrowserArmed,
      onBrowserArmedChange,
      computerArmed: controlledComputerArmed,
      onComputerArmedChange,
      initialMessage = '',
      draftAgentIds,
      onDraftAgentIdsChange,
      draftRoomMode,
      onDraftRoomModeChange,
      draftSettings,
      onDraftSettingsChange,
      scopeId,
      onScopeChange,
    },
    ref
  ) => {
    const { t } = useTranslation()
    const navigate = useNavigate()
    const { scopes } = useScopes()
    const isSmallScreen = useIsSmallScreen()
    const toolbarIconSize = isSmallScreen ? 22 : 18
    const toolbarButtonClass = cn(
      'flex items-center gap-1 rounded-lg hover:bg-[var(--chatbox-background-tertiary)] transition-colors',
      isSmallScreen ? 'mobile-touch-target px-2.5 py-1.5 rounded-xl min-h-11' : 'px-2 py-1'
    )
    const { height: viewportHeight } = useViewportSize()
    const pasteLongTextAsAFile = useSettingsStore((state) => state.pasteLongTextAsAFile)
    const shortcuts = useSettingsStore((state) => state.shortcuts)
    const widthFull = fullWidth

    const currentSessionId = sessionId
    const isNewSession = currentSessionId === 'new'

    // Session-level web browsing mode (default ON when search is configured)
    const sessionWebBrowsingMap = useUIStore((s) => s.sessionWebBrowsingMap)
    const setSessionWebBrowsing = useUIStore((s) => s.setSessionWebBrowsing)
    const updateCurrentWebBrowsingDisplay = useUIStore((s) => s.updateCurrentWebBrowsingDisplay)
    const extensionWebSearch = useSettingsStore((s) => s.extension.webSearch)
    const browserMasterEnabled = Boolean(useSettingsStore((s) => s.extension?.browserAgent?.enabled))
    const computerMasterEnabled = Boolean(useSettingsStore((s) => s.extension?.computerUse?.enabled))
    const voiceCopilot = mergeVoiceConfig(useSettingsStore((s) => s.extension?.voiceCopilot))
    const voiceHoldShortcut = useSettingsStore((s) => s.shortcuts?.voiceHold) || 'Alt+Shift+M'
    const webSearchConfigured = useMemo(() => isWebSearchConfigured(extensionWebSearch), [extensionWebSearch])
    const webBrowsingMode = useMemo(() => {
      const sessionValue = sessionWebBrowsingMap[currentSessionId || 'new']
      if (sessionValue !== undefined) {
        return sessionValue
      }
      return webSearchConfigured
    }, [sessionWebBrowsingMap, currentSessionId, webSearchConfigured])

    // this is used for keyboard shortcut. if we don't provide this, kbd wont know what to set when it's a new session(it doesnt have provider info)
    useEffect(() => {
      updateCurrentWebBrowsingDisplay(currentSessionId || 'new', webBrowsingMode)
    }, [currentSessionId, webBrowsingMode, updateCurrentWebBrowsingDisplay])

    const setWebBrowsingMode = useCallback(
      (enabled: boolean) => {
        setSessionWebBrowsing(currentSessionId || 'new', enabled)
      },
      [currentSessionId, setSessionWebBrowsing]
    )

    const { messageInput, setMessageInput, clearDraft } = useMessageInput(initialMessage, { isNewSession })
    const memoryReady = useMemoryStore((state) => state.ready)
    const globalMemoryBank = useMemoryStore((state) => state.globalBank)

    useEffect(() => {
      void ensureMemoryStoreInit()
    }, [])

    const { promptPresets } = usePromptPresets()
    const { enabledSkills, skills: allSkills } = useSkills()
    const { enabledCommands, commands: allCommands } = useCommands()
    /** Session-sticky skill chips selected via $ */
    const [selectedSkills, setSelectedSkills] = useState<SkillPackage[]>([])
    const [skillPickerDismissed, setSkillPickerDismissed] = useState(false)
    const [skillHighlightIndex, setSkillHighlightIndex] = useState(0)
    /** Session-sticky connected accounts selected via # */
    const [selectedCredentials, setSelectedCredentials] = useState<IntegrationAccount[]>([])
    const [credentialPickerDismissed, setCredentialPickerDismissed] = useState(false)
    const [credentialHighlightIndex, setCredentialHighlightIndex] = useState(0)
    const integrationAccounts = useIntegrationsStore((s) => s.catalog.accounts)
    const integrationsReady = useIntegrationsStore((s) => s.ready)

    useEffect(() => {
      void ensureIntegrationsStoreInit()
    }, [])
    /** Turn-sticky command chips selected via / */
    const [selectedCommands, setSelectedCommands] = useState<CommandPackage[]>([])
    const [commandPickerDismissed, setCommandPickerDismissed] = useState(false)
    const [commandHighlightIndex, setCommandHighlightIndex] = useState(0)
    /** Turn-sticky agent chips selected via @ — pruned when @token leaves the draft */
    const [selectedAgents, setSelectedAgents] = useState<AgentDetail[]>([])
    const [memoryAttachments, setMemoryAttachments] = useState<MemoryAttachment[]>([])
    const [quoteDraft, setLocalQuoteDraft] = useState<QuoteDraft | null>(null)
    const [memoryMentionPickerDismissed, setMemoryMentionPickerDismissed] = useState(false)
    const [memoryMentionHighlightIndex, setMemoryMentionHighlightIndex] = useState(0)
    const [agentPickerDismissed, setAgentPickerDismissed] = useState(false)
    const [agentHighlightIndex, setAgentHighlightIndex] = useState(0)
    const { copilots: myAgents } = useMyCopilots()
    const { copilots: remoteAgents } = useRemoteCopilots()
    const allAgents = useMemo(() => {
      const map = new Map<string, AgentDetail>()
      for (const a of myAgents) map.set(a.id, a)
      for (const a of remoteAgents || []) {
        if (!map.has(a.id)) map.set(a.id, a)
      }
      return Array.from(map.values())
    }, [myAgents, remoteAgents])

    /**
     * Source of truth for turn mentions is the draft text (@ $ # tokens).
     * When the user backspaces a chip, drop sticky picker state so send/room
     * does not keep routing to a removed agent/skill/account.
     */
    useEffect(() => {
      const slugs = extractAgentSlugsFromText(messageInput)
      const matchables = allAgents.map((a) => ({ id: a.id, name: a.name }))
      const idsInText = new Set(
        slugs.map((slug) => matchAgentBySlug(matchables, slug)?.id).filter((id): id is string => Boolean(id))
      )
      setSelectedAgents((prev) => {
        if (prev.length === 0) return prev
        const next = prev.filter((a) => idsInText.has(a.id))
        return next.length === prev.length ? prev : next
      })

      const skillNames = new Set(extractSkillNamesFromText(messageInput))
      setSelectedSkills((prev) => {
        if (prev.length === 0) return prev
        const next = prev.filter((s) => skillNames.has(s.name))
        return next.length === prev.length ? prev : next
      })

      const credSlugs = extractCredentialSlugsFromText(messageInput)
      const credMatchables = integrationAccounts.map((a) => ({
        id: a.id,
        label: a.label,
        accountHint: a.accountHint,
        connectorId: a.connectorId,
        connectorName: getConnector(a.connectorId)?.name,
      }))
      const credIdsInText = new Set(
        credSlugs
          .map((slug) => matchCredentialBySlug(credMatchables, slug)?.id)
          .filter((id): id is string => Boolean(id))
      )
      setSelectedCredentials((prev) => {
        if (prev.length === 0) return prev
        const next = prev.filter((a) => credIdsInText.has(a.id))
        return next.length === prev.length ? prev : next
      })
    }, [messageInput, allAgents, integrationAccounts])

    // Pre-constructed message state (scoped by session)
    const [preConstructedMessage, setPreConstructedMessage] = useAtom(
      atoms.inputBoxPreConstructedMessageFamily(currentSessionId || 'new')
    )
    const [clipboardPrefillText, setClipboardPrefillText] = useAtom(
      atoms.inputBoxPrefillTextFamily(currentSessionId || 'new')
    )
    const pictureKeys = preConstructedMessage.pictureKeys || []
    const attachments = preConstructedMessage.attachments || []
    useEffect(() => {
      if (clipboardPrefillText === null) return
      setMessageInput(clipboardPrefillText)
      setClipboardPrefillText(null)
      dom.focusMessageInput()
      dom.setMessageInputCursorToEnd()
    }, [clipboardPrefillText, setClipboardPrefillText, setMessageInput])
    const { session: currentSession } = useSession(sessionId || null)
    const { sessionSettings: currentSessionMergedSettings } = useSessionSettings(sessionId || null)
    const agentMode = controlledAgentMode ?? currentSession?.agentMode ?? false
    const workspaceRoot = controlledWorkspaceRoot ?? currentSession?.workspaceRoot
    const isOpenClawModel = model?.provider === ModelProviderEnum.OpenClaw
    const showWorkspaceHint =
      agentMode &&
      !workspaceRoot &&
      !isOpenClawModel &&
      CHATBOX_BUILD_PLATFORM !== 'android' &&
      CHATBOX_BUILD_PLATFORM !== 'web' &&
      Boolean(onWorkspaceRootChange)

    const toggleAgentMode = useCallback(() => {
      onToggleAgentMode?.(!agentMode)
      dom.focusMessageInput()
    }, [agentMode, onToggleAgentMode])

    // Get current messages for token counting - will only recalculate when stable messages actually change
    // Uses getContextMessageIds to respect compaction points
    const currentContextMessageIds = useMemo(() => {
      if (isNewSession) return null
      if (!currentSession?.messages.length) return null

      return getContextMessageIds(currentSession, currentSessionMergedSettings?.maxContextMessageCount)
    }, [isNewSession, currentSessionMergedSettings?.maxContextMessageCount, currentSession])

    const { knowledgeBase, setKnowledgeBase } = useKnowledgeBase({ isNewSession })

    const [showCompressionModal, setShowCompressionModal] = useState(false)

    const [links, setLinks] = useAtom(atoms.inputBoxLinksFamily(currentSessionId || 'new'))
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [isSamplingVideoFrames, setIsSamplingVideoFrames] = useState(false)
    const [visionBannerDismissed, setVisionBannerDismissed] = useState(false)
    // Sticky Stop bridges submit → first generating=true, AND any brief false flicker mid-stream.
    // Only clear after generating stays false for a short settle window (not on first true).
    const [stickyStop, setStickyStop] = useState(false)
    const stickyStopClearTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    useEffect(() => {
      if (generating) {
        setStickyStop(true)
        if (stickyStopClearTimer.current) {
          clearTimeout(stickyStopClearTimer.current)
          stickyStopClearTimer.current = null
        }
        return
      }
      // generating false — delay drop so mid-stream false frames cannot flash Send.
      if (!stickyStop) return
      if (stickyStopClearTimer.current) clearTimeout(stickyStopClearTimer.current)
      stickyStopClearTimer.current = setTimeout(() => {
        stickyStopClearTimer.current = null
        setStickyStop(false)
      }, 220)
      return () => {
        if (stickyStopClearTimer.current) {
          clearTimeout(stickyStopClearTimer.current)
          stickyStopClearTimer.current = null
        }
      }
    }, [generating, stickyStop])

    useEffect(() => {
      const constructedMessage = sessionHelpers.constructUserMessage(
        messageInput,
        pictureKeys,
        preConstructedMessage.preprocessedFiles,
        preConstructedMessage.preprocessedLinks
      )
      setPreConstructedMessage((prev) => ({
        ...prev,
        text: messageInput,
        pictureKeys,
        attachments,
        links,
        message: constructedMessage,
      }))
    }, [
      messageInput,
      pictureKeys,
      attachments,
      links,
      preConstructedMessage.preprocessedFiles,
      preConstructedMessage.preprocessedLinks,
      setPreConstructedMessage,
    ])

    const pictureInputRef = useRef<HTMLInputElement | null>(null)
    const fileInputRef = useRef<HTMLInputElement | null>(null)
    /** Skip identical resized payloads from double-paste / multi-representation clipboard. */
    const recentImageFingerprintsRef = useRef<Map<string, number>>(new Map())
    /** Guard against iOS/WebKit double-firing paste for the same gesture. */
    const lastPasteAtRef = useRef(0)
    /** Anchor for portaled @ / $ / / pickers (avoids blank-home overflow clip). */
    const composerCardRef = useRef<HTMLDivElement | null>(null)
    const pendingVoiceSubmitRef = useRef<string | null>(null)
    const pendingVoiceTtsRef = useRef(false)
    const voiceSawGeneratingRef = useRef(false)
    const messageInputRef = useRef(messageInput)
    messageInputRef.current = messageInput
    const handleSubmitRef = useRef<(needGenerating?: boolean) => Promise<void>>(async () => {})

    // Check if any preprocessing is in progress
    const isPreprocessing = useMemo(() => {
      const hasProcessingFiles = Object.values(preConstructedMessage.preprocessingStatus.files || {}).some(
        (status) => status === 'processing'
      )
      const hasProcessingLinks = Object.values(preConstructedMessage.preprocessingStatus.links || {}).some(
        (status) => status === 'processing'
      )
      return hasProcessingFiles || hasProcessingLinks
    }, [preConstructedMessage.preprocessingStatus])

    // Check if any preprocessing has errors
    const hasPreprocessErrors = useMemo(() => {
      const hasErrorFiles = Object.values(preConstructedMessage.preprocessingStatus.files || {}).some(
        (status) => status === 'error'
      )
      const hasErrorLinks = Object.values(preConstructedMessage.preprocessingStatus.links || {}).some(
        (status) => status === 'error'
      )
      return hasErrorFiles || hasErrorLinks
    }, [preConstructedMessage.preprocessingStatus])

    const disableSubmit = useMemo(
      () =>
        !(
          messageInput.trim() ||
          links?.length ||
          attachments?.length ||
          pictureKeys?.length ||
          memoryAttachments.length ||
          !!quoteDraft?.text?.trim()
        ),
      [messageInput, links, attachments, pictureKeys, memoryAttachments.length, quoteDraft?.text]
    )

    const { providers } = useProviders()
    const resolvedModelDisplayText = useMemo(() => getModelDisplayName(providers, model), [model, providers])
    const modelSelectorDisplayText = modelDisplayName || resolvedModelDisplayText || t('Select Model')

    const hasVideoAttachments = useMemo(() => {
      return (preConstructedMessage.preprocessedFiles || []).some((f) => f.mediaKind === 'video' && !f.error)
    }, [preConstructedMessage.preprocessedFiles])

    const modelSupportsVision = useMemo(() => {
      if (!model) return true
      const providerInfo = providers.find((p) => p.id === model.provider)
      const modelInfo = (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find(
        (m) => m.modelId === model.modelId
      )
      // Unknown capability: don't nag; only warn when vision is explicitly absent
      if (!modelInfo?.capabilities) return true
      return modelInfo.capabilities.includes('vision')
    }, [providers, model])

    const showNonVisionVideoBanner = hasVideoAttachments && !modelSupportsVision && !visionBannerDismissed

    const modelReadiness = useMemo(
      () => getModelReadiness(model, providers, { requiresVision: pictureKeys.length > 0 || hasVideoAttachments }),
      [hasVideoAttachments, model, pictureKeys.length, providers]
    )

    const videoLimitsForUi = useMemo(() => getVideoLimits(platform.formFactor === 'desktop' ? 'desktop' : 'mobile'), [])
    const videoDropLimitsHint = useMemo(
      () => ({
        minutes: Math.floor(videoLimitsForUi.maxDurationSec / 60),
        size: formatBytesForDisplay(videoLimitsForUi.maxFileBytes),
      }),
      [videoLimitsForUi]
    )

    // Re-show banner when a new successful video is attached after dismiss
    useEffect(() => {
      if (!hasVideoAttachments) {
        setVisionBannerDismissed(false)
      }
    }, [hasVideoAttachments])

    // Get model info for context window
    const modelInfo = useMemo(() => {
      if (!model) return null
      const providerInfo = providers.find((p) => p.id === model.provider)
      return (providerInfo?.models || providerInfo?.defaultSettings?.models)?.find((m) => m.modelId === model.modelId)
    }, [providers, model])

    // Check if model supports tool use for files
    const { data: modelSupportToolUseForFile = false } = useQuery({
      queryKey: ['model-tool-capability', model?.provider, model?.modelId],
      queryFn: async () => {
        if (!model?.provider || !model?.modelId) {
          return false
        }

        try {
          const globalSettings = settingsStore.getState().getSettings()
          const configs = await platform.getConfig()
          const dependencies = await createModelDependencies()

          const settings = {
            provider: model.provider,
            modelId: model.modelId,
            ...currentSessionMergedSettings,
          }

          const modelInstance = getModel(settings, globalSettings, configs, dependencies)
          return modelInstance.isSupportToolUse('read-file')
        } catch (e) {
          console.debug('useModelToolCapability: failed to check capability', e)
          return false
        }
      },
      enabled: !!(model?.provider && model?.modelId),
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    })

    // Calculate token counts using unified cache layer
    const globalSettings = useSettingsStore((state) => state)
    const { contextTokens, currentInputTokens, totalTokens, isCalculating, pendingTasks, messageCount } =
      useContextTokens({
        sessionId: currentSessionId || null,
        session: currentSession,
        settings: currentSessionMergedSettings || {},
        globalSettings,
        model,
        modelSupportToolUseForFile,
        constructedMessage: preConstructedMessage.message,
      })

    const [isCompacting, setIsCompacting] = useState(false)

    const compactionUIStateMap = useAtomValue(compactionUIStateMapAtom)
    const isCompactionRunning = useMemo(() => {
      if (!currentSessionId || isNewSession) return false
      return compactionUIStateMap[currentSessionId]?.status === 'running'
    }, [compactionUIStateMap, currentSessionId, isNewSession])

    const isModelReadinessBlocking = platformCapabilities.isMobileLayout && modelReadiness.status !== 'ready'
    // While generating (or sticky race window), button is always Stop and always clickable.
    // Never key Stop on empty-draft (old: generating && disableSubmit) — that flipped Send mid-turn.
    const showStop = Boolean(generating || stickyStop)
    const usageBudget = useSettingsStore((s) => s.usageBudget)
    const budgetEval = useUsageBudgetState(model?.provider)
    const hardStopBlocked = shouldHardStopSend(usageBudget ?? DEFAULT_USAGE_BUDGET, budgetEval)
    const hardStopMessage = budgetEval.message

    const sendDisabled = showStop
      ? false
      : isModelReadinessBlocking ||
        disableSubmit ||
        isPreprocessing ||
        isSubmitting ||
        isSamplingVideoFrames ||
        isCompactionRunning ||
        hardStopBlocked

    const autoCompactionEnabled = useMemo(() => {
      if (!currentSession) return globalSettings.autoCompaction ?? true
      return isAutoCompactionEnabled(currentSession.settings, globalSettings)
    }, [currentSession, globalSettings])

    const contextWindowKnown = useMemo(() => {
      if (!model?.modelId) return false
      return !!modelInfo?.contextWindow || getModelContextWindowSync(model.modelId) !== null
    }, [model?.modelId, modelInfo?.contextWindow])

    // Use model setting contextWindow if available, otherwise fallback to models.dev data
    const effectiveContextWindow = useMemo(() => {
      if (modelInfo?.contextWindow) return modelInfo.contextWindow
      if (model?.modelId) return getModelContextWindowSync(model.modelId)
      return null
    }, [modelInfo?.contextWindow, model?.modelId])

    useEffect(() => {
      if (!currentSessionId || isNewSession) {
        setIsCompacting(false)
        return
      }
      const checkCompacting = () => {
        setIsCompacting(isCompactionInProgress(currentSessionId))
      }
      checkCompacting()
      const interval = setInterval(checkCompacting, 1000)
      return () => clearInterval(interval)
    }, [currentSessionId, isNewSession])

    const handleAutoCompactionChange = useCallback(
      async (enabled: boolean) => {
        if (!currentSessionId || isNewSession) return
        await chatStore.updateSession(currentSessionId, (session) => {
          if (!session) {
            throw new Error('Session not found')
          }
          return {
            ...session,
            settings: {
              ...session.settings,
              autoCompaction: enabled,
            },
          }
        })
      },
      [currentSessionId, isNewSession]
    )

    const handleMemoryAutoSaveChange = useCallback(
      async (enabled: boolean) => {
        if (!currentSessionId || isNewSession) return
        await chatStore.updateSession(currentSessionId, (session) => {
          if (!session) {
            throw new Error('Session not found')
          }
          return {
            ...session,
            settings: {
              ...session.settings,
              memoryAutoSave: enabled ? undefined : false,
            },
          }
        })
      },
      [currentSessionId, isNewSession]
    )

    // Publish token menu state to statusline (composer chip removed)
    const setComposerTokenMenu = useSetAtom(composerTokenMenuAtom)
    useEffect(() => {
      if (!currentSessionId) {
        setComposerTokenMenu(null)
        return
      }
      setComposerTokenMenu({
        sessionId: currentSessionId,
        currentInputTokens,
        contextTokens,
        totalTokens,
        isCalculating,
        pendingTasks,
        totalContextMessages: messageCount,
        contextWindow: effectiveContextWindow ?? undefined,
        currentMessageCount: currentContextMessageIds?.length ?? 0,
        maxContextMessageCount: currentSessionMergedSettings?.maxContextMessageCount,
        autoCompactionEnabled,
        isCompacting,
        contextWindowKnown,
        onCompressClick: !isNewSession ? () => setShowCompressionModal(true) : undefined,
        onAutoCompactionChange: !isNewSession ? handleAutoCompactionChange : undefined,
      })
      return () => {
        setComposerTokenMenu((prev) => (prev?.sessionId === currentSessionId ? null : prev))
      }
    }, [
      currentSessionId,
      currentInputTokens,
      contextTokens,
      totalTokens,
      isCalculating,
      pendingTasks,
      messageCount,
      effectiveContextWindow,
      currentContextMessageIds?.length,
      currentSessionMergedSettings?.maxContextMessageCount,
      autoCompactionEnabled,
      isCompacting,
      contextWindowKnown,
      isNewSession,
      handleAutoCompactionChange,
      setComposerTokenMenu,
    ])

    const [showSelectModelErrorTip, setShowSelectModelErrorTip] = useState(false)
    useEffect(() => {
      if (showSelectModelErrorTip) {
        const clickEventListener = () => {
          setShowSelectModelErrorTip(false)
          document.removeEventListener('click', clickEventListener)
        }
        document.addEventListener('click', clickEventListener)
        return () => {
          document.removeEventListener('click', clickEventListener)
        }
      }
    }, [showSelectModelErrorTip])

    const [showRollbackThreadButton, setShowRollbackThreadButton] = useState(false)
    useEffect(() => {
      if (showRollbackThreadButton) {
        const tid = setTimeout(() => {
          setShowRollbackThreadButton(false)
        }, 5000)
        return () => {
          clearTimeout(tid)
        }
      }
    }, [showRollbackThreadButton])

    const richInputRef = useRef<ComposerRichInputHandle | null>(null)
    /** Prevent double Tab/Enter when both native capture + React handlers fire */
    const pickerSelectLockRef = useRef(false)

    const resolveComposerToken = useCallback(
      (token: string): Partial<ComposerChipData> | null => {
        if (token.toLowerCase().startsWith('@mem:')) {
          const slug = token.slice(5)
          return { kind: 'mem', token, label: slug || t('Memory') }
        }
        if (token.startsWith('@')) {
          const slug = token.slice(1)
          const matched = matchAgentBySlug(
            allAgents.map((a) => ({ id: a.id, name: a.name })),
            slug
          )
          const agent = matched ? allAgents.find((a) => a.id === matched.id) : undefined
          if (agent) {
            return {
              kind: 'agent',
              token,
              label: agent.name,
              emoji: agent.emojiAvatar,
              id: agent.id,
            }
          }
          return null
        }
        if (token.startsWith('$')) {
          const name = token.slice(1)
          const skill = allSkills.find((s) => s.name.toLowerCase() === name.toLowerCase())
          if (skill) return { kind: 'skill', token, label: skill.name, id: skill.id }
          return null
        }
        if (token.startsWith('#')) {
          const slug = token.slice(1)
          const matchables = integrationAccounts.map((a) => ({
            id: a.id,
            label: a.label,
            accountHint: a.accountHint,
            connectorId: a.connectorId,
            connectorName: getConnector(a.connectorId)?.name,
          }))
          const matched = matchCredentialBySlug(matchables, slug)
          if (matched) {
            return { kind: 'account', token, label: matched.label, id: matched.id }
          }
        }
        return null
      },
      [allAgents, allSkills, integrationAccounts, t]
    )

    const insertMemory = useCallback((entry: MemoryEntry) => {
      setMemoryAttachments((previous) => {
        if (previous.some((attachment) => attachment.id === entry.id)) return previous
        return [...previous, { id: entry.id, content: entry.content, tags: entry.tags }]
      })
      requestAnimationFrame(() => {
        dom.focusMessageInput()
      })
    }, [])

    const removeMemoryAttachment = useCallback((id: string) => {
      setMemoryAttachments((previous) => previous.filter((attachment) => attachment.id !== id))
    }, [])

    const getMemorySaveContent = useCallback(
      () => getComposerSelectionOrDraft(richInputRef.current?.getElement() ?? null, messageInput),
      [messageInput]
    )

    useImperativeHandle(
      ref,
      () => ({
        setQuote: (data) => {
          if (typeof data === 'string') {
            const text = data
              .replace(/^> /gm, '')
              .replace(/\n*-------------------\n*$/g, '')
              .trim()
            if (!text) return
            setLocalQuoteDraft({ text, isPartial: false })
          } else {
            setLocalQuoteDraft(data)
          }
          dom.focusMessageInput()
          dom.setMessageInputCursorToEnd()
        },
        insertMemory,
        getMemorySaveContent,
      }),
      [getMemorySaveContent, insertMemory]
    )

    const { addInputBoxHistory, getPreviousHistoryInput, getNextHistoryInput, resetHistoryIndex } = useInputBoxHistory()
    const [presetHighlightIndex, setPresetHighlightIndex] = useState(0)
    // Presets no longer own bare `/` — Commands do. Preset picker stays available via Settings.
    const showPresetPicker = false
    const [openClawPickerDismissed, setOpenClawPickerDismissed] = useState(false)

    const showOpenClawCommandPicker = useMemo(
      () =>
        sessionType === 'chat' &&
        isOpenClawModel &&
        messageInput.startsWith('/') &&
        !messageInput.includes('\n') &&
        !messageInput.includes(' ') &&
        !openClawPickerDismissed,
      [isOpenClawModel, messageInput, sessionType, openClawPickerDismissed]
    )
    const commandSlashQuery = useMemo(
      () => (sessionType === 'chat' && !isOpenClawModel ? getActiveCommandSlashQuery(messageInput) : null),
      [isOpenClawModel, messageInput, sessionType]
    )
    const skillDollarQuery = useMemo(
      () => (sessionType === 'chat' ? getActiveSkillDollarQuery(messageInput) : null),
      [messageInput, sessionType]
    )
    const credentialHashQuery = useMemo(
      () => (sessionType === 'chat' ? getActiveCredentialHashQuery(messageInput) : null),
      [messageInput, sessionType]
    )
    const agentAtQuery = useMemo(
      () => (sessionType === 'chat' ? getActiveAgentAtQuery(messageInput) : null),
      [messageInput, sessionType]
    )
    const memoryMentionQuery = useMemo(
      () => (sessionType === 'chat' ? getActiveMemoryMentionQuery(messageInput) : null),
      [messageInput, sessionType]
    )

    /** Agents already tagged in the draft (inline @slug + picker selections). */
    const draftMentionedAgentIds = useMemo(() => {
      const ids = new Set(selectedAgents.map((a) => a.id))
      for (const slug of extractAgentSlugsFromText(messageInput)) {
        const matched = matchAgentBySlug(
          allAgents.map((a) => ({ id: a.id, name: a.name })),
          slug
        )
        if (matched) ids.add(matched.id)
      }
      return Array.from(ids)
    }, [allAgents, messageInput, selectedAgents])

    const draftMentionedSkillIds = useMemo(() => {
      const ids = new Set(selectedSkills.map((s) => s.id))
      const nameToSkill = new Map(enabledSkills.map((s) => [s.name, s]))
      for (const name of extractSkillNamesFromText(messageInput)) {
        const s = nameToSkill.get(name)
        if (s) ids.add(s.id)
      }
      return Array.from(ids)
    }, [enabledSkills, messageInput, selectedSkills])

    const draftMentionedCredentialIds = useMemo(() => {
      const ids = new Set(selectedCredentials.map((a) => a.id))
      const matchables = integrationAccounts.map((a) => ({
        id: a.id,
        label: a.label,
        accountHint: a.accountHint,
        connectorId: a.connectorId,
        connectorName: getConnector(a.connectorId)?.name,
      }))
      for (const slug of extractCredentialSlugsFromText(messageInput)) {
        const matched = matchCredentialBySlug(matchables, slug)
        if (matched) ids.add(matched.id)
      }
      return Array.from(ids)
    }, [integrationAccounts, messageInput, selectedCredentials])

    const showCommandPicker = useMemo(
      () =>
        sessionType === 'chat' &&
        commandSlashQuery !== null &&
        !showOpenClawCommandPicker &&
        !commandPickerDismissed &&
        selectedCommands.length < COMMAND_EXPLICIT_MAX,
      [sessionType, commandSlashQuery, showOpenClawCommandPicker, commandPickerDismissed, selectedCommands.length]
    )
    const showSkillPicker = useMemo(
      () =>
        sessionType === 'chat' &&
        skillDollarQuery !== null &&
        !showCommandPicker &&
        !showOpenClawCommandPicker &&
        !skillPickerDismissed &&
        draftMentionedSkillIds.length < SKILL_EXPLICIT_MAX,
      [
        sessionType,
        skillDollarQuery,
        showCommandPicker,
        showOpenClawCommandPicker,
        skillPickerDismissed,
        draftMentionedSkillIds.length,
      ]
    )
    const showCredentialPicker = useMemo(
      () =>
        sessionType === 'chat' &&
        credentialHashQuery !== null &&
        !showCommandPicker &&
        !showOpenClawCommandPicker &&
        !showSkillPicker &&
        !credentialPickerDismissed &&
        draftMentionedCredentialIds.length < CREDENTIAL_CHIP_MAX,
      [
        sessionType,
        credentialHashQuery,
        showCommandPicker,
        showOpenClawCommandPicker,
        showSkillPicker,
        credentialPickerDismissed,
        draftMentionedCredentialIds.length,
      ]
    )
    const showAgentPicker = useMemo(
      () =>
        sessionType === 'chat' &&
        agentAtQuery !== null &&
        memoryMentionQuery === null &&
        !showCommandPicker &&
        !showOpenClawCommandPicker &&
        !showSkillPicker &&
        !showCredentialPicker &&
        !agentPickerDismissed &&
        draftMentionedAgentIds.length < MAX_ROOM_AGENTS,
      [
        sessionType,
        agentAtQuery,
        memoryMentionQuery,
        showCommandPicker,
        showOpenClawCommandPicker,
        showSkillPicker,
        showCredentialPicker,
        agentPickerDismissed,
        draftMentionedAgentIds.length,
      ]
    )
    const showMemoryMentionPicker = useMemo(
      () =>
        sessionType === 'chat' &&
        memoryMentionQuery !== null &&
        !showCommandPicker &&
        !showOpenClawCommandPicker &&
        !showSkillPicker &&
        !showCredentialPicker &&
        !memoryMentionPickerDismissed,
      [
        sessionType,
        memoryMentionQuery,
        showCommandPicker,
        showOpenClawCommandPicker,
        showSkillPicker,
        showCredentialPicker,
        memoryMentionPickerDismissed,
      ]
    )
    const filteredCommandItems = useMemo(
      () =>
        buildCommandPickerItems(commandSlashQuery || '', enabledCommands, {
          excludePackageIds: selectedCommands.map((c) => c.id),
          includeSystem: true,
        }),
      [enabledCommands, selectedCommands, commandSlashQuery]
    )
    const filteredCommands = useMemo(
      () => filteredCommandItems.filter((i) => i.kind === 'package').map((i) => i.command),
      [filteredCommandItems]
    )

    const filteredSkills = useMemo(
      () =>
        filterSkills(
          enabledSkills.filter((s) => !draftMentionedSkillIds.includes(s.id)),
          skillDollarQuery || ''
        ).slice(0, 8),
      [enabledSkills, draftMentionedSkillIds, skillDollarQuery]
    )
    const filteredCredentials = useMemo(
      () =>
        filterCredentials(
          integrationAccounts.filter((a) => !draftMentionedCredentialIds.includes(a.id)),
          credentialHashQuery || ''
        ).slice(0, 8),
      [integrationAccounts, draftMentionedCredentialIds, credentialHashQuery]
    )

    // Hydrate session-sticky credentials when session loads
    useEffect(() => {
      if (!integrationsReady || !currentSession?.credentialIds?.length) return
      const ids = currentSession.credentialIds
      setSelectedCredentials((prev) => {
        if (prev.length > 0) return prev
        return integrationAccounts.filter((a) => ids.includes(a.id))
      })
    }, [integrationsReady, currentSession?.id, currentSession?.credentialIds, integrationAccounts])
    const filteredAgents = useMemo(
      () =>
        filterAgents(
          allAgents.filter((a) => !draftMentionedAgentIds.includes(a.id)),
          agentAtQuery || ''
        ).slice(0, 8),
      [allAgents, draftMentionedAgentIds, agentAtQuery]
    )
    const filteredMemoryMentions = useMemo(
      () => searchEntries(globalMemoryBank, memoryMentionQuery || '', { limit: 8, enabledOnly: true }),
      [globalMemoryBank, memoryMentionQuery]
    )
    const roomAgentIds = useMemo(() => {
      if (isNewSession && draftAgentIds && draftAgentIds.length > 0) {
        return draftAgentIds
      }
      return currentSession?.agentIds || (currentSession?.copilotId ? [currentSession.copilotId] : [])
    }, [isNewSession, draftAgentIds, currentSession?.agentIds, currentSession?.copilotId])
    const presetQuery = useMemo(() => (showPresetPicker ? messageInput.slice(1) : ''), [messageInput, showPresetPicker])
    const openClawCommandQuery = useMemo(
      () => (showOpenClawCommandPicker ? messageInput.slice(1) : ''),
      [messageInput, showOpenClawCommandPicker]
    )
    const filteredPresets = useMemo(
      () => filterPresets(promptPresets, presetQuery).slice(0, 8),
      [presetQuery, promptPresets]
    )
    const providerSettings = useSettingsStore((state) => state.providers?.[ModelProviderEnum.OpenClaw])
    const openClawGatewayConfig = useMemo(
      () => ({
        apiHost: providerSettings?.apiHost || 'http://127.0.0.1:18789',
        apiKey: providerSettings?.apiKey || '',
        cloudflareClientId: providerSettings?.cloudflareClientId || '',
        cloudflareClientSecret: providerSettings?.cloudflareClientSecret || '',
      }),
      [providerSettings]
    )
    const { data: openClawCommands = [] } = useQuery({
      queryKey: [
        'openclaw-commands',
        openClawGatewayConfig.apiHost,
        openClawGatewayConfig.apiKey,
        openClawGatewayConfig.cloudflareClientId,
        openClawGatewayConfig.cloudflareClientSecret,
      ],
      queryFn: async () => {
        const client = getOrCreateGatewayClient(openClawGatewayConfig)
        await client.connect()
        const response = await client.listCommands()
        return response.commands ?? []
      },
      enabled: showOpenClawCommandPicker && !!openClawGatewayConfig.apiHost,
      staleTime: 5 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
    })
    const filteredOpenClawCommands = useMemo(
      () => filterOpenClawCommands(openClawCommands, openClawCommandQuery).slice(0, 8),
      [openClawCommands, openClawCommandQuery]
    )

    useEffect(() => {
      setPresetHighlightIndex(0)
      setSkillHighlightIndex(0)
      setCredentialHighlightIndex(0)
      setAgentHighlightIndex(0)
      setCommandHighlightIndex(0)
      setMemoryMentionHighlightIndex(0)
      setOpenClawPickerDismissed(false)
      setSkillPickerDismissed(false)
      setCredentialPickerDismissed(false)
      setAgentPickerDismissed(false)
      setCommandPickerDismissed(false)
      setMemoryMentionPickerDismissed(false)
    }, [
      presetQuery,
      skillDollarQuery,
      credentialHashQuery,
      agentAtQuery,
      memoryMentionQuery,
      commandSlashQuery,
      messageInput,
    ])

    const handleAgentSelect = useCallback(
      (agent: AgentDetail) => {
        const slug = slugifyAgentName(agent.name) || agent.id
        setSelectedAgents((prev) => {
          if (prev.some((a) => a.id === agent.id) || prev.length >= MAX_ROOM_AGENTS) return prev
          return [...prev, agent]
        })
        const token = `@${slug}`
        const chip: ComposerChipData = {
          kind: 'agent',
          token,
          label: agent.name,
          emoji: agent.emojiAvatar,
          id: agent.id,
        }
        if (richInputRef.current) {
          richInputRef.current.insertChipAtTrigger(chip, 'agent')
        } else {
          setMessageInput((prev) => replaceActiveAgentAtWithToken(prev, slug))
        }
        setAgentPickerDismissed(true)
        resetHistoryIndex()
        dom.focusMessageInput()
      },
      [resetHistoryIndex, setMessageInput]
    )

    const handleMemoryMentionSelect = useCallback(
      (entry: MemoryEntry) => {
        insertMemory(entry)
        const label = entry.tags[0] || entry.content.slice(0, 32) || 'note'
        const slug = slugifyMemoryLabel(label) || 'note'
        const token = `@mem:${slug}`
        const chip: ComposerChipData = { kind: 'mem', token, label: entry.tags[0] || label, id: entry.id }
        if (richInputRef.current) {
          richInputRef.current.insertChipAtTrigger(chip, 'mem')
        } else {
          setMessageInput((previous) => replaceActiveMemoryMentionWithToken(previous, label))
        }
        setMemoryMentionPickerDismissed(true)
        resetHistoryIndex()
        dom.focusMessageInput()
      },
      [insertMemory, resetHistoryIndex, setMessageInput]
    )

    /**
     * Remove agent from room membership (session or blank-home draft) AND drop
     * matching @ chips / sticky picker state so discuss/swarm tags stay in sync.
     */
    const handleRemoveRoomAgent = useCallback(
      async (agentId: string) => {
        const next = roomAgentIds.filter((id) => id !== agentId)
        const agent =
          allAgents.find((a) => a.id === agentId) ||
          selectedAgents.find((a) => a.id === agentId) ||
          ({ id: agentId, name: agentId } as AgentDetail)

        // 1) Room membership
        if (isNewSession) {
          onDraftAgentIdsChange?.(next)
        } else if (sessionId) {
          const { toSessionAgentFields } = await import('@shared/agent-room')
          const fields = toSessionAgentFields(next)
          await chatStore.updateSession(sessionId, {
            agentIds: fields.agentIds,
            copilotId: fields.copilotId,
          })
        }

        // 2) Turn-sticky picker state
        setSelectedAgents((prev) => prev.filter((a) => a.id !== agentId))

        // 3) Composer inline @chip / token
        setMessageInput((prev) => {
          const cleaned = stripAgentTokenFromText(prev, agent)
          if (cleaned === prev) return prev
          // Keep rich input DOM in sync on next layout
          queueMicrotask(() => {
            richInputRef.current?.setSerializedValue(cleaned, { cursorToEnd: true })
          })
          return cleaned
        })
      },
      [allAgents, isNewSession, onDraftAgentIdsChange, roomAgentIds, selectedAgents, sessionId, setMessageInput]
    )

    const handleRoomModeChange = useCallback(
      async (mode: 'discuss' | 'work' | 'swarm') => {
        if (isNewSession) {
          onDraftRoomModeChange?.(mode)
          return
        }
        if (!sessionId) return
        const { setSessionRoomMode } = await import('@/stores/session/multi-agent-room')
        await setSessionRoomMode(sessionId, mode)
      },
      [isNewSession, onDraftRoomModeChange, sessionId]
    )

    const handleSkillSelect = useCallback(
      (skill: SkillPackage) => {
        setSelectedSkills((prev) => {
          if (prev.some((s) => s.id === skill.id) || prev.length >= SKILL_EXPLICIT_MAX) return prev
          return [...prev, skill]
        })
        const token = `$${skill.name}`
        const chip: ComposerChipData = { kind: 'skill', token, label: skill.name, id: skill.id }
        if (richInputRef.current) {
          richInputRef.current.insertChipAtTrigger(chip, 'skill')
        } else {
          setMessageInput((prev) => replaceActiveSkillDollarWithToken(prev, skill.name))
        }
        resetHistoryIndex()
        dom.focusMessageInput()
      },
      [resetHistoryIndex, setMessageInput]
    )

    const persistSessionCredentials = useCallback(
      async (accounts: IntegrationAccount[]) => {
        if (!sessionId || isNewSession) return
        try {
          const { updateSession } = await import('@/stores/chatStore')
          await updateSession(sessionId, {
            credentialIds: accounts.length ? accounts.map((a) => a.id) : undefined,
          })
        } catch {
          /* non-fatal */
        }
      },
      [sessionId, isNewSession]
    )

    const handleCredentialSelect = useCallback(
      (account: IntegrationAccount) => {
        setSelectedCredentials((prev) => {
          if (prev.some((a) => a.id === account.id) || prev.length >= CREDENTIAL_CHIP_MAX) return prev
          const next = [...prev, account]
          void persistSessionCredentials(next)
          return next
        })
        const slug =
          slugifyCredentialLabel(account.label) ||
          slugifyCredentialLabel(account.accountHint || '') ||
          account.connectorId
        const token = `#${slug}`
        const chip: ComposerChipData = {
          kind: 'account',
          token,
          label: account.label,
          id: account.id,
        }
        if (richInputRef.current) {
          richInputRef.current.insertChipAtTrigger(chip, 'account')
        } else {
          setMessageInput((prev) => replaceActiveCredentialHashWithToken(prev, slug))
        }
        resetHistoryIndex()
        dom.focusMessageInput()
      },
      [persistSessionCredentials, resetHistoryIndex, setMessageInput]
    )

    const runManualCompact = useCallback(async () => {
      if (isNewSession || !sessionId) {
        toastActions.add(t('Start a chat with a few messages before compacting.'))
        return
      }
      if (isCompactionRunning) {
        toastActions.add(t('Already compacting…'))
        return
      }
      setMessageInput('')
      clearDraft()
      setSelectedCommands([])
      setCommandPickerDismissed(true)
      resetHistoryIndex()
      const result = await runCompactionWithUIState(sessionId, { force: true })
      if (!result.success) {
        toastActions.add(result.error?.message || t('Compaction failed'))
        return
      }
      if (!result.compacted) {
        toastActions.add(t('Nothing to compact yet'))
        return
      }
      toastActions.add(t('Conversation compacted'))
    }, [clearDraft, isCompactionRunning, isNewSession, resetHistoryIndex, sessionId, setMessageInput, t])

    const handleCommandSelect = useCallback(
      (command: CommandPackage) => {
        setSelectedCommands((prev) => {
          if (prev.some((c) => c.id === command.id) || prev.length >= COMMAND_EXPLICIT_MAX) return prev
          return [...prev, command]
        })
        // Clear slash draft (entire single-line /partial)
        setMessageInput((prev) => (getActiveCommandSlashQuery(prev) !== null ? '' : prev))
        setCommandPickerDismissed(false)
        resetHistoryIndex()
        dom.focusMessageInput()
        setTimeout(() => {
          dom.setMessageInputCursorToEnd()
        }, 0)
      },
      [resetHistoryIndex, setMessageInput]
    )

    const handleCommandPickerItem = useCallback(
      (item: CommandPickerItem) => {
        if (item.kind === 'system') {
          if (item.command.id === 'compact') {
            void runManualCompact()
          }
          return
        }
        handleCommandSelect(item.command)
      },
      [handleCommandSelect, runManualCompact]
    )

    const handlePresetSelect = useCallback(
      async (presetId: string) => {
        const preset = filteredPresets.find((item) => item.id === presetId)
        if (!preset) {
          return
        }

        const nextValue = await replacePromptTemplateVars(preset.content, { readClipboard: true })
        setMessageInput(nextValue)
        resetHistoryIndex()
        dom.focusMessageInput()
        setTimeout(() => {
          dom.setMessageInputCursorToEnd()
        }, 0)
      },
      [filteredPresets, resetHistoryIndex, setMessageInput]
    )

    const handleOpenClawCommandSelect = useCallback(
      (command: GatewayCommandInfo) => {
        const nextValue = `${getCommandAlias(command)} `
        setOpenClawPickerDismissed(true)
        setMessageInput(nextValue)
        resetHistoryIndex()
        dom.focusMessageInput()
        setTimeout(() => {
          dom.setMessageInputCursorToEnd()
        }, 0)
      },
      [resetHistoryIndex, setMessageInput]
    )

    const closeSelectModelErrorTipCb = useRef<NodeJS.Timeout>()
    const handleSubmit = async (needGenerating = true) => {
      if (disableSubmit || isSubmitting || isPreprocessing) {
        return
      }
      if (needGenerating && hardStopBlocked) {
        toastActions.add(
          t('Send blocked: {{message}}. Disable hard-stop in Settings → Usage, or raise your monthly cap.', {
            message: hardStopMessage,
          })
        )
        return
      }

      // Built-in slash actions (e.g. /compact) — not chat messages
      const systemCommand = matchSystemSlashCommand(messageInput)
      if (systemCommand?.id === 'compact') {
        await runManualCompact()
        return
      }

      // (legacy comment)
      if (hasPreprocessErrors) {
        toastActions.add(t('Some files failed to parse. Please remove them and try again.'))
        return
      }

      // error tip
      if (platformCapabilities.isMobileLayout && modelReadiness.status !== 'ready') {
        if (!model) {
          // (legacy comment)
          await delay(100)
          if (closeSelectModelErrorTipCb.current) {
            clearTimeout(closeSelectModelErrorTipCb.current)
          }
          setShowSelectModelErrorTip(true)
          closeSelectModelErrorTipCb.current = setTimeout(() => setShowSelectModelErrorTip(false), 5000)
        } else {
          toastActions.add(t('Choose an available model before sending.'))
        }
        return
      }

      setIsSubmitting(true)
      setStickyStop(true)
      if (stickyStopClearTimer.current) clearTimeout(stickyStopClearTimer.current)
      // Safety: if generation never starts (error / needGenerating false), drop sticky Stop.
      stickyStopClearTimer.current = setTimeout(() => {
        stickyStopClearTimer.current = null
        setStickyStop(false)
      }, 4000)
      try {
        // Use the already constructed message
        if (!preConstructedMessage.message) {
          console.error('No constructed message available')
          setStickyStop(false)
          return
        }

        // Sample video frames for vision models right before send
        let constructedMessage = preConstructedMessage.message

        // Parse @ / $ / # tokens from the message body (Slack-style).
        // Keep completed tokens in the sent text so models can follow who/what is directed.
        {
          const rawText = constructedMessage.contentParts.find((p) => p.type === 'text')?.text || ''
          const namesFromText = extractSkillNamesFromText(rawText)
          const nameToSkill = new Map(allSkills.map((s) => [s.name, s]))
          const skillIds: string[] = []
          const seen = new Set<string>()
          for (const s of selectedSkills) {
            if (!seen.has(s.id)) {
              seen.add(s.id)
              skillIds.push(s.id)
            }
          }
          for (const name of namesFromText) {
            const s = nameToSkill.get(name)
            if (s && !seen.has(s.id) && skillIds.length < SKILL_EXPLICIT_MAX) {
              seen.add(s.id)
              skillIds.push(s.id)
            }
          }

          const commandNamesFromText = extractCommandNamesFromText(rawText)
          const nameToCommand = new Map(allCommands.map((c) => [c.name, c]))
          const commandIds: string[] = []
          const seenCmd = new Set<string>()
          for (const c of selectedCommands) {
            if (!seenCmd.has(c.id)) {
              seenCmd.add(c.id)
              commandIds.push(c.id)
            }
          }
          for (const name of commandNamesFromText) {
            const c = nameToCommand.get(name)
            if (c && !seenCmd.has(c.id) && commandIds.length < COMMAND_EXPLICIT_MAX) {
              seenCmd.add(c.id)
              commandIds.push(c.id)
            }
          }

          // Commands still strip: /foo is a lead-in draft, not conversational mention prose
          let cleanedText = stripCommandSlashTokens(rawText)

          // Agents: chips + inline @slug tokens
          const agentMatchables = allAgents.map((a) => ({ id: a.id, name: a.name }))
          const mentionedAgentIds: string[] = []
          const seenAgent = new Set<string>()
          for (const a of selectedAgents) {
            if (!seenAgent.has(a.id) && mentionedAgentIds.length < MAX_ROOM_AGENTS) {
              seenAgent.add(a.id)
              mentionedAgentIds.push(a.id)
            }
          }
          for (const slug of extractAgentSlugsFromText(rawText)) {
            const matched = matchAgentBySlug(agentMatchables, slug)
            if (matched && !seenAgent.has(matched.id) && mentionedAgentIds.length < MAX_ROOM_AGENTS) {
              seenAgent.add(matched.id)
              mentionedAgentIds.push(matched.id)
            }
          }

          const credentialSlugsFromText = extractCredentialSlugsFromText(rawText)
          const matchables = integrationAccounts.map((a) => ({
            id: a.id,
            label: a.label,
            accountHint: a.accountHint,
            connectorId: a.connectorId,
            connectorName: getConnector(a.connectorId)?.name,
          }))
          const credentialIds: string[] = []
          const seenCred = new Set<string>()
          for (const a of selectedCredentials) {
            if (!seenCred.has(a.id)) {
              seenCred.add(a.id)
              credentialIds.push(a.id)
            }
          }
          for (const slug of credentialSlugsFromText) {
            const matched = matchCredentialBySlug(matchables, slug)
            if (matched && !seenCred.has(matched.id) && credentialIds.length < CREDENTIAL_CHIP_MAX) {
              seenCred.add(matched.id)
              credentialIds.push(matched.id)
            }
          }

          // Do not strip @ $ # completed mentions — they are part of the user instruction
          cleanedText = cleanedText
            .replace(/[ \t]{2,}/g, ' ')
            .replace(/ *\n */g, '\n')
            .trim()

          constructedMessage = {
            ...constructedMessage,
            skillIds: skillIds.length ? skillIds : undefined,
            commandIds: commandIds.length ? commandIds : undefined,
            mentionedAgentIds: mentionedAgentIds.length ? mentionedAgentIds : undefined,
            credentialIds: credentialIds.length ? credentialIds : undefined,
            memoryAttachments: memoryAttachments.length ? memoryAttachments : undefined,
            quoteAttachment: quoteDraft
              ? ({
                  sourceMessageId: quoteDraft.sourceMessageId,
                  sourceRole: quoteDraft.sourceRole,
                  text: quoteDraft.text,
                  isPartial: quoteDraft.isPartial,
                  createdAt: Date.now(),
                } satisfies MessageQuoteAttachment)
              : undefined,
            contentParts: constructedMessage.contentParts.map((p) =>
              p.type === 'text' ? { ...p, text: cleanedText } : p
            ),
          }

          // Session sticky: keep selected credentials after send
          if (credentialIds.length && sessionId && !isNewSession) {
            void persistSessionCredentials(integrationAccounts.filter((a) => credentialIds.includes(a.id)))
          }
        }

        const hasVideo = constructedMessage.files?.some((f) => f.mediaKind === 'video')
        if (hasVideo && model?.provider && model?.modelId) {
          setIsSamplingVideoFrames(true)
          try {
            const globalSettings = settingsStore.getState().getSettings()
            const configs = await platform.getConfig()
            const dependencies = await createModelDependencies()
            const modelInstance = getModel(
              {
                provider: model.provider,
                modelId: model.modelId,
                ...currentSessionMergedSettings,
              },
              globalSettings,
              configs,
              dependencies
            )
            const supportsVision = modelInstance.isSupportVision()
            constructedMessage = await sessionHelpers.enrichUserMessageWithVideoFrames(constructedMessage, {
              modelSupportVision: supportsVision,
              formFactor: platform.formFactor === 'desktop' ? 'desktop' : 'mobile',
            })
            // Soft banner already covers this when capabilities are known; keep toast only if banner hidden
            if (!supportsVision && !showNonVisionVideoBanner) {
              toastActions.add(
                t('Current model does not support vision. Switch to a vision model to analyze video frames.')
              )
            }
          } catch (err) {
            console.error('Video frame enrichment failed:', err)
            toastActions.add(t('Failed to process video frames. Try a shorter clip or different format.'))
          } finally {
            setIsSamplingVideoFrames(false)
          }
        }

        const messageTextForHistory = constructedMessage.contentParts.find((p) => p.type === 'text')?.text || ''

        const params = {
          constructedMessage,
          needGenerating,
          onUserMessageReady: () => {
            // Re-enable submit as soon as the message is accepted so follow-up
            // sends can enter the per-session queue while generation continues.
            setIsSubmitting(false)
            clearDraft()
            setSelectedAgents([])
            setSelectedSkills([])
            setSelectedCredentials([])
            setSelectedCommands([])
            setMemoryAttachments([])
            setLocalQuoteDraft(null)
            setLinks([])
            setPreConstructedMessage({
              text: '',
              pictureKeys: [],
              attachments: [],
              links: [],
              preprocessedFiles: [],
              preprocessedLinks: [],
              preprocessingStatus: {
                files: {},
                links: {},
              },
              preprocessingPromises: {
                files: new Map(),
                links: new Map(),
              },
              message: undefined,
            })
            setShowRollbackThreadButton(false)
            if (platform.formFactor !== 'mobile' && messageTextForHistory) {
              addInputBoxHistory(messageTextForHistory)
            }
          },
        }

        await onSubmit?.(params)

        trackingEvent('send_message', { event_category: 'user' })
      } catch (e) {
        console.error('Error submitting message:', e)
        toastActions.add((e as Error)?.message || t('An error occurred while sending the message.'))
        setStickyStop(false)
        if (stickyStopClearTimer.current) {
          clearTimeout(stickyStopClearTimer.current)
          stickyStopClearTimer.current = null
        }
      } finally {
        setIsSubmitting(false)
      }
    }

    /** Clamp highlight into range; fall back to 0 so Tab/Enter still complete. */
    const pickIndex = useCallback((index: number, length: number) => {
      if (length <= 0) return -1
      if (index >= 0 && index < length) return index
      return 0
    }, [])

    /**
     * Handle / @ $ # picker keys. Returns true when the event was consumed.
     * Tab always completes the highlighted (or first) row when a picker is open.
     */
    const handlePickerKeyDown = useCallback(
      (event: {
        key: string
        shiftKey: boolean
        ctrlKey: boolean
        altKey: boolean
        metaKey: boolean
        preventDefault: () => void
        stopPropagation: () => void
      }): boolean => {
        const isPlainEnter =
          event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey
        // Tab complete — ignore Ctrl/Cmd+Tab (session switch) and Alt+Tab
        const isTabComplete = event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey

        const consume = () => {
          event.preventDefault()
          event.stopPropagation()
        }

        const runOnce = (fn: () => void) => {
          if (pickerSelectLockRef.current) return
          pickerSelectLockRef.current = true
          try {
            fn()
          } finally {
            // Unlock after both native capture + React bubble have finished
            window.setTimeout(() => {
              pickerSelectLockRef.current = false
            }, 0)
          }
        }

        if (showCommandPicker) {
          if (event.key === 'ArrowDown') {
            consume()
            if (filteredCommandItems.length > 0) {
              setCommandHighlightIndex((index) => (index + 1) % filteredCommandItems.length)
            }
            return true
          }
          if (event.key === 'ArrowUp') {
            consume()
            if (filteredCommandItems.length > 0) {
              setCommandHighlightIndex(
                (index) => (index - 1 + filteredCommandItems.length) % filteredCommandItems.length
              )
            }
            return true
          }
          if (event.key === 'Escape') {
            consume()
            setCommandPickerDismissed(true)
            return true
          }
          if ((isPlainEnter || isTabComplete) && filteredCommandItems.length > 0) {
            const item = filteredCommandItems[pickIndex(commandHighlightIndex, filteredCommandItems.length)]
            if (item) {
              consume()
              runOnce(() => handleCommandPickerItem(item))
              return true
            }
          }
          // Keep focus in composer while the picker is open (don't tab-away)
          if (isTabComplete) {
            consume()
            return true
          }
        }

        if (showMemoryMentionPicker) {
          if (event.key === 'ArrowDown') {
            consume()
            if (filteredMemoryMentions.length > 0) {
              setMemoryMentionHighlightIndex((index) => (index + 1) % filteredMemoryMentions.length)
            }
            return true
          }
          if (event.key === 'ArrowUp') {
            consume()
            if (filteredMemoryMentions.length > 0) {
              setMemoryMentionHighlightIndex(
                (index) => (index - 1 + filteredMemoryMentions.length) % filteredMemoryMentions.length
              )
            }
            return true
          }
          if (event.key === 'Escape') {
            consume()
            setMemoryMentionPickerDismissed(true)
            return true
          }
          if ((isPlainEnter || isTabComplete) && filteredMemoryMentions.length > 0) {
            const entry = filteredMemoryMentions[pickIndex(memoryMentionHighlightIndex, filteredMemoryMentions.length)]
            if (entry) {
              consume()
              runOnce(() => handleMemoryMentionSelect(entry))
              return true
            }
          }
          if (isTabComplete) {
            consume()
            return true
          }
        }

        if (showAgentPicker) {
          if (event.key === 'ArrowDown') {
            consume()
            if (filteredAgents.length > 0) {
              setAgentHighlightIndex((index) => (index + 1) % filteredAgents.length)
            }
            return true
          }
          if (event.key === 'ArrowUp') {
            consume()
            if (filteredAgents.length > 0) {
              setAgentHighlightIndex((index) => (index - 1 + filteredAgents.length) % filteredAgents.length)
            }
            return true
          }
          if (event.key === 'Escape') {
            consume()
            setAgentPickerDismissed(true)
            return true
          }
          if ((isPlainEnter || isTabComplete) && filteredAgents.length > 0) {
            const agent = filteredAgents[pickIndex(agentHighlightIndex, filteredAgents.length)]
            if (agent) {
              consume()
              runOnce(() => handleAgentSelect(agent))
              return true
            }
          }
          if (isTabComplete) {
            consume()
            return true
          }
        }

        if (showCredentialPicker) {
          if (event.key === 'ArrowDown') {
            consume()
            if (filteredCredentials.length > 0) {
              setCredentialHighlightIndex((index) => (index + 1) % filteredCredentials.length)
            }
            return true
          }
          if (event.key === 'ArrowUp') {
            consume()
            if (filteredCredentials.length > 0) {
              setCredentialHighlightIndex(
                (index) => (index - 1 + filteredCredentials.length) % filteredCredentials.length
              )
            }
            return true
          }
          if (event.key === 'Escape') {
            consume()
            setCredentialPickerDismissed(true)
            return true
          }
          if ((isPlainEnter || isTabComplete) && filteredCredentials.length > 0) {
            const account = filteredCredentials[pickIndex(credentialHighlightIndex, filteredCredentials.length)]
            if (account) {
              consume()
              runOnce(() => handleCredentialSelect(account))
              return true
            }
          }
          if (isTabComplete) {
            consume()
            return true
          }
        }

        if (showSkillPicker) {
          if (event.key === 'ArrowDown') {
            consume()
            if (filteredSkills.length > 0) {
              setSkillHighlightIndex((index) => (index + 1) % filteredSkills.length)
            }
            return true
          }
          if (event.key === 'ArrowUp') {
            consume()
            if (filteredSkills.length > 0) {
              setSkillHighlightIndex((index) => (index - 1 + filteredSkills.length) % filteredSkills.length)
            }
            return true
          }
          if (event.key === 'Escape') {
            consume()
            setSkillPickerDismissed(true)
            return true
          }
          if ((isPlainEnter || isTabComplete) && filteredSkills.length > 0) {
            const skill = filteredSkills[pickIndex(skillHighlightIndex, filteredSkills.length)]
            if (skill) {
              consume()
              runOnce(() => handleSkillSelect(skill))
              return true
            }
          }
          if (isTabComplete) {
            consume()
            return true
          }
        }

        if (showPresetPicker || showOpenClawCommandPicker) {
          const activePickerItems = showOpenClawCommandPicker ? filteredOpenClawCommands : filteredPresets

          if (event.key === 'ArrowDown') {
            consume()
            if (activePickerItems.length > 0) {
              setPresetHighlightIndex((index) => (index + 1) % activePickerItems.length)
            }
            return true
          }
          if (event.key === 'ArrowUp') {
            consume()
            if (activePickerItems.length > 0) {
              setPresetHighlightIndex((index) => (index - 1 + activePickerItems.length) % activePickerItems.length)
            }
            return true
          }
          if (event.key === 'Escape') {
            consume()
            if (showOpenClawCommandPicker) {
              setOpenClawPickerDismissed(true)
            } else {
              setMessageInput('')
            }
            return true
          }
          if ((isPlainEnter || isTabComplete) && activePickerItems.length > 0) {
            const item = activePickerItems[pickIndex(presetHighlightIndex, activePickerItems.length)]
            if (item) {
              consume()
              runOnce(() => {
                if (showOpenClawCommandPicker) {
                  handleOpenClawCommandSelect(item as GatewayCommandInfo)
                } else {
                  void handlePresetSelect((item as { id: string }).id)
                }
              })
              return true
            }
          }
          if (isTabComplete) {
            consume()
            return true
          }
        }

        return false
      },
      [
        agentHighlightIndex,
        commandHighlightIndex,
        credentialHighlightIndex,
        filteredAgents,
        filteredCommandItems,
        filteredCredentials,
        filteredMemoryMentions,
        filteredOpenClawCommands,
        filteredPresets,
        filteredSkills,
        handleAgentSelect,
        handleCommandPickerItem,
        handleCredentialSelect,
        handleMemoryMentionSelect,
        handleOpenClawCommandSelect,
        handlePresetSelect,
        handleSkillSelect,
        memoryMentionHighlightIndex,
        pickIndex,
        presetHighlightIndex,
        setMessageInput,
        showAgentPicker,
        showCommandPicker,
        showCredentialPicker,
        showMemoryMentionPicker,
        showOpenClawCommandPicker,
        showPresetPicker,
        showSkillPicker,
        skillHighlightIndex,
      ]
    )

    // Native capture: Tab can leave the textarea before React's bubble handler runs in some webviews
    useEffect(() => {
      const anyPicker =
        showCommandPicker ||
        showAgentPicker ||
        showSkillPicker ||
        showCredentialPicker ||
        showMemoryMentionPicker ||
        showPresetPicker ||
        showOpenClawCommandPicker
      if (!anyPicker) return

      const onNativeKeyDown = (event: KeyboardEvent) => {
        const target = event.target as HTMLElement | null
        const inputEl =
          richInputRef.current?.getElement() || (document.getElementById(dom.messageInputID) as HTMLElement | null)
        // Only when focus is the composer (or body after a stolen tab)
        if (target !== inputEl && target !== document.body && !(inputEl && inputEl.contains(target))) {
          // Still handle Tab if a picker is open and focus somehow left the field
          if (event.key !== 'Tab') return
        }
        const consumed = handlePickerKeyDown(event)
        if (consumed && inputEl && document.activeElement !== inputEl) {
          inputEl.focus()
        }
      }

      window.addEventListener('keydown', onNativeKeyDown, true)
      return () => window.removeEventListener('keydown', onNativeKeyDown, true)
    }, [
      handlePickerKeyDown,
      showAgentPicker,
      showCommandPicker,
      showCredentialPicker,
      showMemoryMentionPicker,
      showOpenClawCommandPicker,
      showPresetPicker,
      showSkillPicker,
    ])

    handleSubmitRef.current = handleSubmit

    useEffect(() => {
      const pending = pendingVoiceSubmitRef.current
      if (!pending) return
      if (messageInput !== pending) return
      if (preConstructedMessage.text !== pending) return
      pendingVoiceSubmitRef.current = null
      void handleSubmitRef.current()
    }, [messageInput, preConstructedMessage.text])

    useEffect(() => {
      if (generating) {
        voiceSawGeneratingRef.current = true
        return
      }
      if (!pendingVoiceTtsRef.current || !voiceSawGeneratingRef.current) return
      pendingVoiceTtsRef.current = false
      voiceSawGeneratingRef.current = false
      const voice = mergeVoiceConfig(settingsStore.getState().extension?.voiceCopilot)
      if (voice.ttsProvider === 'off') return
      const replyText = lastAssistantText(currentSession)
      if (!replyText) return
      void synthesizeSpeech({
        text: replyText,
        config: voice,
        auth: voiceAuthFromSettings(),
      })
        .then(playSpeechBytes)
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          toastActions.add(message || t('Could not speak reply'))
        })
    }, [generating, currentSession, t])

    const onVoiceTranscript = (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) {
        toastActions.add(t('Empty transcript'))
        return
      }
      const current = messageInputRef.current.trim()
      const next = current ? `${current} ${trimmed}` : trimmed
      pendingVoiceSubmitRef.current = next
      pendingVoiceTtsRef.current = voiceCopilot.ttsProvider !== 'off'
      setMessageInput(next)
    }

    const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement | HTMLTextAreaElement>) => {
      if (handlePickerKeyDown(event)) {
        return
      }

      // Prefer event.key (contenteditable / WebView often has keyCode 0)
      const isEnter = event.key === 'Enter' || event.keyCode === 13
      const isPressedHash: Record<ShortcutSendValue, boolean> = {
        '': false,
        Enter: isEnter && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey,
        'CommandOrControl+Enter': isEnter && (event.ctrlKey || event.metaKey) && !event.shiftKey,
        'Ctrl+Enter': isEnter && event.ctrlKey && !event.shiftKey,
        'Command+Enter': isEnter && event.metaKey,
        'Shift+Enter': isEnter && event.shiftKey,
        'Ctrl+Shift+Enter': isEnter && event.ctrlKey && event.shiftKey,
      }

      // Alt/Option+Enter always inserts a newline (does not send)
      if (isEnter && event.altKey && !event.ctrlKey && !event.metaKey) {
        return
      }

      // (legacy comment removed)
      if (isPressedHash[shortcuts.inputBoxSendMessage]) {
        if (platform.formFactor === 'mobile' && isSmallScreen && shortcuts.inputBoxSendMessage === 'Enter') {
          // (legacy comment removed)
          return
        }
        event.preventDefault()
        handleSubmit()
        return
      }

      // (legacy comment removed)
      if (isPressedHash[shortcuts.inputBoxSendMessageWithoutResponse]) {
        event.preventDefault()
        handleSubmit(false)
        return
      }

      // (legacy comment removed)
      const editorEl = richInputRef.current?.getElement()
      if (
        (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
        editorEl &&
        editorEl === document.activeElement &&
        (messageInput.length === 0 || window.getSelection()?.toString() === messageInput)
      ) {
        event.preventDefault()
        if (event.key === 'ArrowUp') {
          const previousInput = getPreviousHistoryInput()
          if (previousInput !== undefined) {
            setMessageInput(previousInput)
            setTimeout(() => richInputRef.current?.setCursorToEnd(), 10)
          }
        } else if (event.key === 'ArrowDown') {
          const nextInput = getNextHistoryInput()
          if (nextInput !== undefined) {
            setMessageInput(nextInput)
            setTimeout(() => richInputRef.current?.setCursorToEnd(), 10)
          }
        }
      }
    }

    const startNewThread = () => {
      const res = onStartNewThread?.()
      if (res) {
        setShowRollbackThreadButton(true)
      }
    }

    const rollbackThread = () => {
      const res = onRollbackThread?.()
      if (res) {
        setShowRollbackThreadButton(false)
      }
    }

    // ----- Preprocessing helpers -----
    const startLinkPreprocessing = (url: string) => {
      // (legacy comment removed)
      setPreConstructedMessage((prev) => markLinkProcessing(prev, url))

      // ， error， Promise.all reject
      const preprocessPromise = sessionHelpers
        .preprocessLink(url, { provider: model?.provider || '', modelId: model?.modelId || '' })
        .then((preprocessedLink) => {
          setPreConstructedMessage((prev) => onLinkProcessed(prev, url, preprocessedLink, 6))
        })
        .catch((error) => {
          setPreConstructedMessage((prev) =>
            onLinkProcessed(
              prev,
              url,
              {
                url,
                title: '',
                content: '',
                storageKey: '',
                error: (error as Error)?.message || 'Failed to preprocess the link.',
              },
              6
            )
          )
        })

      // Store the promise
      setPreConstructedMessage((prev) => storeLinkPromise(prev, url, preprocessPromise))
    }

    const startFilePreprocessing = (file: File) => {
      // ， error， Promise.all reject
      return sessionHelpers
        .preprocessFile(file, { provider: model?.provider || '', modelId: model?.modelId || '' })
        .then((preprocessedFile) => {
          setPreConstructedMessage((prev) => onFileProcessed(prev, file, preprocessedFile, 20))
        })
        .catch((error) => {
          setPreConstructedMessage((prev) =>
            onFileProcessed(
              prev,
              file,
              {
                file,
                content: '',
                storageKey: '',
                error: (error as Error)?.message || 'Failed to preprocess the file.',
              },
              20
            )
          )
        })
    }

    const insertLinks = (urls: string[]) => {
      let newLinks = [...(links || []), ...urls.map((u) => ({ url: u }))]
      newLinks = _.uniqBy(newLinks, 'url')
      newLinks = newLinks.slice(-6) // 6
      setLinks(newLinks)

      // (legacy comment removed)
      for (let i = 0; i < Math.min(urls.length, 6); i++) {
        const url = urls[i]
        const linkIndex = newLinks.findIndex((l) => l.url === url)

        if (linkIndex < 6) {
          startLinkPreprocessing(url)
        }
      }
    }

    const toastUnsupportedFile = useCallback(
      (fileName: string) => {
        const key = getUnsupportedFileI18nKey(fileName)
        toastActions.add(t(key, { fileName }))
      },
      [t]
    )

    const insertFiles = async (files: File[]) => {
      const videoLimits = getVideoLimits(platform.formFactor === 'desktop' ? 'desktop' : 'mobile')

      for (const file of files) {
        // Vision lane: AI-readable images (canvas resize). Advanced formats toast and skip.
        if (file.type.startsWith('image/') || isAiReadableImageFile(file)) {
          if (!isAiReadableImageFile(file)) {
            toastUnsupportedFile(file.name)
            continue
          }
          try {
            const base64 = await picUtils.getImageBase64AndResize(file)
            const fingerprint = imagePayloadFingerprint(base64)
            const now = Date.now()
            // Drop fingerprints older than 8s so intentional re-paste still works.
            for (const [fp, ts] of recentImageFingerprintsRef.current) {
              if (now - ts > 8000) recentImageFingerprintsRef.current.delete(fp)
            }
            if (recentImageFingerprintsRef.current.has(fingerprint)) {
              continue
            }
            recentImageFingerprintsRef.current.set(fingerprint, now)

            const key = StorageKeyGenerator.picture('input-box')
            await storage.setBlob(key, base64)
            setPreConstructedMessage((prev) => ({
              ...prev,
              pictureKeys: [...(prev.pictureKeys || []), key].slice(-8),
            })) // Maximum 8 images
          } catch {
            toastUnsupportedFile(file.name)
          }
          continue
        }

        // Video lane: mp4/webm → store blob + poster; frames sampled on send if vision
        if (file.type.startsWith('video/') || isAiReadableVideoFile(file)) {
          if (!isAiReadableVideoFile(file)) {
            toastUnsupportedFile(file.name)
            continue
          }
          if (file.size > videoLimits.maxFileBytes) {
            toastActions.add(
              t('Video is too large. Maximum size is {{max}}.', {
                max: formatBytesForDisplay(videoLimits.maxFileBytes),
              })
            )
            continue
          }

          setPreConstructedMessage((prev) => {
            const existingVideos = (prev.preprocessedFiles || []).filter((f) => f.mediaKind === 'video' && !f.error)
            const attachmentCount = prev.attachments.filter((a) => isAiReadableVideoFile(a)).length
            if (
              existingVideos.length >= videoLimits.maxVideosPerMessage ||
              attachmentCount >= videoLimits.maxVideosPerMessage
            ) {
              toastActions.add(
                t('You can attach at most {{count}} video(s) per message.', {
                  count: videoLimits.maxVideosPerMessage,
                })
              )
              return prev
            }

            const newAttachments = prev.attachments.find(
              (f) => StorageKeyGenerator.fileUniqKey(f) === StorageKeyGenerator.fileUniqKey(file)
            )
              ? prev.attachments
              : [...(prev.attachments || []), file]

            const preprocessPromise = sessionHelpers
              .preprocessVideo(file, {
                formFactor: platform.formFactor === 'desktop' ? 'desktop' : 'mobile',
              })
              .then((preprocessedFile) => {
                if (preprocessedFile.error?.startsWith('video_too_long:')) {
                  const mins = preprocessedFile.error.split(':')[1]
                  toastActions.add(t('Video is too long. Maximum duration is {{minutes}} minutes.', { minutes: mins }))
                } else if (preprocessedFile.error?.startsWith('video_too_large:')) {
                  toastActions.add(
                    t('Video is too large. Maximum size is {{max}}.', {
                      max: preprocessedFile.error.split(':')[1],
                    })
                  )
                } else if (preprocessedFile.error) {
                  toastActions.add(t('Failed to process video. Use MP4 or WebM.'))
                }
                setPreConstructedMessage((p) => onFileProcessed(p, file, preprocessedFile, 20))
              })
              .catch(() => {
                toastActions.add(t('Failed to process video. Use MP4 or WebM.'))
                setPreConstructedMessage((p) =>
                  onFileProcessed(
                    p,
                    file,
                    {
                      file,
                      content: '',
                      storageKey: '',
                      mediaKind: 'video',
                      error: 'Failed to process video',
                    },
                    20
                  )
                )
              })

            return {
              ...storeFilePromise(markFileProcessing(prev, file), file, preprocessPromise),
              attachments: newAttachments,
            }
          })
          continue
        }

        // Document / text lane
        if (!isSupportedFile(file.name)) {
          toastUnsupportedFile(file.name)
          continue
        }
        setPreConstructedMessage((prev) => {
          const newAttachments = prev.attachments.find(
            (f) => StorageKeyGenerator.fileUniqKey(f) === StorageKeyGenerator.fileUniqKey(file)
          )
            ? prev.attachments
            : [...(prev.attachments || []), file].slice(-20) // Maximum 20 attachments

          // Only preprocess first 20 files to avoid wasting resources
          const fileIndex = newAttachments.findIndex(
            (f) => f.name === file.name && f.lastModified === file.lastModified
          )
          if (fileIndex < 20) {
            const preprocessPromise = startFilePreprocessing(file)
            return {
              ...storeFilePromise(markFileProcessing(prev, file), file, preprocessPromise),
              attachments: newAttachments,
            }
          }

          return {
            ...prev,
            attachments: newAttachments,
          }
        })
      }
    }

    const insertFilesRef = useRef(insertFiles)
    insertFilesRef.current = insertFiles

    // Window-level file DnD so drops work over the whole chat (not only the composer shell).
    // Tauri must set dragDropEnabled:false so HTML5 File events reach the webview.
    const [isFileDragActive, setIsFileDragActive] = useState(false)
    useEffect(() => {
      if (sessionType === 'picture') {
        return
      }

      let dragDepth = 0

      const isFileDrag = (event: DragEvent) => {
        const types = event.dataTransfer?.types
        if (!types) {
          return false
        }
        return Array.from(types).includes('Files')
      }

      const clearFileDrag = () => {
        dragDepth = 0
        setIsFileDragActive(false)
      }

      const onDragEnter = (event: DragEvent) => {
        if (!isFileDrag(event)) {
          return
        }
        event.preventDefault()
        dragDepth += 1
        setIsFileDragActive(true)
      }

      const onDragLeave = (event: DragEvent) => {
        if (!isFileDrag(event)) {
          return
        }
        // Leaving the window (relatedTarget null) always clears — dragDepth alone
        // gets stuck when OS cancels a drag without matching leave events.
        const leavingWindow = event.relatedTarget === null
        if (leavingWindow) {
          clearFileDrag()
          return
        }
        dragDepth = Math.max(0, dragDepth - 1)
        if (dragDepth === 0) {
          setIsFileDragActive(false)
        }
      }

      const onDragOver = (event: DragEvent) => {
        if (!isFileDrag(event)) {
          return
        }
        // Required so the browser allows drop instead of navigating away
        event.preventDefault()
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = 'copy'
        }
      }

      const onDrop = (event: DragEvent) => {
        if (!isFileDrag(event)) {
          return
        }
        event.preventDefault()
        event.stopPropagation()
        clearFileDrag()
        const files = Array.from(event.dataTransfer?.files ?? [])
        if (files.length > 0) {
          void insertFilesRef.current(files)
        }
      }

      // Esc / cancelled OS drag / focus loss must never leave the overlay stuck on.
      const onDragEnd = () => clearFileDrag()
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') clearFileDrag()
      }
      const onWindowBlur = () => clearFileDrag()

      window.addEventListener('dragenter', onDragEnter)
      window.addEventListener('dragleave', onDragLeave)
      window.addEventListener('dragover', onDragOver)
      window.addEventListener('drop', onDrop)
      window.addEventListener('dragend', onDragEnd)
      window.addEventListener('keydown', onKeyDown)
      window.addEventListener('blur', onWindowBlur)
      return () => {
        window.removeEventListener('dragenter', onDragEnter)
        window.removeEventListener('dragleave', onDragLeave)
        window.removeEventListener('dragover', onDragOver)
        window.removeEventListener('drop', onDrop)
        window.removeEventListener('dragend', onDragEnd)
        window.removeEventListener('keydown', onKeyDown)
        window.removeEventListener('blur', onWindowBlur)
      }
    }, [sessionType])

    const onFileInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
      if (!event.target.files) {
        return
      }
      insertFiles(Array.from(event.target.files))
      event.target.value = ''
      dom.focusMessageInput()
    }

    const onImageUploadClick = () => {
      pictureInputRef.current?.click()
    }
    const onFileUploadClick = () => {
      fileInputRef.current?.click()
    }

    const onImageDeleteClick = async (picKey: string) => {
      setPreConstructedMessage((prev) => ({
        ...prev,
        pictureKeys: (prev.pictureKeys || []).filter((k) => k !== picKey),
      }))
      // (legacy comment)
      // await storage.delBlob(picKey)
    }

    const onPaste = (
      event: React.ClipboardEvent<HTMLDivElement | HTMLTextAreaElement>
    ): void | { insertPlainText?: string | null } => {
      if (sessionType === 'picture') {
        return
      }

      const data = event.clipboardData
      if (!data) return

      const decision = decideClipboardPaste(data, {
        pasteLongTextAsAFile,
        longTextThreshold: 3000,
      })
      const nonImageFiles = extractClipboardNonImageFiles(data)
      const plain = decision.plainText ?? ''
      const trimmed = plain.trim()
      const isLongText = pasteLongTextAsAFile && trimmed.length > 3000
      const isUrlPaste =
        !decision.hasImages && !isLongText && (trimmed.startsWith('http://') || trimmed.startsWith('https://'))

      if (!decision.shouldPreventDefault && nonImageFiles.length === 0) {
        return
      }

      // Own the paste: block native rich HTML / duplicate file insertion.
      event.preventDefault()

      const now = Date.now()
      const isRapidReplay = now - lastPasteAtRef.current < 350
      lastPasteAtRef.current = now

      // Double-fired paste: skip re-attaching the same files.
      if (isRapidReplay && (decision.hasImages || nonImageFiles.length > 0 || isLongText)) {
        if (!isLongText && !isUrlPaste && plain && !decision.hasImages) {
          return { insertPlainText: plain }
        }
        return { insertPlainText: null }
      }

      const filesToInsert: File[] = [...decision.images, ...nonImageFiles]

      if (isLongText) {
        filesToInsert.push(
          new File([plain], `pasted_text_${attachments?.length || 0}.txt`, {
            type: 'text/plain',
          })
        )
      }

      if (filesToInsert.length > 0) {
        void insertFiles(filesToInsert)
      }

      if (isUrlPaste) {
        const urls = trimmed
          .split(/\s+/)
          .map((url) => url.trim())
          .filter((url) => url.startsWith('http://') || url.startsWith('https://'))
        if (urls.length > 0) {
          insertLinks(urls)
        }
      }

      // Caption / normal text: let ComposerRichInput insert once after preventDefault.
      // Long-text-as-file and pure URL attach paths skip inline insertion.
      if (!isLongText && !isUrlPaste && plain) {
        return { insertPlainText: plain }
      }

      return { insertPlainText: null }
    }

    const handleAttachLink = async () => {
      const links: string[] = await NiceModal.show('attach-link')
      if (links) {
        insertLinks(links)
      }
    }

    // Consume pending quote draft into a single composer chip (no textarea dump)
    const pendingQuoteDraft = useUIStore((state) => state.quoteDraft)
    const setQuoteDraft = useUIStore((state) => state.setQuoteDraft)
    useEffect(() => {
      if (!pendingQuoteDraft?.text?.trim()) {
        return
      }
      setLocalQuoteDraft(pendingQuoteDraft)
      setQuoteDraft(null)
      dom.focusMessageInput()
      dom.setMessageInputCursorToEnd()
    }, [pendingQuoteDraft, setQuoteDraft])

    const handleKnowledgeBaseSelect = useCallback(
      (kb: KnowledgeBase | null) => {
        if (!kb || kb.id === knowledgeBase?.id) {
          setKnowledgeBase(undefined)
          trackEvent('knowledge_base_disabled', { knowledge_base_name: knowledgeBase?.name })
        } else {
          setKnowledgeBase(pick(kb, 'id', 'name'))
          trackEvent('knowledge_base_enabled', { knowledge_base_name: kb.name })
        }
      },
      [knowledgeBase, setKnowledgeBase]
    )

    // Show deprecated notice for legacy picture sessions
    if (sessionType === 'picture') {
      return (
        <Box id={dom.InputBoxID} className="chat-input-shell">
          <Stack
            className={cn('composer-card', widthFull ? 'chat-col-full' : 'chat-col')}
            gap="xs"
            p="md"
            align="center"
          >
            <Text size="sm" c="chatbox-tertiary" ta="center">
              {t('This image session is no longer active. Please use the new Image Creator for image generation.')}
            </Text>
            <Button variant="light" size="xs" onClick={() => navigate({ to: '/image-creator' })}>
              {t('Go to Image Creator')}
            </Button>
          </Stack>
        </Box>
      )
    }

    const roomMode: 'discuss' | 'work' | 'swarm' = isNewSession
      ? draftRoomMode === 'work' || draftRoomMode === 'swarm'
        ? draftRoomMode
        : 'discuss'
      : currentSession?.roomMode === 'work' || currentSession?.roomMode === 'swarm'
        ? currentSession.roomMode
        : 'discuss'
    const showRoomModeChip = roomAgentIds.length >= 2 || draftMentionedAgentIds.length >= 2

    return (
      <Box id={dom.InputBoxID} className="chat-input-shell">
        <Stack className={cn(widthFull ? 'chat-col-full' : 'chat-col')} gap="xs">
          {currentSessionId && <CompactionStatus sessionId={currentSessionId} />}
          {currentSessionId && <QueuedMessageList sessionId={currentSessionId} />}
          {currentSessionId ? <TeamRoomActions sessionId={currentSessionId} /> : null}
          <Stack
            ref={composerCardRef}
            className={cn(
              'composer-card relative justify-between',
              isFileDragActive && 'composer-card-drag-active',
              (showCommandPicker ||
                showSkillPicker ||
                showCredentialPicker ||
                showMemoryMentionPicker ||
                showAgentPicker ||
                showPresetPicker ||
                showOpenClawCommandPicker) &&
                'composer-card-picker-open'
            )}
            gap={0}
          >
            <div
              className={cn('composer-drop-overlay', isFileDragActive && 'is-active')}
              aria-hidden={!isFileDragActive}
            >
              <div className="composer-drop-overlay-content">
                <IconFolder className="composer-drop-overlay-icon" strokeWidth={1.5} size={28} />
                <span className="composer-drop-overlay-title">{t('Drop to attach')}</span>
                <span className="composer-drop-overlay-hint">{t('Images · video · PDFs · text · code')}</span>
                <span className="composer-drop-overlay-limits font-mono tabular-nums">
                  {t('MP4 · WebM · max {{minutes}} min · {{size}}', videoDropLimitsHint)}
                </span>
              </div>
            </div>
            {showPresetPicker && (
              <PresetPicker
                anchorRef={composerCardRef}
                highlightedIndex={presetHighlightIndex}
                onHighlightChange={setPresetHighlightIndex}
                onManage={() => navigateToSettings('/chat')}
                onSelect={(preset) => {
                  void handlePresetSelect(preset.id)
                }}
                presets={promptPresets}
                query={presetQuery}
              />
            )}
            {showOpenClawCommandPicker && (
              <OpenClawCommandPicker
                anchorRef={composerCardRef}
                commands={openClawCommands}
                highlightedIndex={presetHighlightIndex}
                onHighlightChange={setPresetHighlightIndex}
                onSelect={handleOpenClawCommandSelect}
                query={openClawCommandQuery}
              />
            )}
            {showMemoryMentionPicker && (
              <MemoryMentionPicker
                anchorRef={composerCardRef}
                entries={filteredMemoryMentions}
                highlightedIndex={memoryMentionHighlightIndex}
                onHighlightChange={setMemoryMentionHighlightIndex}
                onSelect={handleMemoryMentionSelect}
                ready={memoryReady}
              />
            )}
            {showAgentPicker && (
              <AgentPicker
                anchorRef={composerCardRef}
                agents={allAgents}
                highlightedIndex={agentHighlightIndex}
                onHighlightChange={setAgentHighlightIndex}
                onSelect={handleAgentSelect}
                query={agentAtQuery || ''}
                excludeIds={draftMentionedAgentIds}
              />
            )}
            {showCommandPicker && (
              <CommandPicker
                anchorRef={composerCardRef}
                commands={enabledCommands}
                highlightedIndex={commandHighlightIndex}
                onHighlightChange={setCommandHighlightIndex}
                onSelect={handleCommandSelect}
                onSelectItem={handleCommandPickerItem}
                query={commandSlashQuery || ''}
                excludeIds={selectedCommands.map((c) => c.id)}
                includeSystem
              />
            )}
            {showSkillPicker && (
              <SkillPicker
                anchorRef={composerCardRef}
                skills={enabledSkills}
                highlightedIndex={skillHighlightIndex}
                onHighlightChange={setSkillHighlightIndex}
                onSelect={handleSkillSelect}
                query={skillDollarQuery || ''}
                excludeIds={draftMentionedSkillIds}
              />
            )}
            {showCredentialPicker && (
              <CredentialPicker
                anchorRef={composerCardRef}
                accounts={integrationAccounts}
                highlightedIndex={credentialHighlightIndex}
                onHighlightChange={setCredentialHighlightIndex}
                onSelect={handleCredentialSelect}
                query={credentialHashQuery || ''}
                excludeIds={draftMentionedCredentialIds}
              />
            )}

            {/*
              Mentions live in the message body (Slack-style @ $ # @mem:).
              Only session room membership, memory payload chips, and quotes stay above.
            */}
            {(roomAgentIds.length > 0 ||
              selectedCommands.length > 0 ||
              memoryAttachments.length > 0 ||
              !!quoteDraft) && (
              <div className="composer-meta-stack">
                {roomAgentIds.length > 0 ? (
                  <AgentRoomStrip
                    agentIds={roomAgentIds}
                    sessionId={isNewSession ? undefined : sessionId}
                    embedded
                    onRemove={
                      isNewSession ? (onDraftAgentIdsChange ? handleRemoveRoomAgent : undefined) : handleRemoveRoomAgent
                    }
                  />
                ) : null}

                {selectedCommands.length > 0 ? (
                  <div className="composer-meta-row">
                    {selectedCommands.map((command) => (
                      <span key={command.id} className="composer-skill-chip">
                        <span className="composer-skill-chip-sigil" aria-hidden>
                          /
                        </span>
                        <span>{command.name}</span>
                        <button
                          type="button"
                          className="composer-skill-chip-remove"
                          aria-label={t('Remove command')}
                          onClick={() => setSelectedCommands((prev) => prev.filter((c) => c.id !== command.id))}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                ) : null}

                {memoryAttachments.length > 0 ? (
                  <div className="composer-meta-row">
                    {memoryAttachments.map((attachment) => (
                      <Tooltip
                        key={attachment.id}
                        label={attachment.content}
                        multiline
                        w={320}
                        withArrow
                        openDelay={250}
                      >
                        <span className="composer-skill-chip">
                          <IconBrain size={14} stroke={1.8} aria-hidden />
                          <span>{attachment.tags[0] || t('Memory')}</span>
                          {attachment.tags.length > 1 && <span>+{attachment.tags.length - 1}</span>}
                          <UnstyledButton
                            className="composer-skill-chip-remove"
                            aria-label={t('Remove memory')}
                            onClick={(event) => {
                              event.stopPropagation()
                              removeMemoryAttachment(attachment.id)
                            }}
                          >
                            <IconX size={12} stroke={2} />
                          </UnstyledButton>
                        </span>
                      </Tooltip>
                    ))}
                  </div>
                ) : null}

                {quoteDraft ? (
                  <div className="composer-meta-row">
                    <QuoteChip quote={quoteDraft} onRemove={() => setLocalQuoteDraft(null)} />
                  </div>
                ) : null}
              </div>
            )}

            {/* Slack-style rich composer: real inline chips for @ $ # @mem */}
            <ComposerRichInput
              ref={richInputRef}
              id={dom.messageInputID}
              className="px-4 pt-3.5 pb-2"
              value={messageInput}
              onChange={(serialized) => {
                setMessageInput(serialized)
                setCommandPickerDismissed(false)
                setSkillPickerDismissed(false)
                setAgentPickerDismissed(false)
                setMemoryMentionPickerDismissed(false)
                resetHistoryIndex()
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              placeholder={t('Write a message…') || 'Write a message…'}
              disabled={isCompactionRunning}
              autoFocus={!isSmallScreen}
              minRows={2}
              maxRows={Math.max(4, Math.floor(viewportHeight / 100))}
              resolveToken={resolveComposerToken}
            />

            {(!!pictureKeys.length || !!attachments.length || !!links.length) && (
              <Flex align="center" wrap="wrap" px="sm" pb="xs" onClick={() => dom.focusMessageInput()}>
                {pictureKeys?.map((picKey, picIndex) => (
                  <ImageMiniCard
                    key={picKey}
                    storageKey={picKey}
                    staggerIndex={picIndex}
                    onDelete={() => onImageDeleteClick(picKey)}
                  />
                ))}
                {attachments?.map((file, fileIndex) => {
                  const fileKey = StorageKeyGenerator.fileUniqKey(file)
                  const status = preConstructedMessage.preprocessingStatus.files[fileKey]
                  const preprocessedFile = preConstructedMessage.preprocessedFiles.find(
                    (f) => StorageKeyGenerator.fileUniqKey(f.file) === fileKey
                  )
                  const pictureOffset = pictureKeys?.length || 0
                  return (
                    <FileMiniCard
                      key={fileKey}
                      name={file.name}
                      fileType={file.type}
                      status={status}
                      errorMessage={preprocessedFile?.error}
                      mediaKind={preprocessedFile?.mediaKind}
                      posterStorageKey={preprocessedFile?.posterStorageKey}
                      videoStorageKey={
                        preprocessedFile?.mediaKind === 'video' && preprocessedFile.storageKey
                          ? preprocessedFile.storageKey
                          : undefined
                      }
                      durationSec={preprocessedFile?.durationSec}
                      byteLength={preprocessedFile?.byteLength ?? file.size}
                      staggerIndex={pictureOffset + fileIndex}
                      durationLabel={
                        preprocessedFile?.mediaKind === 'video' && preprocessedFile.durationSec !== undefined
                          ? formatDurationForDisplay(preprocessedFile.durationSec)
                          : undefined
                      }
                      onErrorClick={() => {
                        if (preprocessedFile?.error) {
                          void NiceModal.show('file-parse-error', {
                            errorCode: preprocessedFile.error,
                            fileName: file.name,
                          })
                        }
                      }}
                      onDelete={() => {
                        // Cancel any ongoing MinerU parsing for this file
                        if (file.path && platform.cancelMineruParse) {
                          platform.cancelMineruParse(file.path).catch(() => {
                            // Ignore cancellation errors
                          })
                        }
                        setPreConstructedMessage((prev) => ({
                          ...cleanupFile(prev, file),
                          attachments: (prev.attachments || []).filter(
                            (f) => StorageKeyGenerator.fileUniqKey(f) !== fileKey
                          ),
                        }))
                      }}
                    />
                  )
                })}
                {(isSamplingVideoFrames || showNonVisionVideoBanner) && (
                  <div className="flex w-full basis-full flex-col gap-1.5 px-1 pb-1 pt-0.5">
                    {isSamplingVideoFrames && (
                      <div
                        className="flex items-center gap-1.5 text-[11px] text-[var(--chatbox-tint-tertiary)]"
                        role="status"
                        aria-live="polite"
                      >
                        <IconLoader2
                          size={13}
                          className="animate-spin shrink-0 text-[var(--chatbox-tint-brand)]"
                          stroke={1.75}
                        />
                        <span className="truncate">{t('Sampling video frames…')}</span>
                      </div>
                    )}
                    {showNonVisionVideoBanner && !isSamplingVideoFrames && (
                      <div className="composer-video-vision-banner flex items-start gap-1.5 rounded-md px-2 py-1.5">
                        <IconAlertCircle
                          size={14}
                          className="mt-0.5 shrink-0 text-[var(--chatbox-tint-tertiary)]"
                          stroke={1.75}
                        />
                        <p className="m-0 min-w-0 flex-1 text-[11px] leading-snug text-[var(--chatbox-tint-tertiary)]">
                          {t("This model can't see video frames. Switch to a vision model to analyze them.")}
                        </p>
                        <button
                          type="button"
                          className="shrink-0 rounded px-1 text-[10px] text-[var(--chatbox-tint-tertiary)] transition-opacity duration-150 hover:text-[var(--chatbox-tint-secondary)] active:scale-[0.96]"
                          onClick={(e) => {
                            e.stopPropagation()
                            setVisionBannerDismissed(true)
                          }}
                        >
                          {t('Dismiss')}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                {links?.map((link, linkIndex) => {
                  const linkKey = StorageKeyGenerator.linkUniqKey(link.url)
                  const status = preConstructedMessage.preprocessingStatus.links[linkKey]
                  const preprocessedLink = preConstructedMessage.preprocessedLinks.find(
                    (l) => StorageKeyGenerator.linkUniqKey(l.url) === linkKey
                  )
                  const attachOffset = (pictureKeys?.length || 0) + (attachments?.length || 0)
                  return (
                    <LinkMiniCard
                      key={linkKey}
                      url={link.url}
                      status={status}
                      staggerIndex={attachOffset + linkIndex}
                      title={preprocessedLink?.title}
                      imageStorageKey={preprocessedLink?.imageStorageKey}
                      errorMessage={preprocessedLink?.error}
                      onErrorClick={() => {
                        if (preprocessedLink?.error) {
                          void NiceModal.show('file-parse-error', {
                            errorCode: preprocessedLink.error,
                            fileName: link.url,
                          })
                        }
                      }}
                      onDelete={() => {
                        setLinks(links.filter((l) => l.url !== link.url))
                        setPreConstructedMessage((prev) => cleanupLink(prev, link.url))
                      }}
                    />
                  )
                })}
              </Flex>
            )}

            {showWorkspaceHint && (
              <div className="flex items-start gap-1.5 px-3 pb-1.5 pt-0">
                <IconFolder size={14} className="mt-0.5 shrink-0 text-[var(--chatbox-tint-tertiary)]" stroke={1.75} />
                <p className="m-0 min-w-0 flex-1 text-[11px] leading-snug text-[var(--chatbox-tint-tertiary)]">
                  {t('Set a workspace folder (Tools menu) so Agent can write files and run terminal commands on disk.')}
                </p>
              </div>
            )}

            {platformCapabilities.isMobileLayout && <ModelReadinessNotice readiness={modelReadiness} />}

            {/* Toolbar row — mock .bar (rail bg + send on the right) */}
            <Flex align="center" gap={0} className="composer-bar shrink-0 w-full">
              {/* Hidden file inputs */}
              <ImageUploadInput ref={pictureInputRef} onChange={onFileInputChange} />
              <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                onChange={onFileInputChange}
                multiple
                accept={getFileAcceptString()}
              />

              {/* Left Group: single overflow control (+ Memory on desktop only) */}
              <Flex align="center" gap={0} className="min-w-0 flex-shrink-0 flex-nowrap">
                <ComposerToolsMenu
                  isOpenClawModel={isOpenClawModel}
                  sessionType={sessionType}
                  onImproveWriting={() => {
                    void NiceModal.show('writing-assistant', {
                      initialDraft: messageInput,
                      initialModel: model,
                    })
                  }}
                  webBrowsingMode={webBrowsingMode}
                  webSearchConfigured={webSearchConfigured}
                  onWebBrowsingChange={(enabled) => {
                    setWebBrowsingMode(enabled)
                    dom.focusMessageInput()
                  }}
                  agentMode={agentMode}
                  onToggleAgentMode={toggleAgentMode}
                  workspaceRoot={workspaceRoot}
                  onWorkspaceRootChange={onWorkspaceRootChange}
                  browserArmed={controlledBrowserArmed ?? currentSession?.browserArmed}
                  onBrowserArmedChange={onBrowserArmedChange}
                  browserMasterEnabled={browserMasterEnabled}
                  computerArmed={controlledComputerArmed ?? currentSession?.computerArmed}
                  onComputerArmedChange={onComputerArmedChange}
                  computerMasterEnabled={computerMasterEnabled}
                  knowledgeBaseId={knowledgeBase?.id}
                  onSelectKnowledgeBase={handleKnowledgeBaseSelect}
                  showRollbackThreadButton={showRollbackThreadButton}
                  onStartNewThread={onStartNewThread ? startNewThread : undefined}
                  onRollbackThread={onRollbackThread ? rollbackThread : undefined}
                  onClickSessionSettings={
                    onClickSessionSettings
                      ? () => {
                          void onClickSessionSettings()
                        }
                      : undefined
                  }
                  onShareRoomPack={
                    currentSession?.agentIds && currentSession.agentIds.length > 0
                      ? () => {
                          void exportRoomPack(
                            currentSession,
                            myAgents,
                            (currentSession.pinnedSkillIds || []).map((id) => ({ id, name: id }))
                          ).catch((error) => {
                            console.error('Share room pack failed:', error)
                          })
                        }
                      : undefined
                  }
                  onImageUploadClick={onImageUploadClick}
                  onFileUploadClick={onFileUploadClick}
                  onAttachLink={handleAttachLink}
                  toolbarButtonClass={toolbarButtonClass}
                  toolbarIconSize={toolbarIconSize}
                  memorySlot={({ closeTools }) => (
                    <MemoryDockPopover
                      forceModal
                      onOpen={closeTools}
                      label={t('Memory')}
                      on
                      title={
                        currentSession?.settings?.memoryAutoSave === false
                          ? t('Memory · auto-save off for this chat')
                          : t('Search and save memory')
                      }
                      trigger={
                        <UnstyledButton
                          className={cn(
                            'composer-tools-memory-trigger',
                            'flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm',
                            'hover:bg-[var(--chatbox-background-tertiary)] active:scale-[0.99] transition-transform',
                            currentSession?.settings?.memoryAutoSave === false && 'opacity-80'
                          )}
                          aria-label={t('Memory')}
                        >
                          <IconBrain size={16} stroke={1.5} />
                          <span className="flex-1">{t('Memory')}</span>
                          {currentSession?.settings?.memoryAutoSave === false ? (
                            <span className="text-[11px] text-[var(--chatbox-tint-tertiary)]">{t('off')}</span>
                          ) : null}
                        </UnstyledButton>
                      }
                      onInsertMemory={insertMemory}
                      getMemorySaveContent={getMemorySaveContent}
                      memoryAutoSave={currentSession?.settings?.memoryAutoSave}
                      onMemoryAutoSaveChange={
                        !isNewSession && currentSessionId ? handleMemoryAutoSaveChange : undefined
                      }
                      memoryAutoSaveDisabled={isNewSession || !currentSessionId}
                    />
                  )}
                />
                {onScopeChange ? <ScopePill scopes={scopes} value={scopeId} onChange={onScopeChange} /> : null}
              </Flex>

              {/* Right Group: Team mode (multi-agent) + Model + Send */}
              <Flex align="center" gap={4} className="min-w-0 flex-1 justify-end flex-nowrap">
                {showRoomModeChip ? (
                  <TeamModeSelect
                    value={roomMode}
                    onChange={(mode) => void handleRoomModeChange(mode)}
                    toolbarButtonClass={toolbarButtonClass}
                    isSmallScreen={isSmallScreen}
                  />
                ) : null}

                {/* Model Selector */}
                <Tooltip
                  label={
                    <Flex align="center" c="white" gap="xxs">
                      <ScalableIcon icon={IconAlertCircle} size={12} className="text-inherit" />
                      <Text span size="xxs" c="white">
                        {t('Please select a model')}
                      </Text>
                    </Flex>
                  }
                  color="dark"
                  opened={showSelectModelErrorTip}
                  withArrow
                >
                  <ModelSelector
                    onSelect={onSelectModel}
                    selectedProviderId={model?.provider}
                    selectedModelId={model?.modelId}
                    position="top-end"
                    transitionProps={{
                      transition: 'fade-up',
                      duration: 200,
                    }}
                  >
                    <UnstyledButton
                      className={cn(
                        toolbarButtonClass,
                        'model-picker-trigger',
                        isSmallScreen && 'px-2.5 mobile-touch-target min-h-11 min-w-0'
                      )}
                      aria-label={t('Select Model')}
                    >
                      {!!model && <ProviderImageIcon size={15} provider={model.provider} />}
                      <Text
                        size="xs"
                        className={cn(
                          'text-[var(--chatbox-tint-secondary)] truncate min-w-0',
                          isSmallScreen ? 'max-w-[7.5rem]' : 'max-w-[148px]'
                        )}
                        style={{ fontSize: '0.75rem', fontWeight: 500, letterSpacing: '-0.015em' }}
                        title={model?.modelId}
                      >
                        {modelSelectorDisplayText}
                      </Text>
                      <IconChevronRight
                        size={11}
                        stroke={1.75}
                        className="text-[var(--chatbox-tint-tertiary)] flex-shrink-0 opacity-75"
                        style={{ transform: 'translateY(0.5px) rotate(90deg)' }}
                      />
                    </UnstyledButton>
                  </ModelSelector>
                </Tooltip>

                {(!isNewSession && currentSessionId && currentSession) || (isNewSession && draftSettings) ? (
                  <ReasoningEffortSelect
                    model={model}
                    settings={isNewSession ? draftSettings : currentSession?.settings}
                    sessionId={isNewSession ? undefined : currentSessionId}
                    compact={isSmallScreen}
                    onSettingsChange={(next) => {
                      if (isNewSession) {
                        onDraftSettingsChange?.(next)
                        return
                      }
                      if (!currentSessionId) return
                      void chatStore.updateSession(currentSessionId, (session) => {
                        if (!session) {
                          throw new Error('Session not found')
                        }
                        return {
                          ...session,
                          settings: {
                            ...session.settings,
                            ...next,
                          },
                        }
                      })
                    }}
                  />
                ) : null}

                <DictateButton
                  enabled={voiceCopilot.enabled}
                  config={voiceCopilot}
                  shortcut={voiceHoldShortcut}
                  toolbarButtonClass={toolbarButtonClass}
                  toolbarIconSize={toolbarIconSize}
                  onTranscript={onVoiceTranscript}
                />

                <Tooltip label={t('Sampling video frames…')} disabled={!isSamplingVideoFrames} withArrow position="top">
                  <ActionIcon
                    disabled={sendDisabled}
                    variant="filled"
                    color={showStop ? 'dark' : 'chatbox-brand'}
                    className={cn(
                      'composer-send shadow-none',
                      showStop && 'is-stop',
                      isSmallScreen && 'mobile-touch-target'
                    )}
                    aria-label={isSamplingVideoFrames ? t('Sampling video frames…') : showStop ? t('Stop') : t('Send')}
                    onClick={showStop ? onStopGenerating : () => handleSubmit()}
                    style={
                      !showStop && sendDisabled
                        ? {
                            backgroundColor: 'var(--chatbox-background-tertiary)',
                            color: 'var(--chatbox-tint-tertiary)',
                            opacity: 1,
                          }
                        : undefined
                    }
                  >
                    {/* Cross-fade send/stop so icon swap does not snap */}
                    <span className="composer-send-icon-slot" aria-hidden>
                      <span
                        className={cn(
                          'composer-send-icon',
                          showStop ? 'is-active' : 'is-exit',
                          isSamplingVideoFrames && 'is-hidden'
                        )}
                      >
                        <ScalableIcon icon={IconPlayerStopFilled} size={14} />
                      </span>
                      <span
                        className={cn(
                          'composer-send-icon',
                          !showStop && isSamplingVideoFrames ? 'is-active' : 'is-exit'
                        )}
                      >
                        <IconLoader2 size={14} className="animate-spin" stroke={1.75} />
                      </span>
                      <span
                        className={cn(
                          'composer-send-icon',
                          !showStop && !isSamplingVideoFrames ? 'is-active' : 'is-exit'
                        )}
                      >
                        <ScalableIcon icon={IconArrowUp} size={14} />
                      </span>
                    </span>
                  </ActionIcon>
                </Tooltip>
              </Flex>
            </Flex>
          </Stack>
        </Stack>
        {currentSession && (
          <CompressionModal
            opened={showCompressionModal}
            onClose={() => setShowCompressionModal(false)}
            session={currentSession}
          />
        )}
      </Box>
    )
  }
)

// Memoize the InputBox component to prevent unnecessary re-renders during streaming
export default memo(InputBox)
