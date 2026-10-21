import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Flex, Stack, Text } from '@mantine/core'
import type { Session, SessionThreadBrief } from '@shared/types'
import { isEverywhere } from '@shared/types/scope'
import {
  IconAlignRight,
  IconArrowDown,
  IconChevronLeft,
  IconChevronRight,
  IconListTree,
  IconMessagePlus,
  IconPencil,
  IconSwitch3,
  IconTrash,
} from '@tabler/icons-react'
import { useAtomValue, useSetAtom } from 'jotai'
import { throttle } from 'lodash'
import {
  type FC,
  forwardRef,
  memo,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { type StateSnapshot, Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { platformTypeAtom } from '@/hooks/useNeedRoomForWinControls'
import { useScopes } from '@/hooks/useScopes'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { cn } from '@/lib/utils'
import { getShowThinking, scopeKindOf } from '@/packages/chat-settings'
import { isPlanModeOn, planContinueState, planModeToggleShown } from '@/packages/plan/planSteps'
import { thinkingOpenByDefault } from '@/packages/thinking/thinking'
import { platformCapabilities } from '@/platform'
import * as atoms from '@/stores/atoms'
import { turnOnChatPlanMode } from '@/stores/session/plan-mode'
import { useSwarmLive } from '@/stores/session/team-room-state'
import {
  deleteFork,
  expandFork,
  moveThreadToConversations,
  removeMessage,
  removeThread,
  switchFork,
  switchThread,
} from '@/stores/sessionActions'
import { getAllMessageList, getCurrentThreadHistoryHash } from '@/stores/sessionHelpers'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { useUIStore } from '@/stores/uiStore'
import { isThreadVisuallyEmpty } from '@/utils/chat-starters'
import { motionScrollBehavior } from '@/utils/scrollBehavior'
import ActionMenu from '../ActionMenu'
import { ErrorBoundary } from '../common/ErrorBoundary'
import { ScalableIcon } from '../common/ScalableIcon'
import { BlockCodeCollapsedStateProvider } from '../Markdown'
import EmptyThreadState, { firstChatChipsShown } from './EmptyThreadState'
import Message from './Message'
import SummaryMessage from './SummaryMessage'
import { foldSwarmRuns } from './swarm/foldSwarmRuns'
import { SwarmLiveCard } from './swarm/SwarmLiveCard'
import { SwarmWorkedWith } from './swarm/SwarmWorkedWith'

// LRU-like cache with max size to prevent unbounded memory growth
const MAX_SCROLL_CACHE_SIZE = 100
const sessionScrollPositionCache = new Map<string, StateSnapshot>()

function setScrollPosition(sessionId: string, snapshot: StateSnapshot) {
  // Delete and re-add to move to end (most recently used)
  sessionScrollPositionCache.delete(sessionId)
  sessionScrollPositionCache.set(sessionId, snapshot)

  // Evict oldest entries if over limit
  if (sessionScrollPositionCache.size > MAX_SCROLL_CACHE_SIZE) {
    const firstKey = sessionScrollPositionCache.keys().next().value
    if (firstKey) {
      sessionScrollPositionCache.delete(firstKey)
    }
  }
}

// Export cleanup function for use when sessions are deleted
export function clearScrollPositionCache(sessionId: string) {
  sessionScrollPositionCache.delete(sessionId)
}

export interface MessageListRef {
  scrollToTop: (behavior?: ScrollBehavior) => void
  scrollToBottom: (behavior?: ScrollBehavior) => void
}

export interface MessageListProps {
  className?: string
  currentSession: Session
  /** Stick conversation to bottom (compact / quick chat panels) */
  alignToBottom?: boolean
}

/** Legacy discuss/work room turns sit in a compact group; Swarm turns fold into one item instead. */
function isTeamRoomCompactRole(msg: { role?: string; roomRole?: string; swarm?: unknown } | undefined): boolean {
  if (!msg || msg.role !== 'assistant' || msg.swarm) return false
  return msg.roomRole === 'turn' || msg.roomRole === 'plan' || msg.roomRole === 'review'
}

const MessageList = forwardRef<MessageListRef, MessageListProps>((props, ref) => {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()

  const { currentSession, alignToBottom = false } = props
  // Streaming turns still grow (answer text). Keep a light follow when at bottom so
  // the thread feels stuck to the latest token — work strip stays collapsed so this
  // no longer thrashes like the old auto-expand tool UI.
  const isStreaming = useMemo(
    () => currentSession.messages?.some((m) => m.generating) === true,
    [currentSession.messages]
  )

  // Finished thinking text starts open or closed per the Show thinking setting and the scope kind
  // (client scopes default closed under 'auto'). Everywhere / no scope → null.
  const showThinking = useSettingsStore((state) => getShowThinking(state))
  const { getScope } = useScopes()
  const scopeId = currentSession.projectId ?? currentSession.folderId
  const scope = isEverywhere(scopeId) ? undefined : getScope(scopeId)
  const thinkingDefaultOpen = thinkingOpenByDefault(showThinking, scope ? scopeKindOf(scope) : null)

  const currentThreadHash = useMemo(
    () => currentSession && getCurrentThreadHistoryHash(currentSession),
    [currentSession]
  )
  // System prompts are config (Session options), not conversation turns.
  // Never render them as bubbles — product threads only show user/assistant/tool.
  const allMessages = useMemo(() => {
    return getAllMessageList(currentSession).filter((message) => message.role !== 'system')
  }, [currentSession])
  // A Swarm run shows as one item: its answer with "Worked with" below, or the live card while it runs.
  const swarmFold = useMemo(() => foldSwarmRuns(allMessages), [allMessages])
  const currentMessageList = swarmFold.visible
  const swarmLive = useSwarmLive(currentSession.id)
  // A fork made on a folded turn (Redo of an answer forks at the turn before it) keeps its switcher on the run's item.
  const forksMovedTo = useMemo(() => {
    const moved: Record<string, string[]> = {}
    const forks = currentSession.messageForksHash
    if (!forks || currentMessageList === allMessages) return moved
    const visibleIds = new Set(currentMessageList.map((m) => m.id))
    let pending: string[] = []
    for (const m of allMessages) {
      if (visibleIds.has(m.id)) {
        if (pending.length > 0) {
          moved[m.id] = pending
          pending = []
        }
      } else if ((forks[m.id]?.lists.length ?? 0) > 1) {
        pending.push(m.id)
      }
    }
    return moved
  }, [allMessages, currentMessageList, currentSession.messageForksHash])

  const latestSummaryMessageId = useMemo(() => {
    for (let i = currentMessageList.length - 1; i >= 0; i--) {
      if (currentMessageList[i].isSummary) {
        return currentMessageList[i].id
      }
    }
    return null
  }, [currentMessageList])

  // Follow-up suggestions are model-backed and would otherwise fire once per
  // historical assistant message with citations — restrict them to the latest.
  const latestAssistantMessageId = useMemo(() => {
    for (let i = currentMessageList.length - 1; i >= 0; i--) {
      if (currentMessageList[i].role === 'assistant') {
        return currentMessageList[i].id
      }
    }
    return null
  }, [currentMessageList])

  // Only the latest plan's card reads the session's tasks (older plan cards keep their own steps).
  const latestPlanMessageId = useMemo(() => {
    for (let i = currentMessageList.length - 1; i >= 0; i--) {
      if (currentMessageList[i].contentParts?.some((part) => part.type === 'plan')) {
        return currentMessageList[i].id
      }
    }
    return null
  }, [currentMessageList])
  // A plan edits files only in agent mode with a project or workspace: its card says so.
  const planTouchesFiles = Boolean(
    currentSession.agentMode && (currentSession.projectId || currentSession.workspaceRoot)
  )
  // Continue on a stopped plan: only the latest plan, while it is the chat's last message and nothing generates.
  const lastMessageId = currentMessageList.at(-1)?.id
  const planModeOn = isPlanModeOn(currentSession)
  // A Continue blocked by plan mode offers to turn it back on (with Agent Mode); Continue stays a separate click.
  // Only where the composer has the toggle: desktop settings, not a multi-agent room.
  const onTurnOnPlanMode = useCallback(() => turnOnChatPlanMode(currentSession.id), [currentSession.id])
  const turnOnPlanModeOffered = planModeToggleShown(currentSession, platformCapabilities.supportsDesktopOnlySettings)
  const planContinueFor = (messageId: string) =>
    planContinueState({
      latestPlan: messageId === latestPlanMessageId,
      isTail: messageId === lastMessageId,
      generationActive: isStreaming,
      planModeOn,
    })

  const virtuoso = useRef<VirtuosoHandle>(null)
  const messageListRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)

  const setMessageListElement = useUIStore((s) => s.setMessageListElement)
  const setMessageScrolling = useUIStore((s) => s.setMessageScrolling)
  const setMessageScrollingAtBottom = useUIStore((s) => s.setMessageScrollingAtBottom)

  const handleAtBottomStateChange = useCallback(
    (bottom: boolean) => {
      setAtBottom(bottom)
      setMessageScrollingAtBottom(bottom)
    },
    [setMessageScrollingAtBottom]
  )

  const threadEmpty = useMemo(() => isThreadVisuallyEmpty(currentMessageList), [currentMessageList])
  const composerHasDraft = useUIStore((s) => s.composerHasDraft)

  const handleJumpToLatest = useCallback(() => {
    virtuoso.current?.scrollTo({ top: Infinity, behavior: motionScrollBehavior() })
  }, [])

  const setPrefillText = useSetAtom(atoms.inputBoxPrefillTextFamily(currentSession.id))
  const handlePickStarter = useCallback(
    (fill: string) => {
      setPrefillText(fill)
    },
    [setPrefillText]
  )

  // biome-ignore lint/correctness/useExhaustiveDependencies:
  useEffect(() => {
    setMessageScrolling(virtuoso)
    const currentVirtuoso = virtuoso.current // virtuoso.current null
    return () => {
      currentVirtuoso?.getState((state) => {
        if (state.ranges.length > 0) {
          // (legacy comment)
          setScrollPosition(currentSession.id, state)
        }
      })
    }
  }, [])
  // biome-ignore lint/correctness/useExhaustiveDependencies:
  useEffect(() => {
    setMessageListElement(messageListRef)
  }, [])

  const platformType = useAtomValue(platformTypeAtom)

  useImperativeHandle(ref, () => ({
    scrollToTop: (behavior = 'auto') => virtuoso.current?.scrollTo({ top: 0, behavior }),
    scrollToBottom: (behavior = 'auto') => virtuoso.current?.scrollTo({ top: Infinity, behavior }),
  }))

  return (
    <div className={cn('w-full h-full mx-auto', props.className)}>
      <BlockCodeCollapsedStateProvider defaultCollapsed={!!settingsStore.getState().autoCollapseCodeBlock}>
        <div className="overflow-hidden h-full relative" ref={messageListRef}>
          {threadEmpty ? (
            <EmptyThreadState
              sessionName={currentSession.name}
              onPickStarter={handlePickStarter}
              scopeName={scope?.name}
              scopeKind={scope ? scopeKindOf(scope) : null}
              compact={alignToBottom || isSmallScreen}
              showSuggestions={firstChatChipsShown({ sessionType: currentSession.type, composerHasDraft })}
            />
          ) : (
            <Virtuoso
              // Full session reserves gutter so layout does not jump; quick chat is
              // narrow — stable gutter + any min-content overflow shows a useless X bar.
              style={alignToBottom ? undefined : { scrollbarGutter: 'stable' }}
              className={cn(
                platformType === 'win32' && 'scrollbar-custom',
                alignToBottom && 'message-list-scroller--no-x'
              )}
              data={currentMessageList}
              ref={virtuoso}
              // Identity by message id so append/stream does not recycle the wrong row.
              computeItemKey={(_index, msg) => msg.id}
              // Stick to bottom while user is already there. Prefer 'auto' always — 'smooth'
              // restarts every paint and feels cheap. Fixed work-strip height keeps deltas small.
              followOutput={(isAtBottom) => (isAtBottom ? 'auto' : false)}
              atBottomStateChange={handleAtBottomStateChange}
              atBottomThreshold={72}
              alignToBottom={alignToBottom}
              {...(sessionScrollPositionCache.has(currentSession.id) && !alignToBottom
                ? {
                    restoreStateFrom: sessionScrollPositionCache.get(currentSession.id),
                    // (legacy comment)
                    initialScrollTop: sessionScrollPositionCache.get(currentSession.id)?.scrollTop,
                  }
                : {
                    initialTopMostItemIndex: Math.max(0, currentMessageList.length - 1),
                  })}
              // Keep overscan/itemHeight stable — flipping them on generating→idle remeasures the thread.
              increaseViewportBy={{ top: 200, bottom: 260 }}
              defaultItemHeight={100}
              skipAnimationFrameInResizeObserver={isStreaming}
              itemContent={(index, msg) => {
                const prevMsg = index > 0 ? currentMessageList[index - 1] : undefined
                const nextMsg = currentMessageList[index + 1]
                const isTeamDiscussRole = isTeamRoomCompactRole(msg)
                const prevIsTeamDiscussRole = isTeamRoomCompactRole(prevMsg)
                const nextIsTeamDiscussRole = isTeamRoomCompactRole(nextMsg)
                const discussionGroupStart = Boolean(isTeamDiscussRole && !prevIsTeamDiscussRole)
                const discussionGroupEnd = Boolean(isTeamDiscussRole && !nextIsTeamDiscussRole)
                const isCompactRoomTurn = isTeamDiscussRole
                const swarmRun = swarmFold.anchorOf[msg.id] ? swarmFold.runs[swarmFold.anchorOf[msg.id]] : undefined
                // Only the run that is running right now gets the live card (an earlier stopped run never does).
                const swarmCard = swarmRun ? (
                  swarmLive?.runId === swarmRun.runId ? (
                    <SwarmLiveCard sessionId={currentSession.id} runId={swarmRun.runId} />
                  ) : (
                    <SwarmWorkedWith run={swarmRun} />
                  )
                ) : null
                const forkNavIds = [
                  ...(forksMovedTo[msg.id] ?? []),
                  ...((currentSession.messageForksHash?.[msg.id]?.lists.length ?? 0) > 1 ? [msg.id] : []),
                ]
                return (
                  <Stack
                    key={msg.id}
                    gap={0}
                    className={cn(
                      'chat-col',
                      index === 0 && 'pt-2',
                      isCompactRoomTurn &&
                        'bg-[var(--chatbox-background-secondary,#16161a)]/35 border-x border-[var(--chatbox-border-primary,#2a2a32)] px-2',
                      discussionGroupStart && 'mt-1 rounded-t-lg border-t pt-2',
                      discussionGroupEnd && 'mb-1 rounded-b-lg border-b pb-2'
                    )}
                  >
                    {currentThreadHash[msg.id] && (
                      <ThreadLabel thread={currentThreadHash[msg.id]} sessionId={currentSession.id} />
                    )}
                    <ErrorBoundary name={`message-item`}>
                      {swarmRun && swarmRun.answerId !== msg.id ? (
                        swarmCard
                      ) : msg.isSummary ? (
                        <SummaryMessage
                          msg={msg}
                          className={index === 0 ? 'pt-4' : index === currentMessageList.length - 1 ? '!pb-4' : ''}
                          isLatestSummary={msg.id === latestSummaryMessageId}
                          onDelete={() => removeMessage(currentSession.id, msg.id)}
                          sessionId={currentSession.id}
                        />
                      ) : (
                        <Message
                          id={msg.id}
                          msg={msg}
                          sessionId={currentSession.id}
                          sessionType={currentSession.type || 'chat'}
                          className={cn(
                            index === 0 ? 'pt-4' : index === currentMessageList.length - 1 ? '!pb-4' : '',
                            isCompactRoomTurn && '!pt-1 !pb-1'
                          )}
                          collapseThreshold={msg.role === 'system' ? 150 : undefined}
                          buttonGroup={
                            // Quick chat (alignToBottom): no per-message chrome / More menu
                            alignToBottom
                              ? 'none'
                              : index === currentMessageList.length - 1 && msg.role === 'assistant'
                                ? 'always'
                                : 'auto'
                          }
                          assistantAvatarKey={currentSession.assistantAvatarKey}
                          sessionPicUrl={currentSession.picUrl}
                          discussionGroupStart={discussionGroupStart}
                          showFollowUpSuggestions={msg.id === latestAssistantMessageId}
                          thinkingDefaultOpen={thinkingDefaultOpen}
                          planTouchesFiles={planTouchesFiles}
                          latestPlan={msg.id === latestPlanMessageId}
                          planContinue={planContinueFor(msg.id)}
                          onTurnOnPlanMode={turnOnPlanModeOffered ? onTurnOnPlanMode : undefined}
                        />
                      )}
                      {swarmRun && swarmRun.answerId === msg.id ? swarmCard : null}
                    </ErrorBoundary>
                    {forkNavIds.map((forkId) => {
                      const forks = currentSession.messageForksHash?.[forkId]
                      return forks ? (
                        <Flex key={forkId} justify="flex-end" mt={4} pr="md" mr="md" className="self-end">
                          <ForkNav sessionId={currentSession.id} msgId={forkId} forks={forks} />
                        </Flex>
                      ) : null
                    })}
                  </Stack>
                )
              }}
            />
          )}
          {!threadEmpty && !atBottom && !alignToBottom ? (
            <button
              type="button"
              className="thread-jump-latest"
              onClick={handleJumpToLatest}
              aria-label={t('Jump to latest')}
            >
              <IconArrowDown size={15} stroke={1.75} aria-hidden />
              <span>{t('Latest')}</span>
            </button>
          ) : null}
        </div>
      </BlockCodeCollapsedStateProvider>
    </div>
  )
})

export default memo(MessageList)

function ForkNav(props: { sessionId: string; msgId: string; forks: NonNullable<Session['messageForksHash']>[string] }) {
  const { sessionId, msgId, forks } = props
  const [flash, setFlash] = useState(false)
  const prevLength = useRef(forks.lists.length)
  const { t } = useTranslation()

  useEffect(() => {
    if (forks.lists.length > prevLength.current) {
      setFlash(true)
      const timer = setTimeout(() => setFlash(false), 2000)
      return () => clearTimeout(timer)
    }
    prevLength.current = forks.lists.length
  }, [forks.lists.length])

  return (
    <Flex gap="xs" align="center">
      <ActionIcon
        variant="subtle"
        size={20}
        radius="xl"
        color={flash ? 'chatbox-secondary' : 'chatbox-tertiary'}
        onClick={() => void switchFork(sessionId, msgId, 'prev')}
      >
        <IconChevronLeft />
      </ActionIcon>
      <ActionMenu
        position="bottom"
        items={[
          {
            text: t('Expand'),
            icon: IconAlignRight,
            onClick: () => expandFork(sessionId, msgId),
          },
          {
            divider: true,
          },
          {
            doubleCheck: true,
            text: t('Delete'),
            icon: IconTrash,
            color: 'chatbox-error',
            onClick: () => deleteFork(sessionId, msgId),
          },
        ]}
      >
        <Text c={flash ? 'chatbox-secondary' : 'chatbox-tertiary'} size="xs" className="cursor-pointer">
          {forks.position + 1} / {forks.lists.length}
        </Text>
      </ActionMenu>
      <ActionIcon
        variant="subtle"
        size={20}
        radius="xl"
        color={flash ? 'chatbox-secondary' : 'chatbox-tertiary'}
        onClick={() => switchFork(sessionId, msgId, 'next')}
      >
        <IconChevronRight />
      </ActionIcon>
    </Flex>
  )
}

type ThreadLabelProps = {
  sessionId: string
  thread: SessionThreadBrief
}
const ThreadLabel: FC<ThreadLabelProps> = memo(({ thread, sessionId }) => {
  const { t } = useTranslation()
  const setShowHistoryDrawer = useSetAtom(atoms.showThreadHistoryDrawerAtom)

  const handleOpenHistoryDrawer = useCallback(() => {
    setShowHistoryDrawer(thread.id || true)
  }, [setShowHistoryDrawer, thread.id])

  const handleEditThreadName = useCallback(async () => {
    if (!thread.id) return
    await NiceModal.show('thread-name-edit', { sessionId, threadId: thread.id })
  }, [thread.id])

  const handleContinueThread = useCallback(() => {
    if (!thread.id) return
    void switchThread(sessionId, thread.id)
  }, [sessionId, thread.id])

  const handleMoveToConversations = useCallback(() => {
    if (!thread.id) return
    void moveThreadToConversations(sessionId, thread.id)
  }, [sessionId, thread.id])

  const handleDeleteThread = useCallback(() => {
    if (!thread.id) return
    void removeThread(sessionId, thread.id)
  }, [sessionId, thread.id])

  return (
    <div className="text-center pb-4 pt-8">
      <ActionMenu
        position="bottom"
        items={[
          {
            text: t('Edit Thread Name'),
            icon: IconPencil,
            onClick: handleEditThreadName,
          },
          {
            text: t('Show in Thread List'),
            icon: IconListTree,
            onClick: handleOpenHistoryDrawer,
          },
          {
            text: t('Continue this thread'),
            icon: IconSwitch3,
            onClick: handleContinueThread,
          },
          {
            text: t('Move to Conversations'),
            icon: IconMessagePlus,
            onClick: handleMoveToConversations,
          },
          { divider: true },
          {
            doubleCheck: true,
            text: t('Delete'),
            icon: IconTrash,
            onClick: handleDeleteThread,
          },
        ]}
      >
        <span
          className="cursor-pointer font-bold border-solid border rounded-xxl py-2 px-3 border-slate-400/25"
          onDoubleClick={handleOpenHistoryDrawer}
          // onClick={onClick}
        >
          <span className="pr-1 opacity-60">#</span>
          <span className="truncate inline-block align-bottom max-w-[calc(50%-4rem)] md:max-w-[calc(30%-4rem)]">
            {thread.name || t('New Thread')}
          </span>
          {thread.createdAtLabel && <span className="pl-1 opacity-60 text-xs">{thread.createdAtLabel}</span>}
        </span>
      </ActionMenu>
    </div>
  )
})
