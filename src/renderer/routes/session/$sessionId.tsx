import NiceModal from '@ebay/nice-modal-react'
import { Button, Flex, Text } from '@mantine/core'
import { type Message, type ModelProvider, ModelProviderEnum } from '@shared/types'
import { IconMessage, IconShield } from '@tabler/icons-react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import BrowserAgentPanel from '@/components/BrowserAgent/BrowserAgentPanel'
import ComputerUseHud from '@/components/ComputerUse/ComputerUseHud'
import ChatDockStack from '@/components/chat/ChatDockStack'
import { ChatDropOverlay } from '@/components/chat/ChatDropOverlay'
import MessageList, { type MessageListRef } from '@/components/chat/MessageList'
import SessionStatusBar from '@/components/chat/SessionStatusBar'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import InputBox, { type InputBoxRef } from '@/components/InputBox/InputBox'
import Header from '@/components/layout/Header'
import { ProjectContextPanel } from '@/components/project/ProjectContextPanel'
import ThreadHistoryDrawer from '@/components/session/ThreadHistoryDrawer'
import WorkspacePanel, { useWorkspaceChromeActive } from '@/components/workspace/WorkspacePanel'
import { useProjectWorkspace } from '@/hooks/useProjectWorkspace'
import { useProviders } from '@/hooks/useProviders'
import platform from '@/platform'
import { getEffectiveProjectId } from '@/projects/project-context'
import { commitProjectContextDraft } from '@/projects/project-context-draft'
import { updateSessionWithMessages as updateSessionStore, useSession } from '@/stores/chatStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import * as scrollActions from '@/stores/scrollActions'
import { moveChatWithUndoOrToast } from '@/stores/session/chat-menu-actions'
import { isSessionGenerationActive } from '@/stores/session/generation-cancel'
import { setChatPlanMode } from '@/stores/session/plan-mode'
import { isSessionGenerationLive, subscribeSessionGenerationLive } from '@/stores/session/session-live-generation'
import { modifyMessage, removeCurrentThread, startNewThread, submitNewUserMessage } from '@/stores/sessionActions'
import { getAllMessageList } from '@/stores/sessionHelpers'
import * as toastActions from '@/stores/toastActions'
import { uiStore, useUIStore } from '@/stores/uiStore'
import { isThreadVisuallyEmpty } from '@/utils/chat-starters'
import { getModelDisplayName } from '@/utils/modelDisplayName'
import { getSessionRouteState } from '@/utils/sessionRouteState'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'

// Agent-mode panels are not used on Android. Use compile-time conditional
// dynamic imports so the modules (and their @mantine/openclaw deps) are
// fully tree-shaken from the Android session chunk.
const isAgentEnabled = CHATBOX_BUILD_PLATFORM !== 'android'

const SessionPanel = isAgentEnabled ? lazy(() => import('@/openclaw/components/SessionPanel')) : null
const ToolAuditPanel = isAgentEnabled
  ? lazy(() => import('@/components/ToolAuditPanel').then((m) => ({ default: m.ToolAuditPanel })))
  : null
export const Route = createFileRoute('/session/$sessionId')({
  component: RouteComponent,
})

