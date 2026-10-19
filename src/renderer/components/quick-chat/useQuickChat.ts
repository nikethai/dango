import { createMessage, type Message } from '@shared/types'
import type { WritingStyle } from '@shared/types/writing'
import { getMessageText } from '@shared/utils/message'
import { useAtom, useSetAtom } from 'jotai'
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { useProviders } from '@/hooks/useProviders'
import { useScopes } from '@/hooks/useScopes'
import { navigateToSettings } from '@/modals/Settings'
import platform, { platformCapabilities } from '@/platform'
import { router } from '@/router'
import { currentSessionIdAtom, quickPendingCaptureAtom } from '@/stores/atoms'
import {
  broadcastSessionChanged,
  createSession,
  invalidateAndRefetchSession,
  listSessionsMeta,
  useSession,
} from '@/stores/chatStore'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'
import { regenerateInNewFork, submitNewUserMessage } from '@/stores/sessionActions'
import { getAllMessageList, initEmptyChatSession } from '@/stores/sessionHelpers'
import { useSettingsStore } from '@/stores/settingsStore'
import { getModelDisplayName } from '@/utils/modelDisplayName'
import { getModelReadiness, type SelectedModel } from '@/utils/modelReadiness'
import { readQuickSessionSnapshot, resolveQuickSessionId, writeQuickSessionSnapshot } from '@/utils/quickSession'
import type { QuickChatPanelProps } from './QuickChatPanel'
import { isLocalModel, quickChatName, quickErrorSummary, resolveQuickScope, resolveQuickView } from './quickChatState'

const PROVIDER_SETTINGS_PATH = '/settings/provider'

export type UseQuickChat = Omit<QuickChatPanelProps, 'windowed'> & { panelRef: RefObject<HTMLDivElement> }

/** The desktop shell is there (not Tauri Android, web or mobile), so the quick window can hand work to main. */
function hasDesktopShell() {
  return platformCapabilities.supportsDesktopOnlySettings
}

/** Configuring happens in the main window; without a desktop shell this window goes to Settings itself. */
async function openProviderSettings() {
  if (hasDesktopShell() && platform.openInMain) {
    try {
      await platform.openInMain(PROVIDER_SETTINGS_PATH)
      return
    } catch (error) {
      console.error('[quick-chat] open settings in main failed', error)
    }
  }
  navigateToSettings('/provider')
}

/**
 * Quick Chat state. No chat exists until the first Enter; it is created in the chosen scope with the quick model and
 * reused for follow-ups until the scope changes. Reopening within three minutes shows the same chat.
 */
