import type { DragEndEvent } from '@dnd-kit/core'
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { restrictToVerticalAxis } from '@dnd-kit/modifiers'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import NiceModal from '@ebay/nice-modal-react'
import { ActionIcon, Text, Tooltip, UnstyledButton } from '@mantine/core'
import type { Folder, Scope, SessionMeta } from '@shared/types'
import { IconArchive, IconChevronDown, IconFolderPlus, IconTrash, IconX } from '@tabler/icons-react'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import clsx from 'clsx'
import type { MutableRefObject, ReactNode } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Virtuoso } from 'react-virtuoso'
import { useFolders } from '@/hooks/useFolders'
import { useScopes } from '@/hooks/useScopes'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { startNewChat } from '@/lib/startNewChat'
import { getEffectiveProjectId } from '@/projects/project-context'
import { deleteScopeOrToast, moveSessionToScopeOrToast } from '@/projects/scope-feedback'
import { updateSessionList, useSessionList } from '@/stores/chatStore'
import { useUIStore } from '@/stores/uiStore'
import { DeleteScopeSheet } from '../scope/DeleteScopeSheet'
import { EverywhereRow } from '../scope/EverywhereRow'
import FolderItem from './FolderItem'
import SessionItem from './SessionItem'
import {
  ALL_FOLDER_KEY,
  type DayBucket,
  folderDropId,
  groupSessionsByDay,
  groupSessionsByScope,
  parseDropTargetId,
  RECENTS_COACHING_THRESHOLD,
  RECENTS_DROP_ID,
  reorderSessionsInSubset,
} from './session-list-helpers'

type Props = {
  onCreateProject?(): void
  sessionListViewportRef: MutableRefObject<HTMLDivElement | null>
  showArchived?: boolean
  onShowArchivedChange?(show: boolean): void
  /** Mobile collapses Projects empty promo and prioritizes Recents. */
  density?: 'desktop' | 'mobile'
}

type FolderGroup = {
  count: number
  emoji?: string
  implicit?: boolean
  key: string
  name: string
  sessions: SessionMeta[]
}

/** Keep rows mounted briefly so exit animation can play before Virtuoso drops them. */
const SECTION_COLLAPSE_MS = 170

type CollapsiblePhase = 'idle' | 'entering' | 'exiting'

type RowItem =
  | {
      animPhase?: CollapsiblePhase
      folder: FolderGroup
      type: 'folder'
    }
  | {
      animPhase?: CollapsiblePhase
      type: 'everywhere'
    }
  | {
      animPhase?: CollapsiblePhase
      folderKey: string
      nested?: boolean
      session: SessionMeta
      type: 'session'
    }
  | {
      animPhase?: CollapsiblePhase
      type: 'empty'
      key: string
      message: string
    }
  | {
      animPhase?: CollapsiblePhase
      type: 'day'
      key: string
      label: string
    }
  | {
      animPhase?: CollapsiblePhase
      type: 'coaching'
      key: string
      message: string
    }

function useCollapsibleSection(initialOpen = true) {
  const [open, setOpen] = useState(initialOpen)
  const [phase, setPhase] = useState<CollapsiblePhase>('idle')
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
      }
    },
    []
  )

  const clearPhaseTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const runPhase = useCallback(
    (next: CollapsiblePhase) => {
      clearPhaseTimer()
      setPhase(next)
      if (next === 'idle') {
        return
      }
      timerRef.current = setTimeout(() => {
        setPhase('idle')
        timerRef.current = null
      }, SECTION_COLLAPSE_MS)
    },
    [clearPhaseTimer]
  )

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false)
      runPhase('exiting')
      return
    }
    setOpen(true)
    runPhase('entering')
  }, [open, runPhase])

  const ensureOpen = useCallback(() => {
    clearPhaseTimer()
    setPhase('idle')
    setOpen(true)
  }, [clearPhaseTimer])

  return {
    open,
    phase,
    contentVisible: open || phase === 'exiting',
    toggle,
    ensureOpen,
  }
}

