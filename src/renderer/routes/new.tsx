import NiceModal from '@ebay/nice-modal-react'
import { Button } from '@mantine/core'
import { toSessionAgentFieldsFromSelection } from '@shared/new-chat-agents'
import { ModelProviderEnum, type Session } from '@shared/types'
import { createFileRoute, useRouterState } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useSetAtom } from 'jotai'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { BeforeSendHost } from '@/components/chat/BeforeSendGate'
import { ChatDropOverlay } from '@/components/chat/ChatDropOverlay'
import { FirstChatSuggestionChips, firstChatChipsShown } from '@/components/chat/EmptyThreadState'
import InputBox, { type InputBoxPayload } from '@/components/InputBox/InputBox'
import Page from '@/components/layout/Page'
import NewChatAgentBar from '@/components/new-chat/NewChatAgentBar'
import { useMyCopilots, useRemoteCopilots } from '@/hooks/useCopilots'
import { useProviders } from '@/hooks/useProviders'
import { useScopes } from '@/hooks/useScopes'
import {
  type DraftSeed,
  isNewPrefill,
  type NewChatSearch,
  NewChatSearchSchema,
  seedDraftFromLink,
} from '@/lib/newChatSearch'
import { scopeKindOf } from '@/packages/chat-settings'
import { resolveDraftScopeId } from '@/projects/scope-navigation'
import * as atoms from '@/stores/atoms'
import { createSession as createSessionStore } from '@/stores/chatStore'
import { submitNewUserMessage, switchCurrentSession } from '@/stores/sessionActions'
import { initEmptyChatSession } from '@/stores/sessionHelpers'
import { useUIStore } from '@/stores/uiStore'

/** Dock center → bottom transition duration (must match CSS). */
const BLANK_DOCK_MOVE_MS = 420

