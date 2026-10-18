/**
 * Floating quick chat — content-first compact composer with the shared thread and input box.
 */
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Kbd, Text } from '@mantine/core'
import type { Message, ModelProvider } from '@shared/types'
import { IconMenu2, IconPencil } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useAtom } from 'jotai'
import { type CSSProperties, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ChatDockStack from '@/components/chat/ChatDockStack'
import MessageList, { type MessageListRef } from '@/components/chat/MessageList'
import SessionStatusBar from '@/components/chat/SessionStatusBar'
import { ErrorBoundary } from '@/components/common/ErrorBoundary'
import InputBox, { type InputBoxRef } from '@/components/InputBox/InputBox'
import { formatShortcutLabel } from '@/components/Shortcut'
import { useProviders } from '@/hooks/useProviders'
import platform from '@/platform'
import { currentSessionIdAtom } from '@/stores/atoms'
import {
  broadcastSessionChanged,
  createSession,
  invalidateAndRefetchSession,
  listSessionsMeta,
  updateSessionWithMessages,
  useSession,
} from '@/stores/chatStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import {
  modifyMessage,
  removeCurrentThread,
  startNewThread,
  submitNewUserMessage,
} from '@/stores/sessionActions'
import { isSessionGenerationActive } from '@/stores/session/generation-cancel'
import {
  isSessionGenerationLive,
  subscribeSessionGenerationLive,
} from '@/stores/session/session-live-generation'
import { getAllMessageList, initEmptyChatSession } from '@/stores/sessionHelpers'
import { useSettingsStore } from '@/stores/settingsStore'
import { getModelDisplayName } from '@/utils/modelDisplayName'
import {
  readQuickSessionSnapshot,
  resolveQuickSessionId,
  writeQuickSessionSnapshot,
} from '@/utils/quickSession'

export const Route = createFileRoute('/quick')({
  component: QuickChatPage,
})

function ShortcutHint({ label }: { label?: string }) {
  if (!label) return null
  const parts = label.split(/[+-]/).filter(Boolean)
  if (parts.length === 0) return null
  return (
    <span className="inline-flex items-center gap-0.5 opacity-70">
      {parts.map((p) => (
        <Kbd key={p} size="xs" className="!text-[10px] !px-1 !min-w-0 !h-auto !leading-none py-0.5">
          {formatShortcutLabel(p)}
        </Kbd>
      ))}
    </span>
  )
}

