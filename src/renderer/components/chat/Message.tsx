import NiceModal from '@ebay/nice-modal-react'
import {
  ActionIcon,
  type ActionIconProps,
  Flex,
  Image as Img,
  Text,
  Textarea,
  Tooltip as Tooltip1,
} from '@mantine/core'
import {
  createMessage,
  type Message,
  type MessageArtifact as MessageArtifactRecord,
  type MessagePicture,
  type MessageToolCallPart,
  ModelProviderEnum,
  type ProviderModelInfo,
  type SessionType,
} from '@shared/types'
import { getMessageText } from '@shared/utils/message'
import {
  IconArrowDown,
  IconBrain,
  IconCopy,
  IconDotsVertical,
  IconGitBranch,
  IconInfoCircle,
  IconMessageReport,
  IconPencil,
  IconPhoto,
  IconPhotoPlus,
  type IconProps,
  IconQuoteFilled,
  IconReload,
  IconThumbDown,
  IconThumbDownFilled,
  IconThumbUp,
  IconThumbUpFilled,
  IconTrash,
} from '@tabler/icons-react'
import { useQuery } from '@tanstack/react-query'
import clsx from 'clsx'
import { concat, isEqual } from 'lodash'
import type { UIElementData } from 'photoswipe'
import type React from 'react'
import {
  type FC,
  forwardRef,
  lazy,
  type MouseEventHandler,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { Gallery, Item as GalleryItem } from 'react-photoswipe-gallery'
import AgentSpeakerHeader from '@/components/chat/AgentSpeakerHeader'
import InlineMentionsText from '@/components/chat/InlineMentionsText'
import SkillActivationsBar from '@/components/chat/SkillActivationsBar'
import { KnowledgeProposalCard } from '@/components/knowledge'
import Markdown from '@/components/Markdown'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { navigateToSettings } from '@/modals/Settings'
import { copyToClipboard } from '@/packages/navigator'
import {
  contentPartsHaveTaskTools,
  isTaskTrackingTool,
  snapshotTasksFromContentParts,
} from '@/packages/tools/task-tools'
import platform from '@/platform'
import { router } from '@/router'
import storage from '@/storage'
import { peekSession } from '@/stores/chatStore'
import { branchChatFromMessage } from '@/stores/session/branch'
import { editAndResend } from '@/stores/session/edit-resend'
import { turnAbilityNeeds } from '@/stores/session/redo-needs'
import { getLiveGenerationStartedAt } from '@/stores/session/session-live-generation'
import { useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import {
  contentPartsRevision,
  groupAssistantContentParts,
  hasVisibleAssistantReply,
  shouldShowAssistantPending,
} from '@/utils/message-stream-ui'
import { isNonChatComposerModel } from '@/utils/modelDisplayName'
import { type ModelNeeds, modelMeetsNeeds } from '@/utils/modelReadiness'
import '../../static/Block.css'
import { type PlanContinueState, planCardState } from '@/packages/plan/planSteps'
import {
  approveAndExecutePlan,
  generateMore,
  modifyMessage,
  regenerateInNewFork,
  rejectPlan,
  removeMessage,
  requestPlanChanges,
  resumeStoppedPlan,
  submitNewUserMessage,
} from '@/stores/sessionActions'
import * as toastActions from '@/stores/toastActions'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import {
  deriveMessageArtifacts,
  getPreviousArtifactVersion,
  MessageArtifact as InlineArtifact,
  isContainRenderableCode,
} from '../Artifact'
import { ScalableIcon } from '../common/ScalableIcon'
import { ThinkingLine } from './ThinkingLine'

// Tool/thinking renderers are agent-only — lazy-load them and skip on Android.
// CHATBOX_BUILD_PLATFORM is a Vite-defined compile-time constant so the
// branch below is dead-code-eliminated on Android (no chunk emitted).
const isAgentEnabled = CHATBOX_BUILD_PLATFORM !== 'android'
const ThinkingGroupUI = isAgentEnabled
  ? lazy(() => import('../message-parts/ThinkingGroupUI').then((m) => ({ default: m.ThinkingGroupUI })))
  : null
const ToolCallPartUI = isAgentEnabled
  ? lazy(() => import('../message-parts/ToolCallPartUI').then((m) => ({ default: m.ToolCallPartUI })))
  : null
const TodoAppCard = isAgentEnabled
  ? lazy(() => import('../message-parts/TodoAppCard').then((m) => ({ default: m.TodoAppCard })))
  : null
const PlanCard = isAgentEnabled ? lazy(() => import('../plan/PlanCard')) : null

import FollowUpSuggestions from '../search/FollowUpSuggestions'
import { SourceCardList } from '../search/SourceCardList'
import { MessageActionRow } from './MessageActionRow'
import { MessageAttachmentGrid } from './MessageAttachmentGrid'
import MessageStatuses from './MessageLoading'
import MessageQuoteBar from './MessageQuoteBar'
import { ModelErrorNotice } from './ModelErrorNotice'
import { saveAsKnowledgeFromMessage } from './save-as-knowledge'
import TextSelectionToolbar from './TextSelectionToolbar'
import { UserMessageEditor } from './UserMessageEditor'

interface Props {
  id?: string
  sessionId: string
  sessionType: SessionType
  msg: Message
  className?: string
  collapseThreshold?: number // ,
  buttonGroup?: 'auto' | 'always' | 'none' // , auto: hover ; always: ; none:
  small?: boolean
  assistantAvatarKey?: string
  sessionPicUrl?: string
  /** First turn in a consecutive team discussion / plan / review run */
  discussionGroupStart?: boolean
  /** When false, suppress follow-up suggestions (only the latest assistant message should show them). */
  showFollowUpSuggestions?: boolean
  /** Whether finished thinking text starts open (settings + scope kind, resolved by MessageList). */
  thinkingDefaultOpen?: boolean
  /** The chat's plans edit files (agent mode with a project or workspace), resolved by MessageList. */
  planTouchesFiles?: boolean
  /** This message holds the chat's latest plan; only that plan's card reads the session's tasks. Default false. */
  latestPlan?: boolean
  /** Whether this message's stopped plan offers Continue, resolved by MessageList. Default hidden. */
  planContinue?: PlanContinueState
}

const _Message: FC<Props> = (props) => {
  const {
    sessionId,
    msg,
    className,
    collapseThreshold,
    buttonGroup = 'auto',
    small,
    assistantAvatarKey: _assistantAvatarKey,
    sessionPicUrl: _sessionPicUrl,
    discussionGroupStart,
    showFollowUpSuggestions = false,
    thinkingDefaultOpen = true,
    planTouchesFiles = false,
    latestPlan = false,
    planContinue = 'hidden',
  } = props

  const { t } = useTranslation()
  const isSamllScreen = useIsSmallScreen()
  const {
    userAvatarKey: _userAvatarKey,
    enableMarkdownRendering,
    enableLaTeXRendering,
    enableMermaidRendering,
    autoPreviewArtifacts,
    autoCollapseCodeBlock,
  } = useSettingsStore((state) => state)

  // Inline expand is manual; autoPreview opens the side workspace instead (Artifacts-style)
  const [previewArtifact, setPreviewArtifact] = useState(false)
  const [selectionToolbar, setSelectionToolbar] = useState<{ text: string; x: number; y: number } | null>(null)
  const [feedbackText, setFeedbackText] = useState(msg.feedback?.text ?? '')

  const isComfyUIReady = useSettingsStore((state) => !!state.providers?.[ModelProviderEnum.ComfyUI]?.comfyuiCheckpoint)

  const messageText = useMemo(() => getMessageText(msg), [msg])

  const contentLength = useMemo(() => {
    return messageText.length
  }, [messageText])

  const needCollapse =
    collapseThreshold &&
    props.sessionType !== 'picture' && // (legacy)
    contentLength > collapseThreshold &&
    contentLength - collapseThreshold > 50 // ，
  const [isCollapsed, setIsCollapsed] = useState(needCollapse)

  const messageContentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setFeedbackText(msg.feedback?.text ?? '')
  }, [msg.feedback?.text, msg.id])

  useEffect(() => {
    if (msg.role !== 'assistant' || msg.generating) {
      return
    }

    let cancelled = false
    void (async () => {
      const previousArtifact = await getPreviousArtifactVersion(sessionId, msg.id)
      const nextArtifacts = deriveMessageArtifacts(messageText, {
        existingArtifacts: msg.artifacts,
        previousArtifact,
      })

      if (cancelled || isEqual(msg.artifacts, nextArtifacts)) {
        return
      }

      await modifyMessage(sessionId, { ...msg, artifacts: nextArtifacts }, false)
    })()

    return () => {
      cancelled = true
    }
  }, [messageText, msg, sessionId])

  const setQuoteDraft = useUIStore((state) => state.setQuoteDraft)

  const quoteMsg = useCallback(() => {
    // Prefer in-message selection when present; otherwise quote full text.
    const selection = window.getSelection()
    const selectedText = selection?.toString().trim() || ''
    let isPartial = false
    let text = getMessageText(msg)

    if (selectedText && selection && selection.rangeCount > 0 && messageContentRef.current) {
      const range = selection.getRangeAt(0)
      const commonAncestor =
        range.commonAncestorContainer.nodeType === Node.TEXT_NODE
          ? range.commonAncestorContainer.parentElement
          : (range.commonAncestorContainer as HTMLElement)
      if (commonAncestor && messageContentRef.current.contains(commonAncestor)) {
        text = selectedText
        isPartial = true
      }
    }

    if (!text.trim()) {
      return
    }

    setQuoteDraft({
      sourceMessageId: msg.id,
      sourceRole: msg.role,
      text,
      isPartial,
    })
  }, [msg, setQuoteDraft])

  const handleStop = useCallback(() => {
    modifyMessage(sessionId, { ...msg, generating: false }, true)
  }, [sessionId, msg])

  const handleRefresh = useCallback(() => {
    handleStop()
    regenerateInNewFork(sessionId, msg)
  }, [handleStop, sessionId, msg])

  const onGenerateMore = useCallback(() => {
    generateMore(sessionId, msg.id)
  }, [sessionId, msg.id])

  const onApprovePlan = useCallback(() => approveAndExecutePlan(sessionId, msg.id), [sessionId, msg.id])

  const onRequestPlanChanges = useCallback(
    (feedback: string) => requestPlanChanges(sessionId, msg.id, feedback),
    [sessionId, msg.id]
  )

  const onRejectPlan = useCallback(() => rejectPlan(sessionId, msg.id), [sessionId, msg.id])

  const onContinuePlan = useCallback(() => resumeStoppedPlan(sessionId, msg.id), [sessionId, msg.id])

  const onCopyMsg = useCallback(() => {
    copyToClipboard(getMessageText(msg, true, false))
    toastActions.add(t('copied to clipboard'), 2000)
  }, [msg, t])

  const handleSendToImageCreator = useCallback(() => {
    void router.navigate({ to: '/image-creator', search: { prompt: messageText } })
  }, [messageText])

  const onStopGeneration = useCallback(() => {
    void import('@/stores/session/stop-generation')
      .then(({ stopSessionGeneration }) => stopSessionGeneration(sessionId, msg))
      .catch((error) => console.error('Failed to stop generation', error))
  }, [sessionId, msg])

  const onReport = useCallback(async () => {
    await NiceModal.show('report-content', { contentId: getMessageText(msg) || msg.id })
  }, [msg])

  const onDelMsg = useCallback(() => {
    removeMessage(sessionId, msg.id)
  }, [msg.id, sessionId])

  // A question is edited in place and sent again (the old answer stays as a branch); an answer keeps the edit modal.
  const [editing, setEditing] = useState(false)
  const onEditClick = useCallback(async () => {
    if (msg.role === 'user') {
      setEditing(true)
      return
    }
    await NiceModal.show('message-edit', { sessionId, msg: msg })
  }, [msg, sessionId])

  const onEditSend = useCallback(
    (text: string) => {
      setEditing(false)
      void editAndResend(sessionId, msg.id, text).catch((error: unknown) => {
        console.error('Edit and resend failed', error)
        toastActions.add(t("Couldn't send that. Try again."))
      })
    },
    [sessionId, msg.id, t]
  )

  const onBranchFromHere = useCallback(() => {
    void branchChatFromMessage(sessionId, msg.id).catch((error: unknown) => {
      console.error('Branch failed', error)
      toastActions.add(t("Couldn't save that. Try again."))
    })
  }, [sessionId, msg.id, t])

  const onSaveAsKnowledge = useCallback(() => saveAsKnowledgeFromMessage(msg, sessionId), [msg, sessionId])

  const clearSelectionToolbar = useCallback(() => {
    setSelectionToolbar(null)
  }, [])

  const quoteSelection = useCallback(() => {
    if (!selectionToolbar?.text?.trim()) {
      return
    }
    setQuoteDraft({
      sourceMessageId: msg.id,
      sourceRole: msg.role,
      text: selectionToolbar.text,
      isPartial: true,
    })
    clearSelectionToolbar()
  }, [clearSelectionToolbar, msg.id, msg.role, selectionToolbar?.text, setQuoteDraft])

  const sendSelectionPrompt = useCallback(
    async (prompt: string) => {
      if (!prompt.trim()) {
        return
      }
      await submitNewUserMessage(sessionId, {
        newUserMsg: createMessage('user', prompt),
        needGenerating: true,
      })
      window.getSelection()?.removeAllRanges()
      clearSelectionToolbar()
    },
    [clearSelectionToolbar, sessionId]
  )

  const onExplainSelection = useCallback(() => {
    if (!selectionToolbar?.text) {
      return
    }
    void sendSelectionPrompt(`${t('Explain this')}: ${selectionToolbar.text}`)
  }, [selectionToolbar?.text, sendSelectionPrompt, t])

  const onTranslateSelection = useCallback(() => {
    if (!selectionToolbar?.text) {
      return
    }
    void sendSelectionPrompt(`${t('Translate')}: ${selectionToolbar.text}`)
  }, [selectionToolbar?.text, sendSelectionPrompt, t])

  const onCopySelection = useCallback(async () => {
    if (!selectionToolbar?.text) {
      return
    }
    try {
      await navigator.clipboard.writeText(selectionToolbar.text)
    } catch {
      copyToClipboard(selectionToolbar.text)
    }
    toastActions.add(t('copied to clipboard'), 2000)
    clearSelectionToolbar()
  }, [clearSelectionToolbar, selectionToolbar?.text, t])

  const currentArtifact = useMemo<MessageArtifactRecord | undefined>(() => msg.artifacts?.[0], [msg.artifacts])

  const persistFeedback = useCallback(
    (feedback?: Message['feedback']) => {
      void modifyMessage(sessionId, { ...msg, feedback }, false)
    },
    [msg, sessionId]
  )

  const toggleFeedbackRating = useCallback(
    (rating: 'up' | 'down') => {
      if (msg.feedback?.rating === rating) {
        setFeedbackText('')
        persistFeedback(undefined)
        return
      }

      const nextFeedback: Message['feedback'] = {
        rating,
        text: rating === 'down' ? msg.feedback?.text?.trim() || undefined : undefined,
        timestamp: Date.now(),
      }
      setFeedbackText(nextFeedback.text ?? '')
      persistFeedback(nextFeedback)
    },
    [msg.feedback, persistFeedback]
  )

  const saveFeedbackText = useCallback(() => {
    if (msg.feedback?.rating !== 'down') {
      return
    }

    const trimmed = feedbackText.trim()
    if ((msg.feedback?.text ?? '') === trimmed) {
      return
    }

    persistFeedback({
      rating: 'down',
      text: trimmed || undefined,
      timestamp: Date.now(),
    })
  }, [feedbackText, msg.feedback, persistFeedback])

  const handleSelectionMouseUp = useCallback(() => {
    if (msg.role !== 'assistant' || !messageContentRef.current) {
      return
    }

    const selection = window.getSelection()
    const text = selection?.toString().trim()
    if (!selection || !text || selection.rangeCount === 0 || selection.isCollapsed) {
      clearSelectionToolbar()
      return
    }

    const range = selection.getRangeAt(0)
    const commonAncestor =
      range.commonAncestorContainer.nodeType === Node.TEXT_NODE
        ? range.commonAncestorContainer.parentElement
        : (range.commonAncestorContainer as HTMLElement)

    if (!commonAncestor || !messageContentRef.current.contains(commonAncestor)) {
      clearSelectionToolbar()
      return
    }

    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) {
      clearSelectionToolbar()
      return
    }

    setSelectionToolbar({
      text,
      x: Math.min(Math.max(rect.left + rect.width / 2, 72), window.innerWidth - 72),
      y: Math.max(rect.top - 12, 16),
    })
  }, [clearSelectionToolbar, msg.role])

  // Model · tokens · time live in the answer row (MessageActionRow); only finish-reason signals stay here.
  const tips: string[] = []
  if (msg.finishReason && ['content-filter', 'length', 'error'].includes(msg.finishReason)) {
    tips.push(`finish reason: ${msg.finishReason}`)
  }

  // Aritfact
  const needArtifact = useMemo(() => {
    if (msg.role !== 'assistant') {
      return false
    }
    return isContainRenderableCode(messageText)
  }, [messageText, msg.role])

  const contentParts = msg.contentParts || []
  // contentParts may be mutated in place during streaming — length alone is insufficient.
  const partsRevision = contentPartsRevision(contentParts)

  // Keep the Thinking… strip after this turn settles (same mount). Dropping it on
  // generating→false yanked the answer up. Reset when the message identity changes.
  const keepEmptyThinkingMsgIdRef = useRef(msg.id)
  const keepEmptyThinkingRef = useRef(false)
  if (keepEmptyThinkingMsgIdRef.current !== msg.id) {
    keepEmptyThinkingMsgIdRef.current = msg.id
    keepEmptyThinkingRef.current = Boolean(msg.generating)
  } else if (msg.generating) {
    keepEmptyThinkingRef.current = true
  }
  const keepEmptyThinking = keepEmptyThinkingRef.current

  /**
   * Product layout for assistant turns:
   * - One work strip (all tools + reasoning + mid-turn monologue)
   * - Final answer = only content after the last tool/reasoning
   * User / system messages keep a flat part list.
   */
  const groupedParts = useMemo(() => {
    // Empty generating assistant still needs a thinking-group (see groupAssistantContentParts).
    // Returning [] here hid the bubble while statusline said Thinking…
    if (msg.role !== 'assistant') {
      return contentParts.map((part, index) => ({ type: 'single' as const, part, index }))
    }

    return groupAssistantContentParts(contentParts, msg.generating, { keepEmptyThinking })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- partsRevision captures in-place stream mutations
  }, [contentParts, partsRevision, msg.generating, msg.role, keepEmptyThinking])

  // While this message runs a plan, the plan card shows the mascot; the live line hides its own (one mascot on screen).
  // Live timers count from the turn's start (stable across remounts); the timestamp moves on every persisted write.
  const liveTimerOrigin = (msg.generating ? getLiveGenerationStartedAt(msg.id) : undefined) ?? msg.timestamp
  const planRunning = contentParts.some(
    (part) => part.type === 'plan' && planCardState(part, Boolean(msg.generating)) === 'running'
  )

  const messageTaskSnapshot = useMemo(
    () => (contentPartsHaveTaskTools(contentParts) ? snapshotTasksFromContentParts(contentParts) : []),
    [contentParts, contentParts.length, msg.generating]
  )
  const firstTaskToolGroupIndex = useMemo(() => {
    if (!isAgentEnabled || !TodoAppCard) return -1
    return groupedParts.findIndex(
      (g) => g.type === 'single' && g.part.type === 'tool-call' && isTaskTrackingTool(g.part.toolName)
    )
  }, [groupedParts, contentParts.length, msg.generating])

  const CollapseButton = (
    <button type="button" className="msg-collapse-toggle" onClick={() => setIsCollapsed(!isCollapsed)}>
      {isCollapsed ? t('Expand') : t('Collapse')}
    </button>
  )

  // Chat messages get the MA1 row on every layout; picture sessions keep their own row.
  const isChatSession = props.sessionType === 'chat'

  const handleRedoWithModel = useCallback(
    (provider: string, modelId: string) => {
      handleStop()
      void regenerateInNewFork(sessionId, msg, { modelOverride: { provider, modelId } })
    },
    [handleStop, sessionId, msg]
  )

  const deleteItem = useMemo<ActionMenuItemProps>(
    () => ({
      doubleCheck: true,
      text: t('Delete'),
      icon: IconTrash,
      color: 'chatbox-error' as const,
      onClick: onDelMsg,
    }),
    [t, onDelMsg]
  )

  // More for chat messages: the row already has Copy, Redo and Edit (user), so they are not repeated here.
  const chatMenuItems = useMemo<ActionMenuItemProps[]>(() => {
    const items: Array<ActionMenuItemProps | false> = [
      msg.role !== 'assistant' && { text: t('Reply Again Below'), icon: IconArrowDown, onClick: onGenerateMore },
      { text: t('Quote'), icon: IconQuoteFilled, onClick: quoteMsg },
      msg.role === 'assistant' && { text: t('Edit'), icon: IconPencil, onClick: onEditClick },
      !msg.generating &&
        (msg.role === 'user' || msg.role === 'assistant') && {
          text: t('Save as knowledge'),
          icon: IconBrain,
          onClick: () => void onSaveAsKnowledge(),
        },
      msg.role === 'assistant' &&
        isComfyUIReady && { text: t('Send to Image Creator'), icon: IconPhoto, onClick: handleSendToImageCreator },
      !msg.generating &&
        (msg.role === 'user' || msg.role === 'assistant') && {
          text: t('Branch from here'),
          icon: IconGitBranch,
          onClick: onBranchFromHere,
        },
      { divider: true },
      msg.role === 'assistant' &&
        platform.formFactor === 'mobile' && { text: t('Report'), icon: IconMessageReport, onClick: onReport },
      deleteItem,
    ]
    return items.filter((i): i is ActionMenuItemProps => !!i)
  }, [
    t,
    msg.role,
    msg.generating,
    onGenerateMore,
    quoteMsg,
    onEditClick,
    onSaveAsKnowledge,
    isComfyUIReady,
    handleSendToImageCreator,
    onBranchFromHere,
    onReport,
    deleteItem,
  ])

  const pictureMenuItems = useMemo<ActionMenuItemProps[]>(
    () => [
      ...(isSamllScreen
        ? [
            !msg.generating &&
              msg.role === 'assistant' && {
                text: t('Reply Again'),
                icon: IconReload,
                onClick: handleRefresh,
              },
            msg.role !== 'assistant' && {
              text: t('Reply Again Below'),
              icon: IconArrowDown,
              onClick: onGenerateMore,
            },
            msg.role !== 'assistant' && {
              text: t('Edit'),
              icon: IconPencil,
              onClick: onEditClick,
            },
            msg.role !== 'assistant' && {
              text: t('Copy'),
              icon: IconCopy,
              onClick: onCopyMsg,
            },
            !msg.generating &&
              msg.role === 'assistant' && {
                text: t('Generate More Images Below'),
                icon: IconPhotoPlus,
                onClick: onGenerateMore,
              },
          ].filter((i) => !!i)
        : []),
      {
        text: t('Quote'),
        icon: IconQuoteFilled,
        onClick: quoteMsg,
      },
      // Mobile: Save as knowledge lives in ⋯ menu (desktop has toolbar icon)
      ...(isSamllScreen && !msg.generating && (msg.role === 'user' || msg.role === 'assistant')
        ? [
            {
              text: t('Save as knowledge'),
              icon: IconBrain,
              onClick: () => void onSaveAsKnowledge(),
            } satisfies ActionMenuItemProps,
          ]
        : []),
      { divider: true },
      ...(msg.role === 'assistant' && platform.formFactor === 'mobile'
        ? [
            {
              text: t('Report'),
              icon: IconMessageReport,
              onClick: onReport,
            },
          ]
        : []),
      deleteItem,
    ],
    [
      t,
      msg.role,
      onReport,
      quoteMsg,
      isSamllScreen,
      handleRefresh,
      msg.generating,
      onGenerateMore,
      onEditClick,
      onCopyMsg,
      onSaveAsKnowledge,
      deleteItem,
    ]
  )
  const actionMenuItems = isChatSession ? chatMenuItems : pictureMenuItems
  const [actionMenuOpened, setActionMenuOpened] = useState(false)
  const [redoListOpened, setRedoListOpened] = useState(false)
  // Redo ▾ obeys the composer's before-send ability checks: its list offers only models that can take this turn
  // (tools unless the turn was sent without them, vision for a picture). Unknown capabilities are never left out.
  const [redoNeeds, setRedoNeeds] = useState<ModelNeeds>({})
  const handleRedoListChange = useCallback(
    (opened: boolean) => {
      if (opened) {
        const session = peekSession(sessionId)
        setRedoNeeds(session ? turnAbilityNeeds(session, msg.id) : {})
      }
      setRedoListOpened(opened)
    },
    [sessionId, msg.id]
  )
  const redoModelFilter = useCallback(
    (model: ProviderModelInfo) => !isNonChatComposerModel(model) && modelMeetsNeeds(model, redoNeeds),
    [redoNeeds]
  )
  const isUser = msg.role === 'user'
  const isAssistant = msg.role === 'assistant'

  // Defer follow-up chips after settle so they don't share the generating→done paint.
  const [settledReady, setSettledReady] = useState(false)
  useEffect(() => {
    if (msg.generating) {
      setSettledReady(false)
      return
    }
    const t = window.setTimeout(() => setSettledReady(true), 180)
    return () => window.clearTimeout(t)
  }, [msg.generating, msg.id])

  // Keep the caret mounted ~200ms after generating so it fades instead of snapping off.
  const wasStreamingRef = useRef(false)
  const [caretPhase, setCaretPhase] = useState<'off' | 'on' | 'out'>('off')
  useEffect(() => {
    const live = Boolean(isAssistant && msg.generating)
    if (live) {
      wasStreamingRef.current = true
      setCaretPhase('on')
      return
    }
    if (!wasStreamingRef.current) {
      setCaretPhase('off')
      return
    }
    wasStreamingRef.current = false
    setCaretPhase('out')
    const t = window.setTimeout(() => setCaretPhase('off'), 280)
    return () => window.clearTimeout(t)
  }, [isAssistant, msg.generating, msg.id])

  return (
    <div
      id={props.id}
      key={msg.id}
      className={cn(
        'group/message',
        'msg-block',
        'msg-turn',
        msg.generating ? 'rendering' : 'render-done',
        { user: 'user-msg', system: 'system-msg', assistant: 'assistant-msg', tool: 'tool-msg' }[msg.role || 'user'],
        className,
        'w-full'
      )}
    >
      {/*
        System prompt: no floating gear — Session options live in the header ⋯
        menu (and composer · Session options). A second gear looked like a
        duplicate settings control when the system bubble was empty/collapsed.
      */}
      {isAssistant && (msg.agentId || msg.name) && (
        <AgentSpeakerHeader
          agentId={msg.agentId}
          name={msg.name}
          generating={msg.generating}
          roomRole={msg.roomRole}
          roomRound={msg.roomRound}
          discussionGroupStart={discussionGroupStart}
        />
      )}
      <div className={cn('w-full', isUser && 'flex flex-col items-end')}>
        <MessageStatuses statuses={msg.status} />
        {isUser && msg.quoteAttachment?.text ? (
          <div className="mb-1.5 w-full max-w-full min-w-[200px]">
            <MessageQuoteBar quote={msg.quoteAttachment} />
          </div>
        ) : null}
        {editing && isUser ? (
          <UserMessageEditor
            initialText={contentParts.flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('\n')}
            onSend={onEditSend}
            onCancel={() => setEditing(false)}
          />
        ) : null}
        <div className={cn('msg-bubble', isUser ? 'inline-block' : 'w-full', editing && isUser && 'hidden')}>
          <div
            ref={messageContentRef}
            className={cn('msg-content', { 'msg-content-small': small })}
            onMouseUp={handleSelectionMouseUp}
          >
            {msg.reasoningContent && !groupedParts.some((g) => g.type === 'thinking-group') && (
              <ThinkingLine live={false} text={msg.reasoningContent} defaultOpen={thinkingDefaultOpen} />
            )}
            {groupedParts.length > 0 && (
              <div>
                {groupedParts.map((group, groupIndex) =>
                  group.type === 'thinking-group' ? (
                    ThinkingGroupUI ? (
                      <div key={`thinking-group-${msg.id}`} className="msg-thinking-slot">
                        <Suspense
                          fallback={
                            group.workActive ? (
                              <ThinkingLine
                                live
                                startedAt={liveTimerOrigin}
                                text=""
                                defaultOpen={thinkingDefaultOpen}
                                showMascot={!planRunning}
                                onStop={onStopGeneration}
                              />
                            ) : null
                          }
                        >
                          <ThinkingGroupUI
                            message={msg}
                            parts={group.parts}
                            monologueTexts={group.monologueTexts}
                            isLastGroup={group.workActive}
                            defaultOpen={thinkingDefaultOpen}
                            showMascot={!planRunning}
                            onStop={onStopGeneration}
                          />
                        </Suspense>
                      </div>
                    ) : null
                  ) : group.part.type === 'reasoning' ? (
                    <div key={`reasoning-${msg.id}-${group.index}`} className="msg-thinking-slot">
                      <ThinkingLine
                        live={Boolean(msg.generating) && contentParts[contentParts.length - 1] === group.part}
                        startedAt={group.part.startTime}
                        durationMs={group.part.duration}
                        text={group.part.text}
                        defaultOpen={thinkingDefaultOpen}
                        showMascot={!planRunning}
                        onStop={onStopGeneration}
                      />
                    </div>
                  ) : group.part.type === 'text' ? (
                    <div
                      key={`text-${msg.id}-${group.index}`}
                      className={cn(
                        msg.role === 'assistant' && 'msg-answer-slot',
                        caretPhase === 'on' && 'is-streaming',
                        caretPhase === 'out' && 'is-streaming is-settling'
                      )}
                    >
                      {msg.role === 'user' ? (
                        <div className="break-words whitespace-pre-wrap">
                          <InlineMentionsText
                            text={
                              needCollapse && isCollapsed
                                ? `${group.part.text.slice(0, collapseThreshold)}...`
                                : group.part.text || ''
                            }
                          />
                          {needCollapse && isCollapsed && CollapseButton}
                        </div>
                      ) : enableMarkdownRendering && !isCollapsed ? (
                        <Markdown
                          uniqueId={`${msg.id}-${group.index}`}
                          enableLaTeXRendering={enableLaTeXRendering}
                          enableMermaidRendering={enableMermaidRendering}
                          generating={msg.generating}
                          citations={msg.citations}
                        >
                          {group.part.text || ''}
                        </Markdown>
                      ) : (
                        <div className="break-words whitespace-pre-line">
                          {needCollapse && isCollapsed
                            ? `${group.part.text.slice(0, collapseThreshold)}...`
                            : group.part.text}
                          {needCollapse && isCollapsed && CollapseButton}
                        </div>
                      )}
                    </div>
                  ) : group.part.type === 'info' ? (
                    <Flex key={`info-${group.part.text}`} className="mb-2 ">
                      <Flex
                        className="bg-chatbox-background-brand-secondary border-0 border-l-2 border-solid border-chatbox-tint-brand rounded-r-md"
                        align="center"
                        gap="xxs"
                        px="xs"
                      >
                        <ScalableIcon icon={IconInfoCircle} size={16} className="flex-none text-chatbox-tint-brand" />

                        <Text size="xs" c="chatbox-brand">
                          {group.part.text}
                        </Text>
                      </Flex>
                    </Flex>
                  ) : group.part.type === 'image' ? (
                    props.sessionType !== 'picture' && (
                      <div key={`image-${group.part.storageKey}`} className="mt-2">
                        <PictureGallery
                          key={`image-${group.part.storageKey}`}
                          pictures={[group.part]}
                          compact={msg.role === 'user'}
                        />
                        {(group.part as { ocrResult?: string }).ocrResult && (
                          <button
                            type="button"
                            className="msg-ocr-card"
                            onClick={async (e) => {
                              e.stopPropagation()
                              await NiceModal.show('content-viewer', {
                                title: t('OCR Text Content'),
                                content: (group.part as { ocrResult?: string }).ocrResult || '',
                              })
                            }}
                          >
                            <span className="msg-ocr-card-meta">
                              {t('OCR Text')} ({(group.part as { ocrResult?: string }).ocrResult?.length || 0}{' '}
                              {t('characters')})
                            </span>
                            <span
                              className="msg-ocr-card-preview"
                              title={(group.part as { ocrResult?: string }).ocrResult}
                            >
                              {(group.part as { ocrResult?: string }).ocrResult}
                            </span>
                            <span className="msg-ocr-card-action">{t('Click to view full text')}</span>
                          </button>
                        )}
                      </div>
                    )
                  ) : group.part.type === 'plan' ? (
                    PlanCard ? (
                      <Suspense fallback={null} key={`plan-card-${msg.id}-${group.index}`}>
                        <PlanCard
                          plan={group.part}
                          sessionId={sessionId}
                          generating={Boolean(msg.generating)}
                          touchesFiles={planTouchesFiles}
                          latestPlan={latestPlan}
                          onRun={onApprovePlan}
                          onRequestChanges={onRequestPlanChanges}
                          onReject={onRejectPlan}
                          onStop={onStopGeneration}
                          onContinue={onContinuePlan}
                          continueState={planContinue}
                        />
                      </Suspense>
                    ) : null
                  ) : group.part.type === 'tool-call' ? (
                    isTaskTrackingTool(group.part.toolName) ? (
                      groupIndex === firstTaskToolGroupIndex && TodoAppCard ? (
                        <Suspense fallback={null} key={`todo-app-${msg.id}`}>
                          <TodoAppCard
                            sessionId={sessionId}
                            snapshot={messageTaskSnapshot}
                            interactive
                            skipEnterAnimation={!msg.generating}
                          />
                        </Suspense>
                      ) : null
                    ) : ToolCallPartUI ? (
                      <Suspense fallback={null} key={group.part.toolCallId}>
                        <ToolCallPartUI part={group.part as MessageToolCallPart} />
                      </Suspense>
                    ) : null
                  ) : null
                )}
              </div>
            )}
          </div>
          {props.sessionType === 'picture' && msg.contentParts.filter((p) => p.type === 'image').length > 0 && (
            <PictureGallery
              pictures={msg.contentParts.filter((p) => p.type === 'image')}
              onReport={platform.formFactor === 'mobile' ? onReport : undefined}
            />
          )}
          {needArtifact && (
            <Flex direction="column" mt="sm">
              <InlineArtifact
                sessionId={sessionId}
                messageId={msg.id}
                messageContent={messageText}
                preview={previewArtifact}
                setPreview={setPreviewArtifact}
                autoOpenWorkspace={autoPreviewArtifacts || currentArtifact?.type !== 'markdown'}
                generating={!!msg.generating}
                artifact={currentArtifact}
              />
            </Flex>
          )}
          <ModelErrorNotice msg={msg} sessionId={sessionId} />
          {needCollapse && !isCollapsed && CollapseButton}
          {msg.citations?.length ? <SourceCardList citations={msg.citations} /> : null}
          {msg.role === 'assistant' && !msg.generating ? (
            <KnowledgeProposalCard sessionId={sessionId} messageId={msg.id} />
          ) : null}

          {/*
            Waiting chrome while generating with nothing the user can read yet.
            One live indicator only: active work strip OR pending — never blank after
            reasoning ends and before the first readable answer token.
          */}
          {shouldShowAssistantPending({
            message: msg,
            contentParts,
            workStripAvailable: Boolean(ThinkingGroupUI),
          }) && (
            <div className="mt-0.5">
              <ThinkingLine
                live
                startedAt={liveTimerOrigin}
                text=""
                defaultOpen={thinkingDefaultOpen}
                showMascot={!planRunning}
                onStop={onStopGeneration}
              />
            </div>
          )}

          {!msg.generating && settledReady && tips.length > 0 && (
            <Text size="xs" c="chatbox-tertiary" className="mt-1 opacity-80">
              {tips.join(' · ')}
            </Text>
          )}
        </div>
        <TextSelectionToolbar
          opened={!!selectionToolbar}
          position={selectionToolbar ? { x: selectionToolbar.x, y: selectionToolbar.y } : null}
          onExplain={onExplainSelection}
          onTranslate={onTranslateSelection}
          onQuote={quoteSelection}
          onCopy={onCopySelection}
          onClose={clearSelectionToolbar}
        />
        {(msg.files || msg.links) && <MessageAttachmentGrid files={msg.files} links={msg.links} />}

        {isAssistant && msg.skillActivations && msg.skillActivations.length > 0 && !msg.generating && settledReady && (
          <SkillActivationsBar activations={msg.skillActivations} className="mt-2.5" />
        )}

        {/* actions — hover-only; last assistant reserves height so settle does not shove the thread */}
        {buttonGroup !== 'none' &&
          !(editing && isUser) &&
          !(isAssistant && !msg.error && !hasVisibleAssistantReply(contentParts) && !msg.generating) && (
            <div className={clsx('msg-actions-slot', buttonGroup === 'always' && 'is-reserved')}>
              {settledReady && !msg.generating && (
                <Flex
                  gap={0}
                  className={clsx(
                    'msg-actions',
                    (actionMenuOpened || redoListOpened || buttonGroup === 'always') && 'is-visible',
                    isSamllScreen ? 'sticky bottom-4' : '',
                    isUser && 'justify-end'
                  )}
                  align="center"
                >
                  <Flex
                    gap={0}
                    className={
                      isSamllScreen
                        ? 'p-xxs bg-chatbox-background-primary rounded-md border-[0.5px] border-solid border-chatbox-border-primary'
                        : ''
                    }
                  >
                    {isChatSession ? (
                      <MessageActionRow
                        msg={msg}
                        onCopy={onCopyMsg}
                        onRedo={handleRefresh}
                        onRedoWithModel={handleRedoWithModel}
                        onFeedback={toggleFeedbackRating}
                        onEdit={isUser ? onEditClick : undefined}
                        menu={actionMenuItems}
                        menuOpened={actionMenuOpened}
                        onMenuChange={setActionMenuOpened}
                        onRedoListChange={handleRedoListChange}
                        redoModelFilter={redoModelFilter}
                      />
                    ) : (
                      <>
                        {/* Mock action order (assistant): copy · up · down · reload · more */}
                        {!isSamllScreen && !(props.sessionType === 'picture' && msg.role === 'assistant') && (
                          <MessageActionIcon icon={IconCopy} tooltip={t('copy')} onClick={onCopyMsg} />
                        )}

                        {!isSamllScreen && msg.role === 'assistant' && (
                          <MessageActionIcon
                            icon={msg.feedback?.rating === 'up' ? IconThumbUpFilled : IconThumbUp}
                            tooltip={t('Thumbs Up')}
                            color={msg.feedback?.rating === 'up' ? 'chatbox-success' : 'chatbox-tertiary'}
                            onClick={() => toggleFeedbackRating('up')}
                          />
                        )}

                        {!isSamllScreen && msg.role === 'assistant' && (
                          <MessageActionIcon
                            icon={msg.feedback?.rating === 'down' ? IconThumbDownFilled : IconThumbDown}
                            tooltip={t('Thumbs Down')}
                            color={msg.feedback?.rating === 'down' ? 'chatbox-error' : 'chatbox-tertiary'}
                            onClick={() => toggleFeedbackRating('down')}
                          />
                        )}

                        {!isSamllScreen && !msg.generating && msg.role === 'assistant' && (
                          <MessageActionIcon icon={IconReload} tooltip={t('Reply Again')} onClick={handleRefresh} />
                        )}

                        {!isSamllScreen && msg.role !== 'assistant' && (
                          <MessageActionIcon
                            icon={IconArrowDown}
                            tooltip={t('Reply Again Below')}
                            onClick={onGenerateMore}
                          />
                        )}

                        {
                          // legacy cloud model prefix
                          !isSamllScreen &&
                            !msg.model?.startsWith('chatboxai') &&
                            // (legacy comment removed)
                            !(msg.role === 'assistant' && props.sessionType === 'picture') && (
                              <MessageActionIcon icon={IconPencil} tooltip={t('edit')} onClick={onEditClick} />
                            )
                        }

                        {/* Save as knowledge — toolbar (same row as copy / edit / more) */}
                        {!isSamllScreen &&
                          !msg.generating &&
                          (msg.role === 'user' || msg.role === 'assistant') &&
                          !(props.sessionType === 'picture' && msg.role === 'assistant') && (
                            <MessageActionIcon
                              icon={IconBrain}
                              tooltip={t('Save as knowledge')}
                              onClick={() => void onSaveAsKnowledge()}
                            />
                          )}

                        {!isSamllScreen && msg.role === 'assistant' && isComfyUIReady && (
                          <MessageActionIcon
                            icon={IconPhoto}
                            tooltip={t('Send to Image Creator')}
                            onClick={handleSendToImageCreator}
                          />
                        )}

                        {!isSamllScreen &&
                          !msg.generating &&
                          props.sessionType === 'picture' &&
                          msg.role === 'assistant' && (
                            <MessageActionIcon
                              icon={IconPhotoPlus}
                              tooltip={t('Generate More Images Below')}
                              onClick={onGenerateMore}
                            />
                          )}

                        <ActionMenu
                          items={actionMenuItems}
                          opened={actionMenuOpened}
                          onChange={(opened) => setActionMenuOpened(opened)}
                        >
                          <MessageActionIcon icon={IconDotsVertical} tooltip={t('More')} />
                        </ActionMenu>
                      </>
                    )}
                  </Flex>
                </Flex>
              )}
            </div>
          )}
        {msg.role === 'assistant' && msg.feedback?.rating === 'down' && (
          <Textarea
            mt="xs"
            autosize
            minRows={2}
            maxRows={4}
            value={feedbackText}
            placeholder={t('Optional feedback')}
            onChange={(event) => setFeedbackText(event.currentTarget.value)}
            onBlur={saveFeedbackText}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                event.currentTarget.blur()
              }
            }}
          />
        )}
        {showFollowUpSuggestions &&
        settledReady &&
        msg.role === 'assistant' &&
        !msg.generating &&
        !msg.error &&
        contentParts.some((p) => {
          if (p.type === 'text' && p.text?.trim()) return true
          return p.type === 'image' || p.type === 'plan'
        }) ? (
          <FollowUpSuggestions
            sessionId={sessionId}
            message={msg}
            cachedFollowUpSuggestions={msg.followUpSuggestions}
          />
        ) : null}
      </div>
    </div>
  )
}