export const Route = createFileRoute('/new')({
  component: Index,
  validateSearch: zodValidator(NewChatSearchSchema),
})

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function Index() {
  const { t } = useTranslation()

  const newSessionState = useUIStore((s) => s.newSessionState)
  const setNewSessionState = useUIStore((s) => s.setNewSessionState)
  const addSessionKnowledgeBase = useUIStore((s) => s.addSessionKnowledgeBase)
  const showCopilotsInNewSession = useUIStore((s) => s.showCopilotsInNewSession)
  const sessionWebBrowsingMap = useUIStore((s) => s.sessionWebBrowsingMap)
  const setSessionWebBrowsing = useUIStore((s) => s.setSessionWebBrowsing)
  const clearSessionWebBrowsing = useUIStore((s) => s.clearSessionWebBrowsing)
  const [session, setSession] = useState<Session>({
    id: 'new',
    ...initEmptyChatSession(),
  })
  /** Draft chat settings (provider options, plan mode); createSession copies them into the new chat's settings. */
  const updateDraftSettings = useCallback((next: Partial<NonNullable<Session['settings']>>) => {
    setSession((old) => ({ ...old, settings: { ...(old.settings || {}), ...next } }))
  }, [])
  const [composerDraft, setComposerDraft] = useState('')
  const [composerKey, setComposerKey] = useState(0)
  /** Center → bottom dock animation in progress (blocks double-submit). */
  const [isSending, setIsSending] = useState(false)

  const { providers } = useProviders()

  const selectedModel = useMemo(() => {
    if (session.settings?.provider && session.settings?.modelId) {
      return {
        provider: session.settings.provider,
        modelId: session.settings.modelId,
      }
    }
  }, [session.settings?.provider, session.settings?.modelId])

  const { copilots: myCopilots } = useMyCopilots()
  const { copilots: remoteCopilots } = useRemoteCopilots()

  const allAgents = useMemo(() => {
    const map = new Map<string, (typeof myCopilots)[0]>()
    for (const agent of myCopilots) map.set(agent.id, agent)
    for (const agent of remoteCopilots || []) {
      if (!map.has(agent.id)) map.set(agent.id, agent)
    }
    return Array.from(map.values())
  }, [myCopilots, remoteCopilots])

  const selectedAgentIds = useMemo(
    () => session.agentIds ?? (session.copilotId ? [session.copilotId] : []),
    [session.agentIds, session.copilotId]
  )

  const selectedAgents = useMemo(
    () => selectedAgentIds.map((id) => allAgents.find((agent) => agent.id === id)).filter(Boolean) as typeof allAgents,
    [selectedAgentIds, allAgents]
  )

  const primaryAgent = selectedAgents[0]

  // Persona inject: only for exactly one agent. Multi uses room per-speaker prompts after create.
  useEffect(() => {
    setSession((old) => {
      if (selectedAgentIds.length === 1 && primaryAgent) {
        return {
          ...old,
          picUrl: primaryAgent.emojiAvatar ? undefined : primaryAgent.picUrl,
          name: primaryAgent.name || 'Untitled',
          messages: [
            {
              id: uuidv4(),
              role: 'system',
              contentParts: [{ type: 'text', text: primaryAgent.prompt || '' }],
            },
          ],
        }
      }
      if (selectedAgentIds.length >= 2 && primaryAgent) {
        return {
          ...old,
          picUrl: primaryAgent.emojiAvatar ? undefined : primaryAgent.picUrl,
          name: primaryAgent.name || 'Untitled',
          messages: initEmptyChatSession().messages,
        }
      }
      return {
        ...old,
        picUrl: undefined,
        name: 'Untitled',
        messages: initEmptyChatSession().messages,
      }
    })
    // primaryAgent identity by id+prompt; avoid full object churn
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedAgentIds.join(','),
    primaryAgent?.id,
    primaryAgent?.prompt,
    primaryAgent?.name,
    primaryAgent?.picUrl,
    primaryAgent?.emojiAvatar,
  ])

  const routerState = useRouterState()
  const { scopes, getScope } = useScopes()
  // Seed once per link, and again only if the link's scope resolves differently once scopes load from storage
  // (or the scope is deleted) while the draft still holds the earlier resolution, so a pill choice is never undone.
  // An unknown or deleted scope starts unscoped.
  const seeded = useRef<DraftSeed>({})
  useEffect(() => {
    const search = routerState.location.search as NewChatSearch
    const scopeId = resolveDraftScopeId(search.scopeId, scopes)
    const previous = seeded.current
    if (previous.search === search && previous.scopeId === scopeId) return
    seeded.current = { search, scopeId }
    const scope = scopes.find((item) => item.id === scopeId)
    setSession((old) => seedDraftFromLink(old, { search, scopeId, scope }, previous))
  }, [routerState.location.search, scopes])

  // A new prefill while /new is already open: show it by remounting the composer with the draft.
  const prefill = (routerState.location.search as NewChatSearch).prefill
  const lastPrefill = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (isNewPrefill(lastPrefill.current, prefill)) {
      setComposerDraft(prefill)
      setComposerKey((k) => k + 1)
    }
    lastPrefill.current = prefill
  }, [prefill])

  // EM3: first-chat suggestions ask about the draft's scope; a pick fills the composer without remounting it.
  const draftScope = getScope(session.projectId)
  const setNewPrefillText = useSetAtom(atoms.inputBoxPrefillTextFamily('new'))
  const composerHasDraft = useUIStore((s) => s.composerHasDraft)

  const handleAgentIdsChange = useCallback((ids: string[]) => {
    const fields = toSessionAgentFieldsFromSelection(ids)
    setSession((old) => ({ ...old, ...fields }))
  }, [])

  const handleSubmit = useCallback(
    async ({ constructedMessage, needGenerating = true, onUserMessageReady }: InputBoxPayload) => {
      if (isSending) return
      setIsSending(true)

      // Center → bottom motion runs in parallel with session create + first message.
      // Never delay create/send behind the animation (that was dropping sends).
      const animDone = prefersReducedMotion()
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            window.setTimeout(resolve, BLANK_DOCK_MOVE_MS)
          })

      try {
        const agentIds = session.agentIds?.length
          ? session.agentIds
          : session.copilotId
            ? [session.copilotId]
            : constructedMessage.mentionedAgentIds

        // Ensure first message can resolve room speakers even without re-@ chips
        const userMsg =
          agentIds && agentIds.length >= 2 && !constructedMessage.mentionedAgentIds?.length
            ? { ...constructedMessage, mentionedAgentIds: agentIds }
            : constructedMessage

        const newSession = await createSessionStore({
          name: session.name,
          type: 'chat',
          assistantAvatarKey: session.assistantAvatarKey,
          picUrl: session.picUrl,
          messages: session.messages,
          copilotId: agentIds?.[0] ?? session.copilotId,
          agentIds,
          roomMode: session.roomMode,
          roomLeadId: agentIds?.[0],
          projectId: session.projectId,
          folderId: session.projectId,
          agentMode: session.agentMode,
          workspaceRoot: session.workspaceRoot,
          settings: session.settings,
        })

        if (newSessionState.knowledgeBase) {
          addSessionKnowledgeBase(newSession.id, newSessionState.knowledgeBase)
          setNewSessionState({})
        }

        const newSessionWebBrowsing = sessionWebBrowsingMap.new
        if (newSessionWebBrowsing !== undefined) {
          setSessionWebBrowsing(newSession.id, newSessionWebBrowsing)
          clearSessionWebBrowsing('new')
        }

        // Start insert + generation immediately so the session is not empty on navigate.
        void submitNewUserMessage(newSession.id, {
          newUserMsg: userMsg,
          needGenerating,
          onUserMessageReady,
        })

        // Let the dock settle at the bottom, then enter the thread.
        await animDone
        switchCurrentSession(newSession.id)
      } catch (err) {
        console.error('Failed to start new chat', err)
        setIsSending(false)
      }
    },
    [
      isSending,
      session,
      addSessionKnowledgeBase,
      newSessionState.knowledgeBase,
      setNewSessionState,
      sessionWebBrowsingMap,
      setSessionWebBrowsing,
      clearSessionWebBrowsing,
    ]
  )

  const onSelectModel = useCallback((provider: string, modelId: string) => {
    setSession((old) => ({
      ...old,
      messages:
        provider === ModelProviderEnum.OpenClaw
          ? old.messages.filter((message) => message.role !== 'system')
          : old.messages,
      settings: {
        ...(old.settings || {}),
        provider,
        modelId,
      },
    }))
  }, [])

  const onClickSessionSettings = useCallback(async () => {
    const res: Session = await NiceModal.show('session-settings', {
      session,
      disableAutoSave: true,
    })
    if (res) {
      setSession((old) => ({
        ...old,
        ...res,
      }))
    }
    return true
  }, [session])

  return (
    <Page title="">
      <div className={`session-shell blank-home dg-drop-host${isSending ? ' blank-home--sending' : ''}`}>
        <ChatDropOverlay />
        <div className="blank-home-grow blank-home-grow-top" aria-hidden />

        <div className="blank-home-cluster">
          <div className="blank-home-greeting">
            <h1 className="blank-title blank-enter">{t('Ready when you are')}</h1>
            {!providers.length && (
              <Button
                size="sm"
                variant="light"
                color="chatbox-brand"
                className="blank-enter blank-setup-cta"
                style={{ animationDelay: '80ms' }}
                onClick={() => {
                  void import('@/router').then(({ router }) => router.navigate({ to: '/settings/provider' }))
                }}
              >
                {t('Setup Provider')}
              </Button>
            )}
          </div>
          {!isSending && firstChatChipsShown({ sessionType: 'chat', composerHasDraft }) ? (
            <FirstChatSuggestionChips
              scopeName={draftScope?.name}
              scopeKind={draftScope ? scopeKindOf(draftScope) : null}
              onPick={setNewPrefillText}
            />
          ) : null}

          <div className="session-dock blank-home-dock">
            <div className="session-dock-pad flex flex-col gap-3">
              {showCopilotsInNewSession ? (
                <NewChatAgentBar agents={allAgents} selectedIds={selectedAgentIds} onChange={handleAgentIdsChange} />
              ) : null}

              <InputBox
                key={`new-composer-${composerKey}`}
                sessionType="chat"
                sessionId="new"
                model={selectedModel}
                agentMode={session.agentMode ?? false}
                workspaceRoot={session.workspaceRoot}
                initialMessage={composerDraft}
                draftAgentIds={selectedAgentIds}
                onDraftAgentIdsChange={handleAgentIdsChange}
                draftRoomMode={session.roomMode === 'swarm' ? 'swarm' : undefined}
                draftSettings={session.settings}
                onDraftSettingsChange={updateDraftSettings}
                planMode={session.settings?.planMode ?? false}
                onPlanModeChange={(planMode) => updateDraftSettings({ planMode })}
                onDraftRoomModeChange={(mode) => setSession((old) => ({ ...old, roomMode: mode }))}
                onSelectModel={onSelectModel}
                onToggleAgentMode={(agentMode) => setSession((old) => ({ ...old, agentMode }))}
                onWorkspaceRootChange={(workspaceRoot) => setSession((old) => ({ ...old, workspaceRoot }))}
                browserArmed={session.browserArmed ?? false}
                onBrowserArmedChange={(browserArmed) => setSession((old) => ({ ...old, browserArmed }))}
                computerArmed={session.computerArmed ?? false}
                onComputerArmedChange={(computerArmed) => setSession((old) => ({ ...old, computerArmed }))}
                onClickSessionSettings={onClickSessionSettings}
                onSubmit={handleSubmit}
                scopeId={session.projectId}
                onScopeChange={(projectId) => setSession((old) => ({ ...old, projectId }))}
              />
            </div>
          </div>
        </div>

        <div className="blank-home-grow blank-home-grow-bottom" aria-hidden />
        {/* The composer's before-send cost sheet. */}
        <BeforeSendHost />
      </div>
    </Page>
  )
}