export function useQuickChat(): UseQuickChat {
  const { t } = useTranslation()
  const panelRef = useRef<HTMLDivElement>(null)
  const { providers } = useProviders()
  const { scopes } = useScopes()
  const defaultChatModel = useSettingsStore((s) => s.defaultChatModel)
  const lastUsedChat = useStore(lastUsedModelStore, (s) => s.chat)
  const setCachedSessionId = useSetAtom(currentSessionIdAtom)
  const [capture, setCapture] = useAtom(quickPendingCaptureAtom)

  const [sessionId, setSessionId] = useState<string | null>(null)
  const [scopeId, setScopeId] = useState<string | null>(null)
  const [question, setQuestion] = useState('')
  const [rewrite, setRewrite] = useState<{ option: WritingStyle | null; text: string } | null>(null)
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  const { session } = useSession(sessionId)

  // The scope the current chat was created in: a different scope at the next Enter starts a new chat.
  const chatScopeRef = useRef<string | null>(null)
  const scopesRef = useRef(scopes)
  scopesRef.current = scopes
  const sendingRef = useRef(false)

  // On show: the snapshot chat if it is recent and still exists, otherwise an empty panel in the last scope.
  const loadSnapshot = useCallback(async () => {
    const snapshot = readQuickSessionSnapshot()
    let reuse: string | null = null
    let reuseScope: string | null = null
    if (snapshot?.sessionId) {
      try {
        const list = await listSessionsMeta()
        reuse = resolveQuickSessionId(
          snapshot,
          list.map((item) => item.id)
        )
        reuseScope = list.find((item) => item.id === reuse)?.projectId ?? null
      } catch {
        reuse = null
      }
    }
    const lastScope = resolveQuickScope(snapshot?.lastScopeId ?? null, scopesRef.current)
    if (reuse) {
      setSessionId(reuse)
      setCachedSessionId(reuse)
      setScopeId(lastScope)
      setRewrite(null)
      chatScopeRef.current = reuseScope
      writeQuickSessionSnapshot({ sessionId: reuse, lastOpenedAt: Date.now(), lastScopeId: lastScope })
      return
    }
    setSessionId(null)
    setScopeId(lastScope)
    setRewrite(null)
    chatScopeRef.current = null
  }, [setCachedSessionId])

  useEffect(() => {
    void loadSnapshot()
    const unsubscribe = platform.onQuickShown?.(() => {
      void loadSnapshot()
    })
    return () => unsubscribe?.()
  }, [loadSnapshot])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const update = () => setOnline(navigator.onLine)
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [])

  // Captured clipboard text prefills the question once; pictures wait in the atom until the send.
  useEffect(() => {
    if (capture.text === null) return
    const text = capture.text
    setQuestion(text)
    setCapture((prev) => ({ ...prev, text: null }))
  }, [capture.text, setCapture])

  const model: SelectedModel | undefined = useMemo(() => {
    if (session?.settings?.provider && session.settings.modelId) {
      return { provider: session.settings.provider, modelId: session.settings.modelId }
    }
    if (defaultChatModel) return { provider: defaultChatModel.provider, modelId: defaultChatModel.model }
    return lastUsedChat ? { provider: lastUsedChat.provider, modelId: lastUsedChat.modelId } : undefined
  }, [session?.settings?.provider, session?.settings?.modelId, defaultChatModel, lastUsedChat])

  const readiness = useMemo(() => getModelReadiness(model, providers), [model, providers])
  const local = useMemo(() => isLocalModel(model, providers), [model, providers])
  const view = resolveQuickView({ readiness, online, local, hasExchange: sessionId !== null, rewriting: !!rewrite })

  const messages = useMemo(() => (session ? getAllMessageList(session) : []), [session])
  const last = messages[messages.length - 1] as Message | undefined
  const rawAnswer = last?.role === 'assistant' ? last : undefined
  const lastUser = [...messages].reverse().find((m) => m.role === 'user')
  const askedQuestion = lastUser ? getMessageText(lastUser, false, false) : undefined
  const generating = rawAnswer ? Boolean(rawAnswer.generating) : last?.role === 'user'
  const answer = useMemo(() => {
    if (!rawAnswer?.error) return rawAnswer
    return { ...rawAnswer, error: t(quickErrorSummary(rawAnswer.error, rawAnswer.errorCode)) }
  }, [rawAnswer, t])

  const send = useCallback(async () => {
    const text = question
    const pictureKeys = capture.pictureKeys
    // A captured picture can be sent on its own, as in the main composer (images, no text part).
    if ((!text.trim() && pictureKeys.length === 0) || sendingRef.current) return
    if (view === 'no-model' || view === 'offline' || view === 'rewrite' || !model) return
    sendingRef.current = true
    try {
      let target = sessionId
      if (!target || chatScopeRef.current !== scopeId) {
        const base = initEmptyChatSession()
        const created = await createSession({
          ...base,
          name: quickChatName(text) || base.name,
          projectId: scopeId ?? undefined,
          settings: { ...(base.settings || {}), provider: model.provider, modelId: model.modelId },
        })
        target = created.id
        chatScopeRef.current = scopeId
        setSessionId(target)
        setCachedSessionId(target)
        // The (possibly hidden) main window lists the chat right away.
        void broadcastSessionChanged(target)
      }
      writeQuickSessionSnapshot({ sessionId: target, lastOpenedAt: Date.now(), lastScopeId: scopeId })
      const userMessage = createMessage('user', text)
      for (const storageKey of pictureKeys) {
        userMessage.contentParts.push({ type: 'image', storageKey })
      }
      setQuestion('')
      setCapture({ text: null, pictureKeys: [] })
      try {
        await submitNewUserMessage(target, { newUserMsg: userMessage, needGenerating: true })
      } catch (error) {
        // Give the typed question and pictures back, so nothing the user wrote is lost.
        setQuestion(text)
        setCapture((prev) => ({ text: prev.text, pictureKeys: [...pictureKeys, ...prev.pictureKeys] }))
        throw error
      }
    } catch (error) {
      console.error('[quick-chat] send failed', error)
    } finally {
      sendingRef.current = false
    }
  }, [question, view, model, sessionId, scopeId, capture.pictureKeys, setCachedSessionId, setCapture])

  // Leaving the window (Esc, hotkey, click away) counts as the last look: a long read keeps the chat on reopen.
  const touchSnapshotRef = useRef(() => {})
  touchSnapshotRef.current = () => {
    if (!sessionId) return
    writeQuickSessionSnapshot({ sessionId, lastOpenedAt: Date.now(), lastScopeId: scopeId })
  }
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') touchSnapshotRef.current()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  const onScopeChange = useCallback(
    (id: string | null) => {
      setScopeId(id)
      const snapshot = readQuickSessionSnapshot()
      writeQuickSessionSnapshot({
        sessionId: snapshot?.sessionId ?? sessionId,
        lastOpenedAt: snapshot?.lastOpenedAt ?? Date.now(),
        lastScopeId: id,
      })
    },
    [sessionId]
  )

  // Esc only hides the window: the chat and any running answer keep going.
  const onEsc = useCallback(() => {
    touchSnapshotRef.current()
    if (hasDesktopShell() && platform.hideQuickWindow) {
      platform.hideQuickWindow().catch(() => {
        void router.navigate({ to: '/' })
      })
      return
    }
    void router.navigate({ to: '/' })
  }, [])

  const onRetry = useCallback(() => {
    if (sessionId && rawAnswer?.error) {
      void regenerateInNewFork(sessionId, rawAnswer).catch((error) => {
        console.error('[quick-chat] retry failed', error)
      })
      return
    }
    setOnline(navigator.onLine)
  }, [sessionId, rawAnswer])

  const onContinue = useCallback(() => {
    if (!sessionId) return
    const id = sessionId
    void (async () => {
      try {
        await broadcastSessionChanged(id)
        void invalidateAndRefetchSession(id)
        if (hasDesktopShell() && platform.openSessionInMain) {
          await platform.openSessionInMain(id)
        } else {
          await router.navigate({ to: '/session/$sessionId', params: { sessionId: id } })
        }
      } catch (error) {
        console.error('[quick-chat] continue in chat failed', error)
      }
    })()
  }, [sessionId])

  const onSignIn = useCallback(() => {
    openProviderSettings().catch((error) => {
      console.error('[quick-chat] open settings failed', error)
    })
  }, [])

  // The quick window follows the panel's height (including an open menu).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the no-model view renders a different root node
  useEffect(() => {
    const node = panelRef.current
    if (!node || !platform.setQuickWindowHeight || !hasDesktopShell()) return
    if (typeof ResizeObserver === 'undefined') return
    const push = () => {
      const height = Math.ceil(node.getBoundingClientRect().height)
      if (height > 0) platform.setQuickWindowHeight?.(height).catch(() => undefined)
    }
    const observer = new ResizeObserver(push)
    observer.observe(node)
    push()
    return () => observer.disconnect()
  }, [view === 'no-model'])

  return {
    panelRef,
    view,
    scopes,
    scopeId,
    onScopeChange,
    question,
    askedQuestion,
    onQuestionChange: setQuestion,
    onSubmit: () => {
      void send()
    },
    answer,
    generating,
    modelName: getModelDisplayName(providers, model) || model?.modelId || '',
    pictureCount: capture.pictureKeys.length,
    rewrite,
    onRewrite: (option, text) => setRewrite({ option, text }),
    onRewriteBack: () => setRewrite(null),
    onEsc,
    onRetry,
    onContinue,
    onSignIn,
    model,
  }
}