export default memo(_Message)

function getBase64ImageSize(base64: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      resolve({ width: img.width, height: img.height })
    }
    img.onerror = (err) => {
      reject(err)
    }
    img.src = base64
  })
}

type PictureGalleryProps = {
  pictures: MessagePicture[]
  compact?: boolean
  onReport?(picture: MessagePicture): void
}

const PictureGallery = memo(({ pictures, compact, onReport }: PictureGalleryProps) => {
  const isSmallScreen = useIsSmallScreen()
  const imageHeight = compact ? (isSmallScreen ? 60 : 100) : isSmallScreen ? 100 : 200
  const uiElements: UIElementData[] = concat(
    [
      {
        name: 'custom-download-button',
        ariaLabel: 'Download',
        order: 9,
        isButton: true,
        html: {
          isCustomSVG: true,
          inner:
            '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
          outlineID: 'pswp__icn-download',
        },
        appendTo: 'bar',
        onClick: async (_e, _el, pswp) => {
          const picture = pictures[pswp.currIndex]
          if (picture.storageKey) {
            const base64 = await storage.getBlob(picture.storageKey)
            if (!base64) {
              return
            }
            // (legacy comment)
            const filename =
              platform.formFactor === 'mobile'
                ? `${picture.storageKey.replaceAll(':', '_')}_${Math.random().toString(36).substring(7)}`
                : picture.storageKey
            platform.exporter.exportImageFile(filename, base64)
          } else if (picture.url) {
            platform.exporter.exportByUrl(`image_${Math.random().toString(36).substring(7)}`, picture.url)
          }
        },
      },
    ],
    onReport
      ? [
          {
            name: 'report-button',
            ariaLabel: 'Report',
            order: 8,
            isButton: true,
            html: {
              isCustomSVG: true,
              inner:
                '<path d="M 16 6 A 10 10 0 0 1 16 26 L 16 24 A 8 8 0 0 0 16 8 L 16 6 A 10 10 0 0 0 16 26 L 16 24 A 8 8 0 0 1 16 8 M 15 11 A 1 1 0 0 1 17 11 L 17 16 A 1 1 0 0 1 15 16 M 16 19 A 1.5 1.5 0 0 1 16 22 A 1.5 1.5 0 0 1 16 19 Z" id="pswp__icn-report">',
              outlineID: 'pswp__icn-report',
            },
            appendTo: 'bar',
            onClick: (_e, _el, pswp) => {
              const picture = pictures[pswp.currIndex]
              pswp.close()
              onReport(picture)
            },
          },
        ]
      : []
  )
  return (
    <Flex gap="sm" wrap="wrap">
      <Gallery uiElements={uiElements}>
        {pictures.map((p) =>
          p.storageKey ? (
            <ImageInStorageGalleryItem key={p.storageKey} storageKey={p.storageKey} height={imageHeight} />
          ) : p.url ? (
            <GalleryItem key={p.url} original={p.url} thumbnail={p.url} width={1024} height={1024}>
              {({ ref, open }) => (
                <Img
                  src={p.url}
                  h={imageHeight}
                  w="auto"
                  fit="contain"
                  radius="md"
                  ref={ref}
                  onClick={open}
                  className="cursor-pointer"
                />
              )}
            </GalleryItem>
          ) : undefined
        )}
      </Gallery>
    </Flex>
  )
})