function QuickChatPage() {
  const { t } = useTranslation()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const messageListRef = useRef<MessageListRef>(null)
  const inputBoxRef = useRef<InputBoxRef>(null)
  const { session } = useSession(sessionId)
  const [_, setCachedSessionId] = useAtom(currentSessionIdAtom)
  const { providers } = useProviders()
  const shortcuts = useSettingsStore((s) => s.shortcuts)
  const loadingQuickSessionRef = useRef<Promise<void> | null>(null)

  const loadQuickSession = useCallback(async () => {
    if (loadingQuickSessionRef.current) {
      return await loadingQuickSessionRef.current
    }

    const loadPromise = (async () => {
      const list = await listSessionsMeta()
      const chatSessions = list.filter((item) => !item.type || item.type === 'chat')
      const snapshot = readQuickSessionSnapshot()
      const target =
        resolveQuickSessionId(
          snapshot,
          chatSessions.map((item) => item.id)
        ) ?? (snapshot === null ? chatSessions[0]?.id || null : null)

      if (target) {
        setSessionId(target)
        setCachedSessionId(target)
        writeQuickSessionSnapshot({ sessionId: target, lastOpenedAt: Date.now() })
        return
      }

      const created = await createSession({ ...initEmptyChatSession() })
      setSessionId(created.id)
      setCachedSessionId(created.id)
      writeQuickSessionSnapshot({ sessionId: created.id, lastOpenedAt: Date.now() })
    })()

    loadingQuickSessionRef.current = loadPromise
    try {
      await loadPromise
    } finally {
      if (loadingQuickSessionRef.current === loadPromise) {
        loadingQuickSessionRef.current = null
      }
    }
  }, [setCachedSessionId])

  useEffect(() => {
    void loadQuickSession()
    const unsubscribe = platform.onQuickShown?.(() => {
      void loadQuickSession()
    })
    return () => unsubscribe?.()
  }, [loadQuickSession])

  useEffect(() => {
    void platform.notifyQuickRendererReady?.()
    return () => {
      void platform.notifyQuickRendererGone?.()
    }
  }, [])

  // Portaled popovers leave .quick-chat-shell — flag root early so density CSS applies same paint.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.quickChat = '1'
    return () => {
      delete root.dataset.quickChat
    }
  }, [])

  const currentMessageList = useMemo(() => (session ? getAllMessageList(session) : []), [session])

  const model = useMemo(() => {
    if (session?.settings?.provider && session?.settings?.modelId) {
      return { provider: session.settings.provider, modelId: session.settings.modelId }
    }
    const chat = lastUsedModelStore.getState().chat
    if (chat) {
      return { provider: chat.provider, modelId: chat.modelId }
    }
    return undefined
  }, [session?.settings?.provider, session?.settings?.modelId])
  const modelDisplayName = useMemo(() => getModelDisplayName(providers, model), [model, providers])

  const lastGenerating = useMemo(() => currentMessageList.find((m: Message) => m.generating), [currentMessageList])
  const [liveGen, setLiveGen] = useState(() =>
    session?.id ? isSessionGenerationLive(session.id) || isSessionGenerationActive(session.id) : false
  )
  useEffect(() => {
    if (!session?.id) {
      setLiveGen(false)
      return
    }
    const sid = session.id
    const sync = () => setLiveGen(isSessionGenerationLive(sid) || isSessionGenerationActive(sid))
    sync()
    const unsub = subscribeSessionGenerationLive(sync)
    const id = window.setInterval(sync, 150)
    return () => {
      unsub()
      window.clearInterval(id)
    }
  }, [session?.id, lastGenerating?.id, lastGenerating?.generating])
  const isGenerating = Boolean(lastGenerating?.generating || liveGen)

  const onSelectModel = useCallback(
    (provider: ModelProvider | string, modelId: string) => {
      if (!session) return
      void updateSessionWithMessages(session.id, {
        settings: {
          ...(session.settings || {}),
          provider: provider as ModelProvider,
          modelId,
        },
      })
      lastUsedModelStore.getState().setChatModel(provider as ModelProvider, modelId)
    },
    [session]
  )

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
      if (!session) return
      messageListRef.current?.scrollToBottom('instant')
      await submitNewUserMessage(session.id, {
        newUserMsg: constructedMessage,
        needGenerating,
        onUserMessageReady,
      })
    },
    [session]
  )

  const onStopGenerating = useCallback(() => {
    if (!session) return false
    void import('@/stores/session/stop-generation').then(({ stopSessionGeneration }) =>
      stopSessionGeneration(session.id, lastGenerating)
    )
    return true
  }, [session, lastGenerating])

  const onStartNewThread = useCallback(() => {
    if (!session) return false
    void startNewThread(session.id)
    return true
  }, [session])

  const onRollbackThread = useCallback(() => {
    if (!session) return false
    void removeCurrentThread(session.id)
    return true
  }, [session])

  const openFullApp = useCallback(async () => {
    if (sessionId) {
      await broadcastSessionChanged(sessionId)
      void invalidateAndRefetchSession(sessionId)
      await platform.openSessionInMain?.(sessionId)
      return
    }
    await platform.showMainWindow?.()
  }, [sessionId])

  useEffect(() => {
    if (!session) return
    const tId = window.setTimeout(() => {
      messageListRef.current?.scrollToBottom('auto')
      document.getElementById('message-input')?.focus()
    }, 150)
    return () => window.clearTimeout(tId)
  }, [session?.id])

  useEffect(() => {
    if (!session) return
    messageListRef.current?.scrollToBottom('smooth')
  }, [session?.id, lastGenerating?.id, lastGenerating?.generating])

  if (!sessionId || !session) {
    return (
      <div className="session-shell flex items-center justify-center">
        <Text size="sm" c="dimmed">
          {t('Loading…')}
        </Text>
      </div>
    )
  }

  const quickToggle = shortcuts?.quickToggle || 'Alt+`'
  const shotKey = shortcuts?.screenshotToChat || 'Alt+Shift+S'

  return (
    <div className="session-shell quick-chat-shell">

      <Flex
        align="center"
        gap="xs"
        px="sm"
        py={6}
        className="quick-chat-header shrink-0 bg-[var(--chatbox-background-primary)]"
        style={{ WebkitAppRegion: 'drag' } as CSSProperties}
      >
        <ActionIcon
          variant="subtle"
          size={32}
          color="chatbox-tertiary"
          className="controls mobile-touch-target active:scale-[0.96] transition-transform"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          onClick={() => void openFullApp()}
          aria-label={t('Open full app')}
        >
          <IconMenu2 size={22} />
        </ActionIcon>
        <Flex align="center" justify="center" flex={1} miw={0}>
          <Text
            size="sm"
            fw={600}
            lineClamp={1}
            className="min-w-0 tracking-tight text-[var(--chatbox-tint-primary)]"
            style={{ letterSpacing: '-0.02em', fontSize: '0.95rem' }}
          >
            {t('Quick Chat')}
          </Text>
        </Flex>
        <ActionIcon
          variant="subtle"
          size={40}
          color="chatbox-tertiary"
          style={{ WebkitAppRegion: 'no-drag' } as CSSProperties}
          aria-label={t('Improve writing')}
          title={t('Improve writing')}
          onClick={() => void NiceModal.show('writing-assistant', { initialModel: model })}
        >
          <IconPencil size={20} />
        </ActionIcon>
      </Flex>

      {/* Always mount MessageList so empty state + turns render (never a blank spacer). */}
      <div className="session-thread">
        <MessageList ref={messageListRef} key={`quick-ml-${sessionId}`} currentSession={session} alignToBottom />
      </div>

      <div className="session-dock">
        <div className="session-dock-pad">
          <ChatDockStack
            key={session.id}
            sessionId={session.id}
            generating={isGenerating}
            liveMessage={lastGenerating}
          >
            <ErrorBoundary name="quick-inputbox">
              <InputBox
                key={`quick-input-${session.id}`}
                ref={inputBoxRef}
                sessionId={session.id}
                sessionType={session.type || 'chat'}
                model={model}
                modelDisplayName={modelDisplayName}
                agentMode={session.agentMode ?? false}
                workspaceRoot={session.workspaceRoot}
                generating={isGenerating}
                onSelectModel={onSelectModel}
                onSubmit={onSubmit}
                onStopGenerating={onStopGenerating}
                onStartNewThread={onStartNewThread}
                onRollbackThread={onRollbackThread}
                onToggleAgentMode={(agentMode) => {
                  void updateSessionWithMessages(session.id, { agentMode })
                }}
                onWorkspaceRootChange={(workspaceRoot) => {
                  void updateSessionWithMessages(session.id, { workspaceRoot })
                }}
              />
            </ErrorBoundary>
          </ChatDockStack>
          <SessionStatusBar
            messages={currentMessageList}
            modelLabel={modelDisplayName}
            model={model}
            settings={session.settings}
            providerId={model?.provider}
            generating={isGenerating}
            sessionId={session.id}
            memoryAutoSave={session.settings?.memoryAutoSave}
            compact={true}
          />
          <Flex justify="flex-start" align="center" mt={8} gap="sm" wrap="wrap" className="quick-chat-hints">
            <Text size="xs" c="dimmed" className="inline-flex items-center gap-1.5 flex-wrap">
              <span>{t('Toggle')}</span>
              <ShortcutHint label={quickToggle} />
              <span className="opacity-30 mx-0.5">·</span>
              <span>{t('Screenshot')}</span>
              <ShortcutHint label={shotKey} />
            </Text>
          </Flex>
        </div>
      </div>
    </div>
  )
}