function AnimRow({ phase, children }: { phase?: CollapsiblePhase | 'idle'; children: ReactNode }) {
  return (
    <div className={clsx('rail-row-anim', phase === 'entering' && 'is-entering', phase === 'exiting' && 'is-exiting')}>
      {children}
    </div>
  )
}

type SectionRow =
  | {
      type: 'section'
      key: string
      label: string
      open: boolean
      onToggle: () => void
      droppableId?: string
      trailing?: ReactNode
    }
  | RowItem

function dayBucketLabel(bucket: DayBucket, t: (key: string) => string): string {
  switch (bucket) {
    case 'today':
      return t('Today')
    case 'yesterday':
      return t('Yesterday')
    case 'older':
      return t('Older')
    default:
      return t('Older')
  }
}

export default function SessionList({
  sessionListViewportRef,
  showArchived = false,
  onShowArchivedChange,
  onCreateProject,
  density = 'desktop',
}: Props) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const isMobileDensity = density === 'mobile' || isSmallScreen
  const { sessionMetaList: sortedSessions, refetch } = useSessionList()
  const { folders } = useFolders()
  const { scopes, removeScope, putScope } = useScopes()
  const [deletingScopeId, setDeletingScopeId] = useState<string>()
  const deletingScope = scopes.find((scope) => scope.id === deletingScopeId)
  const routerState = useRouterState()
  const navigate = useNavigate()
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({})
  /** Per-folder enter/exit animation phase (only while toggling). */
  const [folderPhase, setFolderPhase] = useState<Record<string, CollapsiblePhase>>({})
  const folderPhaseTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  // Mobile: Projects collapsed by default so Recents own the first screen.
  const projectsSection = useCollapsibleSection(!isMobileDensity)
  const recentsSection = useCollapsibleSection(true)

  const sensors = useSensors(
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 250,
        tolerance: 10,
      },
    }),
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 10,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  const visibleSessions = useMemo(
    () => (sortedSessions || []).filter((session) => Boolean(session.archived) === showArchived),
    [showArchived, sortedSessions]
  )

  const { projectGroups, historySessions } = useMemo(() => {
    const { groups: scoped, unscoped } = groupSessionsByScope(scopes, visibleSessions)
    const byScope = new Map(scoped.map((group) => [group.scope.id, group.sessions]))

    return {
      projectGroups: folders.map<FolderGroup>((folder) => {
        const sessions = byScope.get(folder.id) ?? []
        return { key: folder.id, name: folder.name, emoji: folder.emoji, count: sessions.length, sessions }
      }),
      historySessions: unscoped,
    }
  }, [folders, scopes, visibleSessions])

  // DnD subsets keyed by folder (or ALL for recents)
  const groups = useMemo<FolderGroup[]>(() => {
    const next: FolderGroup[] = [
      {
        key: ALL_FOLDER_KEY,
        name: t('Recents'),
        count: historySessions.length,
        sessions: historySessions,
        implicit: true,
      },
      ...projectGroups,
    ]
    return next
  }, [historySessions, projectGroups, t])

  const recentsCoachingDismissed = useUIStore((s) => s.recentsCoachingDismissed)
  const setRecentsCoachingDismissed = useUIStore((s) => s.setRecentsCoachingDismissed)

  const showRecentsCoaching =
    !showArchived &&
    !recentsCoachingDismissed &&
    projectGroups.length > 0 &&
    historySessions.length >= RECENTS_COACHING_THRESHOLD

  const rowItems = useMemo<SectionRow[]>(() => {
    const rows: SectionRow[] = []
    const projectsPhase = projectsSection.phase
    const recentsPhase = recentsSection.phase

    // Projects — always visible
    rows.push({
      type: 'section',
      key: 'projects',
      label: t('Scopes'),
      open: projectsSection.open,
      onToggle: projectsSection.toggle,
      // Single New Project control lives here (not in a top tools strip)
      trailing: onCreateProject ? (
        <Tooltip label={t('New scope')} openDelay={400} withArrow>
          <ActionIcon
            variant="subtle"
            color="chatbox-tertiary"
            size={26}
            radius="sm"
            className="active:scale-[0.96] transition-transform rail-section-add"
            onClick={(e) => {
              e.stopPropagation()
              onCreateProject()
            }}
            aria-label={t('New scope')}
          >
            <IconFolderPlus size={15} stroke={1.5} />
          </ActionIcon>
        </Tooltip>
      ) : undefined,
    })

    if (projectsSection.contentVisible) {
      rows.push({ type: 'everywhere', animPhase: projectsPhase })
      if (projectGroups.length === 0) {
        // Desktop keeps the empty coaching card; mobile only shows the section header +
        if (!isMobileDensity) {
          rows.push({
            type: 'empty',
            key: 'projects-empty',
            message: t('No scopes yet'),
            animPhase: projectsPhase,
          })
        }
      } else {
        for (const group of projectGroups) {
          const folderOpen = expandedFolders[group.key] ?? true
          const thisFolderPhase = folderPhase[group.key] ?? 'idle'
          const folderContentVisible = folderOpen || thisFolderPhase === 'exiting'
          rows.push({
            type: 'folder',
            folder: group,
            animPhase: projectsPhase,
          })
          if (folderContentVisible) {
            // Prefer folder-level anim; section collapse still drives exit for nested chats.
            const sessionPhase: CollapsiblePhase =
              projectsPhase === 'exiting' || projectsPhase === 'entering' ? projectsPhase : thisFolderPhase
            for (const session of group.sessions) {
              rows.push({
                type: 'session',
                session,
                folderKey: group.key,
                nested: true,
                animPhase: sessionPhase,
              })
            }
          }
        }
      }
    }

    // Recents — unfiled sessions
    rows.push({
      type: 'section',
      key: 'recents',
      label: showArchived ? t('Archived') : t('Recents'),
      open: recentsSection.open,
      onToggle: recentsSection.toggle,
      droppableId: showArchived ? undefined : RECENTS_DROP_ID,
      trailing: (
        <span
          className="rail-section-trail"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {onShowArchivedChange ? (
            <Tooltip label={showArchived ? t('Show Active Chats') : t('Show Archived Chats')} openDelay={400} withArrow>
              <ActionIcon
                variant={showArchived ? 'light' : 'subtle'}
                color={showArchived ? 'chatbox-brand' : 'chatbox-tertiary'}
                size={26}
                radius="sm"
                className="active:scale-[0.96] transition-transform"
                onClick={(e) => {
                  e.stopPropagation()
                  onShowArchivedChange(!showArchived)
                }}
                aria-label={showArchived ? t('Show Active Chats') : t('Show Archived Chats')}
                aria-pressed={showArchived}
              >
                <IconArchive size={14} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          ) : null}
          {!showArchived ? (
            <Tooltip label={t('Clean up older chats')} openDelay={600} withArrow>
              <ActionIcon
                variant="subtle"
                color="chatbox-tertiary"
                size={26}
                radius="sm"
                className="active:scale-[0.96] transition-transform"
                onClick={(e) => {
                  e.stopPropagation()
                  void NiceModal.show('clear-session-list')
                }}
                aria-label={t('Clean up older chats')}
              >
                <IconTrash size={14} stroke={1.5} />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </span>
      ),
    })

    if (recentsSection.contentVisible) {
      if (showRecentsCoaching) {
        rows.push({
          type: 'coaching',
          key: 'recents-coaching',
          message: t('{{count}} chats are not in a scope. Drag one onto a scope to file it.', {
            count: historySessions.length,
          }),
          animPhase: recentsPhase,
        })
      }

      if (historySessions.length === 0) {
        rows.push({
          type: 'empty',
          key: 'recents-empty',
          message: showArchived ? t('No archived chats') : t('No recent chats'),
          animPhase: recentsPhase,
        })
      } else if (showArchived) {
        for (const session of historySessions) {
          rows.push({
            type: 'session',
            session,
            folderKey: ALL_FOLDER_KEY,
            animPhase: recentsPhase,
          })
        }
      } else {
        const dayGroups = groupSessionsByDay(historySessions)
        const useDayHeaders = dayGroups.length > 1 || dayGroups[0]?.bucket !== 'unknown'
        for (const group of dayGroups) {
          if (useDayHeaders && group.bucket !== 'unknown') {
            rows.push({
              type: 'day',
              key: `day-${group.bucket}`,
              label: dayBucketLabel(group.bucket, t),
              animPhase: recentsPhase,
            })
          }
          for (const session of group.sessions) {
            rows.push({
              type: 'session',
              session,
              folderKey: ALL_FOLDER_KEY,
              animPhase: recentsPhase,
            })
          }
        }
      }
    }

    return rows
  }, [
    expandedFolders,
    folderPhase,
    historySessions,
    isMobileDensity,
    isSmallScreen,
    onCreateProject,
    projectGroups,
    projectsSection.contentVisible,
    projectsSection.phase,
    projectsSection.open,
    projectsSection.toggle,
    recentsSection.contentVisible,
    recentsSection.phase,
    recentsSection.open,
    recentsSection.toggle,
    showArchived,
    onShowArchivedChange,
    showRecentsCoaching,
    t,
  ])

  const visibleSessionIds = useMemo(
    () =>
      rowItems
        .filter((row): row is Extract<RowItem, { type: 'session' }> => row.type === 'session')
        .map((row) => row.session.id),
    [rowItems]
  )

  const folderKeyBySessionId = useMemo(() => {
    const entries = rowItems
      .filter((row): row is Extract<RowItem, { type: 'session' }> => row.type === 'session')
      .map((row) => [row.session.id, row.folderKey] as const)
    return new Map(entries)
  }, [rowItems])

  const onDragEnd = async (event: DragEndEvent) => {
    if (!event.over || !sortedSessions) {
      return
    }

    const activeId = String(event.active.id)
    const overId = String(event.over.id)

    if (activeId === overId) {
      return
    }

    // Cross-folder assign: drop on project row or Recents zone
    const dropTarget = parseDropTargetId(overId)
    if (dropTarget) {
      const activeMeta = sortedSessions.find((s) => s.id === activeId)
      if (!activeMeta) {
        return
      }

      if (dropTarget.type === 'folder') {
        if (getEffectiveProjectId(activeMeta) === dropTarget.folderId) {
          return
        }
        setExpandedFolders((prev) => ({ ...prev, [dropTarget.folderId]: true }))
        projectsSection.ensureOpen()
        await moveSessionToScopeOrToast(activeId, dropTarget.folderId)
        refetch()
        return
      }

      // Recents
      if (!getEffectiveProjectId(activeMeta)) {
        return
      }
      recentsSection.ensureOpen()
      await moveSessionToScopeOrToast(activeId, undefined)
      refetch()
      return
    }

    // Drop on another session: if different folder group, move into that session's folder
    const activeFolderKey = folderKeyBySessionId.get(activeId)
    const overFolderKey = folderKeyBySessionId.get(overId)

    if (activeFolderKey && overFolderKey && activeFolderKey !== overFolderKey) {
      const targetFolderId = overFolderKey === ALL_FOLDER_KEY ? undefined : overFolderKey
      if (overFolderKey !== ALL_FOLDER_KEY) {
        setExpandedFolders((prev) => ({ ...prev, [overFolderKey]: true }))
        projectsSection.ensureOpen()
      } else {
        recentsSection.ensureOpen()
      }
      await moveSessionToScopeOrToast(activeId, targetFolderId)
      refetch()
      return
    }

    if (!activeFolderKey || activeFolderKey !== overFolderKey) {
      return
    }

    const subsetIds = groups.find((group) => group.key === activeFolderKey)?.sessions.map((session) => session.id) || []

    if (subsetIds.length < 2) {
      return
    }

    await updateSessionList((sessions) => reorderSessionsInSubset(sessions || [], subsetIds, activeId, overId))
    refetch()
  }

  const setFolderPhaseTimed = (folderKey: string, phase: CollapsiblePhase) => {
    const existing = folderPhaseTimers.current[folderKey]
    if (existing) {
      clearTimeout(existing)
      delete folderPhaseTimers.current[folderKey]
    }
    setFolderPhase((prev) => {
      if (phase === 'idle') {
        const next = { ...prev }
        delete next[folderKey]
        return next
      }
      return { ...prev, [folderKey]: phase }
    })
    if (phase !== 'idle') {
      folderPhaseTimers.current[folderKey] = setTimeout(() => {
        setFolderPhase((prev) => {
          const next = { ...prev }
          delete next[folderKey]
          return next
        })
        delete folderPhaseTimers.current[folderKey]
      }, SECTION_COLLAPSE_MS)
    }
  }

  const toggleFolder = (folderKey: string) => {
    const isOpen = expandedFolders[folderKey] ?? true
    if (isOpen) {
      setExpandedFolders((prev) => ({ ...prev, [folderKey]: false }))
      setFolderPhaseTimed(folderKey, 'exiting')
      return
    }
    setExpandedFolders((prev) => ({ ...prev, [folderKey]: true }))
    setFolderPhaseTimed(folderKey, 'entering')
  }

  useEffect(
    () => () => {
      for (const timer of Object.values(folderPhaseTimers.current)) {
        clearTimeout(timer)
      }
    },
    []
  )

  const handleConfirmDeleteScope = (scope: Scope) => {
    void deleteScopeOrToast(scope, sortedSessions || [], { removeScope, putScope }).then((deleted) => {
      if (deleted && routerState.location.pathname === `/scope/${scope.id}`) startNewChat({})
    })
  }

  const handleCreateChatInFolder = (folder: Folder) => {
    setExpandedFolders((prev) => ({ ...prev, [folder.id]: true }))
    setFolderPhaseTimed(folder.id, 'idle')
    projectsSection.ensureOpen()
    startNewChat({ scopeId: folder.id })
  }

  const openScope = (scopeId: string, search?: { tab: 'settings' }) => {
    void navigate({ to: '/scope/$scopeId', params: { scopeId }, search: search ?? { tab: 'overview' } })
  }

  return (
    <>
      <DndContext
        modifiers={[restrictToVerticalAxis]}
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <SortableContext items={visibleSessionIds} strategy={verticalListSortingStrategy}>
          <Virtuoso
            style={{ flex: 1 }}
            data={rowItems}
            scrollerRef={(ref) => {
              if (ref instanceof HTMLDivElement) {
                sessionListViewportRef.current = ref
              }
            }}
            itemContent={(_index, row) => {
              if (row.type === 'section') {
                return (
                  <SectionHeader
                    label={row.label}
                    open={row.open}
                    onToggle={row.onToggle}
                    trailing={row.trailing}
                    droppableId={row.droppableId}
                  />
                )
              }

              if (row.type === 'empty') {
                const isProjectsEmpty = row.key === 'projects-empty'
                return (
                  <AnimRow phase={row.animPhase}>
                    <div className="rail-empty-card">
                      <p className="rail-empty-card-title">{row.message}</p>
                      {isProjectsEmpty ? (
                        <>
                          <p className="rail-empty-card-desc">
                            {t('A scope keeps the chats, knowledge and sources of one project or client together.')}
                          </p>
                          {onCreateProject ? (
                            <button type="button" className="rail-empty-card-action" onClick={onCreateProject}>
                              {t('New scope')}
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </AnimRow>
                )
              }

              if (row.type === 'day') {
                return (
                  <AnimRow phase={row.animPhase}>
                    <div className="rail-day-header">
                      <span>{row.label}</span>
                    </div>
                  </AnimRow>
                )
              }

              if (row.type === 'coaching') {
                return (
                  <AnimRow phase={row.animPhase}>
                    <div className="rail-coaching-row">
                      <Text size="xs" c="chatbox-tertiary" className="rail-coaching-hint flex-1 min-w-0">
                        {row.message}
                      </Text>
                      <ActionIcon
                        size={22}
                        radius="sm"
                        variant="subtle"
                        color="chatbox-tertiary"
                        className="rail-coaching-dismiss active:scale-[0.96] transition-transform"
                        onClick={() => setRecentsCoachingDismissed(true)}
                        aria-label={t('Dismiss')}
                      >
                        <IconX size={12} stroke={1.5} />
                      </ActionIcon>
                    </div>
                  </AnimRow>
                )
              }

              if (row.type === 'everywhere') {
                return (
                  <AnimRow phase={row.animPhase}>
                    <EverywhereRow active={routerState.location.pathname === '/scope/everywhere'} />
                  </AnimRow>
                )
              }

              if (row.type === 'folder') {
                const folder = folders.find((item) => item.id === row.folder.key)
                return (
                  <AnimRow phase={row.animPhase}>
                    <FolderDroppable id={folderDropId(row.folder.key)}>
                      <FolderItem
                        count={row.folder.count}
                        emoji={row.folder.emoji}
                        expanded={expandedFolders[row.folder.key] ?? true}
                        implicit={row.folder.implicit}
                        kind={scopes.find((scope) => scope.id === row.folder.key)?.kind ?? 'project'}
                        active={routerState.location.pathname === `/scope/${row.folder.key}`}
                        onOpen={() => openScope(row.folder.key)}
                        onOpenSettings={() => openScope(row.folder.key, { tab: 'settings' })}
                        name={row.folder.name}
                        projectId={row.folder.implicit ? undefined : row.folder.key}
                        onCreateChat={
                          row.folder.implicit || !folder
                            ? undefined
                            : () => {
                                void handleCreateChatInFolder(folder)
                              }
                        }
                        onDelete={row.folder.implicit || !folder ? undefined : () => setDeletingScopeId(folder.id)}
                        onToggle={() => toggleFolder(row.folder.key)}
                      />
                    </FolderDroppable>
                  </AnimRow>
                )
              }

              return (
                <AnimRow phase={row.animPhase}>
                  <SortableItem id={row.session.id}>
                    <SessionItem
                      nested={row.nested}
                      selected={routerState.location.pathname === `/session/${row.session.id}`}
                      session={row.session}
                    />
                  </SortableItem>
                </AnimRow>
              )
            }}
          />
        </SortableContext>
      </DndContext>
      {deletingScope ? (
        <DeleteScopeSheet
          scope={deletingScope}
          opened
          onClose={() => setDeletingScopeId(undefined)}
          onConfirm={() => handleConfirmDeleteScope(deletingScope)}
        />
      ) : null}
    </>
  )
}

function SectionHeader({
  label,
  open,
  onToggle,
  trailing,
  droppableId,
}: {
  label: string
  open: boolean
  onToggle: () => void
  trailing?: ReactNode
  droppableId?: string
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: droppableId || `section-static:${label}`,
    disabled: !droppableId,
  })

  return (
    <div ref={setNodeRef} className={clsx(isOver && droppableId && 'rail-drop-target')}>
      <UnstyledButton
        type="button"
        className="rail-section group/rail-section active:scale-[0.99] transition-transform"
        onClick={onToggle}
        aria-expanded={open}
      >
        <span className="rail-section-label">{label}</span>
        <span className="rail-section-trail">
          {trailing}
          <IconChevronDown
            size={14}
            stroke={1.75}
            className={open ? 'rail-section-chevron is-open' : 'rail-section-chevron'}
            aria-hidden
          />
        </span>
      </UnstyledButton>
    </div>
  )
}

function FolderDroppable(props: { id: string; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: props.id })
  return (
    <div ref={setNodeRef} className={clsx(isOver && 'rail-drop-target')}>
      {props.children}
    </div>
  )
}

function SortableItem(props: { id: string; children?: React.ReactNode }) {
  const { id, children } = props
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  )
}