const ImageInStorageGalleryItem = ({ storageKey, height }: { storageKey: string; height?: number }) => {
  const isSmallScreen = useIsSmallScreen()
  const fallbackHeight = isSmallScreen ? 100 : 200
  const { data: pic } = useQuery({
    queryKey: ['image-in-storage-gallery-item', storageKey],
    queryFn: async ({ queryKey: [, key] }) => {
      const blob = await storage.getBlob(key)
      const base64 = blob?.startsWith('data:image/') ? blob : `data:image/png;base64,${blob}`
      const size = await getBase64ImageSize(base64)
      return {
        storageKey,
        ...size,
        data: base64,
      }
    },
    staleTime: Infinity,
  })

  return pic ? (
    <GalleryItem original={pic.data} thumbnail={pic.data} width={pic.width} height={pic.height}>
      {({ ref, open }) => (
        <Img
          src={pic.data}
          h={height ?? fallbackHeight}
          w="auto"
          fit="contain"
          radius="md"
          ref={ref}
          onClick={open}
          className="cursor-pointer"
        />
      )}
    </GalleryItem>
  ) : null
}

export const MessageActionIcon = forwardRef<
  HTMLButtonElement,
  ActionIconProps & {
    tooltip?: string | null
    onClick?: MouseEventHandler<HTMLButtonElement>
    icon: React.ElementType<IconProps>
  }
>(({ tooltip, icon, ...props }, ref) => {
  const isSmallScreen = useIsSmallScreen()
  const actionIcon = (
    <ActionIcon
      ref={ref}
      variant="subtle"
      className="msg-action-ia"
      w={isSmallScreen ? 36 : 32}
      h={isSmallScreen ? 36 : 32}
      miw={isSmallScreen ? 36 : 32}
      mih={isSmallScreen ? 36 : 32}
      p={0}
      bd={0}
      radius={8}
      color="chatbox-tertiary"
      {...props}
    >
      <ScalableIcon icon={icon} size={isSmallScreen ? 18 : 16} />
    </ActionIcon>
  )

  return tooltip ? (
    <Tooltip1 label={tooltip} openDelay={1000} withArrow>
      {actionIcon}
    </Tooltip1>
  ) : (
    actionIcon
  )
})