function RouteComponent() {
  const { t } = useTranslation()
  const { sessionId: currentSessionId } = Route.useParams()
  const navigate = useNavigate()
  const { session: currentSession, isPending, isError, refetch } = useSession(currentSessionId)
  const { projectId, descriptor, setDescriptor, resolved } = useProjectWorkspace(currentSession)
  const sessionRouteState = getSessionRouteState({ session: currentSession, isPending, isError })
  const { providers } = useProviders()
  const [showToolAudit, setShowToolAudit] = useState(false)

  const currentMessageList = useMemo(() => (currentSession ? getAllMessageList(currentSession) : []), [currentSession])
  const threadEmpty = useMemo(() => isThreadVisuallyEmpty(currentMessageList), [currentMessageList])
  const lastGeneratingMessage = useMemo(
    () => currentMessageList.find((m: Message) => m.generating),
    [currentMessageList]
  )
  // Live-lock + abort registry + message.generating. Never rely on cache alone.
  const [liveGen, setLiveGen] = useState(
    () => isSessionGenerationLive(currentSessionId) || isSessionGenerationActive(currentSessionId)
  )
  useEffect(() => {
    const sync = () =>
      setLiveGen(isSessionGenerationLive(currentSessionId) || isSessionGenerationActive(currentSessionId))
    sync()
    const unsub = subscribeSessionGenerationLive(sync)
    const id = window.setInterval(sync, 150)
    return () => {
      unsub()
      window.clearInterval(id)
    }
  }, [currentSessionId, lastGeneratingMessage?.id, lastGeneratingMessage?.generating])
  const isGenerating = Boolean(lastGeneratingMessage || liveGen)

  const messageListRef = useRef<MessageListRef>(null)
  const inputBoxRef = useRef<InputBoxRef>(null)

  const goHome = useCallback(() => {
    navigate({ to: '/', replace: true })
  }, [navigate])

  useEffect(() => {
    setTimeout(() => {
      scrollActions.scrollToBottom('auto') // (legacy)
    }, 200)
  }, [])

  // currentSession（session settings），settingsSession
  const currentSessionType = currentSession?.type
  const currentSessionProvider = currentSession?.settings?.provider
  const currentSessionModelId = currentSession?.settings?.modelId
  useEffect(() => {
    if (!currentSessionType || !currentSessionProvider || !currentSessionModelId) {
      return
    }

    const { chat, picture, setChatModel, setPictureModel } = lastUsedModelStore.getState()
    if (
      currentSessionType === 'chat' &&
      (chat?.provider !== currentSessionProvider || chat?.modelId !== currentSessionModelId)
    ) {
      setChatModel(currentSessionProvider, currentSessionModelId)
      return
    }
    if (
      currentSessionType === 'picture' &&
      (picture?.provider !== currentSessionProvider || picture?.modelId !== currentSessionModelId)
    ) {
      setPictureModel(currentSessionProvider, currentSessionModelId)
    }
  }, [currentSessionType, currentSessionProvider, currentSessionModelId])

  const onSelectModel = useCallback(
    (provider: ModelProvider, modelId: string) => {
      if (!currentSession) {
        return
      }
      void updateSessionStore(currentSession.id, {
        messages:
          provider === ModelProviderEnum.OpenClaw
            ? currentSession.messages.filter((message) => message.role !== 'system')
            : currentSession.messages,
        settings: {
          ...(currentSession.settings || {}),
          provider,
          modelId,
        },
      })
    },
    [currentSession]
  )

  const onStartNewThread = useCallback(() => {
    if (!currentSession) {
      return false
    }
    void startNewThread(currentSession.id)
    return true
  }, [currentSession])

  const onRollbackThread = useCallback(() => {
    if (!currentSession) {
      return false
    }
    void removeCurrentThread(currentSession.id)
    return true
  }, [currentSession])

  const onSubmit = useCallback(
    async ({
      constructedMessage,
      needGenerating = true,
      onUserMessageReady,
    }: {
      constructedMessage: Message
      needGenerating?: boolean
      onUserMessageReady?: () => void
    }) => {
      if (!currentSession) {
        return
      }
      const drafts = uiStore.getState().projectContextDrafts[currentSession.id] || []
      if (drafts.length > 0) {
        if (!descriptor?.capabilityId || !platform.readWorkspaceFile) {
          toastActions.add('Project folder is not ready')
          return
        }
        const committed = await commitProjectContextDraft(drafts, (relativePath) =>
          platform.readWorkspaceFile!(descriptor.capabilityId, relativePath)
        )
        if (!committed.ok) {
          toastActions.add(
            committed.reason === 'revision-mismatch'
              ? 'A selected file changed. Refresh or remove it before sending.'
              : 'Selected project context could not be sent.'
          )
          return
        }
        const provenance = `\n\n## Selected project context\n\n${committed.blocks.join('\n\n')}`
        const textPart = constructedMessage.contentParts.find((p) => p.type === 'text')
        if (textPart && textPart.type === 'text') {
          textPart.text = `${textPart.text}${provenance}`
        }
        uiStore.getState().clearProjectContextDraft(currentSession.id)
      }
      messageListRef.current?.scrollToBottom('instant')
      await submitNewUserMessage(currentSession.id, {
        newUserMsg: constructedMessage,
        needGenerating,
        onUserMessageReady,
      })
    },
    [currentSession, descriptor]
  )

  const onClickSessionSettings = useCallback(() => {
    if (!currentSession) {
      return false
    }
    NiceModal.show('session-settings', {
      session: currentSession,
    })
    return true
  }, [currentSession])

  const onStopGenerating = useCallback(() => {
    if (!currentSession) {
      return false
    }
    void import('@/stores/session/stop-generation').then(({ stopSessionGeneration }) =>
      stopSessionGeneration(currentSession.id, lastGeneratingMessage)
    )
    return true
  }, [currentSession, lastGeneratingMessage])

  const model = useMemo(() => {
    if (!currentSession?.settings?.modelId || !currentSession?.settings?.provider) {
      return undefined
    }
    return {
      provider: currentSession.settings.provider,
      modelId: currentSession.settings.modelId,
    }
  }, [currentSession?.settings?.provider, currentSession?.settings?.modelId])
  const modelDisplayName = useMemo(() => getModelDisplayName(providers, model), [model, providers])

  const isOpenClawProvider = currentSession?.settings?.provider === ModelProviderEnum.OpenClaw
  const [showSessionPanel, setShowSessionPanel] = useState(false)
  const workspaceChromeActive = useWorkspaceChromeActive()
  const workspaceExpanded = useUIStore((s) => s.workspaceExpanded)
  const setWorkspacePanel = useUIStore((s) => s.setWorkspacePanel)

  // Close workspace when leaving this conversation so state doesn't leak
  useEffect(() => {
    return () => {
      setWorkspacePanel(null)
    }
  }, [currentSessionId, setWorkspacePanel])

  if (sessionRouteState === 'loading') {
    return <SessionState message={t('Loading conversation')} />
  }

  if (sessionRouteState === 'error') {
    return (
      <SessionState
        message={t('Could not load conversation')}
        actionLabel={t('Retry')}
        onAction={() => void refetch()}
      />
    )
  }

  if (sessionRouteState === 'not-found') {
    return <SessionState message={t('Conversation not found')} actionLabel={t('Back to HomePage')} onAction={goHome} />
  }

  return currentSession ? (
    <div
      className={`session-shell ${workspaceChromeActive ? 'has-workspace' : ''}${workspaceExpanded ? ' has-workspace-expanded' : ''}`}
    >
      <Header session={currentSession} />

      <div className="session-body-row">
        <ProjectContextPanel
          sessionId={currentSession.id}
          projectId={projectId}
          descriptor={descriptor}
          resolved={resolved}
          onDescriptorChange={setDescriptor}
        />
        <div className="session-main-col dg-drop-host">
          <ChatDropOverlay />
          {/* key ensures a fresh MessageList instance per session */}
          <div className="session-thread">
            <MessageList ref={messageListRef} key={`message-list${currentSessionId}`} currentSession={currentSession} />
          </div>

          {/* Agent chrome — compact strip above composer (OpenClaw + tool audit) */}
          {isAgentEnabled && isOpenClawProvider && (
            <div className="agent-dock">
              <div className="agent-dock-bar chat-col">
                <Flex align="center" justify="space-between" gap="sm" className="min-w-0 w-full">
                  <Text className="agent-dock-label" lineClamp={1}>
                    {t('Agent')}
                  </Text>
                  <Flex align="center" gap={6} className="shrink-0">
                    <button
                      type="button"
                      className={`agent-dock-chip ${showSessionPanel ? 'is-on' : ''}`}
                      onClick={() => setShowSessionPanel((v) => !v)}
                      aria-pressed={showSessionPanel}
                    >
                      <IconMessage size={14} stroke={1.5} />
                      <span>{t('Gateway')}</span>
                    </button>
                    <button
                      type="button"
                      className={`agent-dock-chip ${showToolAudit ? 'is-on' : ''}`}
                      onClick={() => setShowToolAudit((v) => !v)}
                      aria-pressed={showToolAudit}
                    >
                      <IconShield size={14} stroke={1.5} />
                      <span>{t('Audit')}</span>
                    </button>
                  </Flex>
                </Flex>
              </div>
              {showSessionPanel && SessionPanel && (
                <div className="agent-dock-panel chat-col">
                  <Suspense fallback={null}>
                    <SessionPanel />
                  </Suspense>
                </div>
              )}
              {showToolAudit && ToolAuditPanel && (
                <div className="agent-dock-panel chat-col">
                  <Suspense fallback={null}>
                    <ToolAuditPanel sessionId={currentSession.id} />
                  </Suspense>
                </div>
              )}
            </div>
          )}

          <div className="session-dock">
            <div className="session-dock-pad">
              <ChatDockStack key={currentSession.id} generating={isGenerating} liveMessage={lastGeneratingMessage}>
                <BrowserAgentPanel
                  sessionId={currentSession.id}
                  armed={Boolean(currentSession.browserArmed)}
                  generating={isGenerating}
                />
                <ComputerUseHud sessionId={currentSession.id} armed={Boolean(currentSession.computerArmed)} />
                <ErrorBoundary name="session-inputbox">
                  <InputBox
                    key={`input-box${currentSession.id}`}
                    ref={inputBoxRef}
                    sessionId={currentSession.id}
                    sessionType={currentSession.type}
                    model={model}
                    modelDisplayName={modelDisplayName}
                    agentMode={currentSession.agentMode ?? false}
                    workspaceRoot={currentSession.workspaceRoot}
                    onStartNewThread={onStartNewThread}
                    onRollbackThread={onRollbackThread}
                    onSelectModel={onSelectModel}
                    onToggleAgentMode={(agentMode) => {
                      void updateSessionStore(currentSession.id, { agentMode })
                    }}
                    planMode={currentSession.settings?.planMode ?? false}
                    onPlanModeChange={(on) => {
                      void setChatPlanMode(currentSession.id, on)
                    }}
                    onWorkspaceRootChange={(workspaceRoot) => {
                      void updateSessionStore(currentSession.id, { workspaceRoot })
                    }}
                    browserArmed={currentSession.browserArmed ?? false}
                    onBrowserArmedChange={(browserArmed) => {
                      void updateSessionStore(currentSession.id, { browserArmed })
                    }}
                    computerArmed={currentSession.computerArmed ?? false}
                    onComputerArmedChange={(computerArmed) => {
                      void updateSessionStore(currentSession.id, { computerArmed })
                    }}
                    onClickSessionSettings={onClickSessionSettings}
                    generating={isGenerating}
                    onSubmit={onSubmit}
                    onStopGenerating={onStopGenerating}
                    scopeId={getEffectiveProjectId(currentSession)}
                    onScopeChange={(id) => void moveChatWithUndoOrToast(currentSessionId, id)}
                  />
                </ErrorBoundary>
              </ChatDockStack>
            </div>
            <SessionStatusBar
              messages={currentMessageList}
              modelLabel={modelDisplayName}
              model={model}
              settings={currentSession.settings}
              providerId={model?.provider}
              generating={isGenerating}
              sessionId={currentSession.id}
              memoryAutoSave={currentSession.settings?.memoryAutoSave}
              empty={threadEmpty}
              onInsertMemory={(content) => inputBoxRef.current?.insertMemory(content)}
              getMemorySaveContent={() => inputBoxRef.current?.getMemorySaveContent() ?? ''}
            />
          </div>
        </div>

        <WorkspacePanel session={currentSession} />
      </div>

      <ThreadHistoryDrawer session={currentSession} />
    </div>
  ) : null
}

function SessionState({
  message,
  actionLabel,
  onAction,
}: {
  message: string
  actionLabel?: string
  onAction?: () => void
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center min-h-[60vh] gap-4 px-6 text-center">
      <div className="text-xl font-semibold text-gray-700">{message}</div>
      {actionLabel && onAction && (
        <Button variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  )
}
