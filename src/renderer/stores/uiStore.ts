import type { ArtifactKind } from '@shared/artifacts'
import type { KnowledgeBase, MessagePicture, MessageQuoteAttachment, Toast } from '@shared/types'
import type { RefObject } from 'react'
import type { VirtuosoHandle } from 'react-virtuoso'
import { v4 as uuidv4 } from 'uuid'
import { createStore, useStore } from 'zustand'
import { combine, persist } from 'zustand/middleware'
import { safeStorage } from './safeStorage'

/** Ephemeral composer quote draft (not persisted). */
export type QuoteDraft = Pick<MessageQuoteAttachment, 'sourceMessageId' | 'sourceRole' | 'text' | 'isPartial'>

export type WorkspaceArtifactVersion = {
  id: string
  messageId?: string
  kind: ArtifactKind
  content: string
  language?: string
  title?: string
  version?: number
}

export type WorkspacePanelState = {
  kind: ArtifactKind
  content: string
  language?: string
  title?: string
  messageId?: string
  artifactId?: string
  versions?: WorkspaceArtifactVersion[]
  versionIndex?: number
  /** @deprecated legacy html-only shape; prefer content */
  htmlCode?: string
}

// UI store for managing UI-related state
// immer middleware，RefObject
/** The artifact inspector's width range (roadmap: 380–460 px); the panel clamps on read, the setter on write. */
export const WORKSPACE_MIN_WIDTH_PX = 380
export const WORKSPACE_MAX_WIDTH_PX = 460

export const uiStore = createStore(
  persist(
    combine(
      {
        toasts: [] as Toast[],
        /** Pending quote for the composer chip (single slot; replace on new Quote). */
        quoteDraft: null as QuoteDraft | null,
        /** A file is being dragged over the window; the chat column shows "Drop to attach" (not persisted). */
        fileDragActive: false,
        /** The mounted composer holds text (not persisted); first-chat chips hide so a pick never overwrites it. */
        composerHasDraft: false,
        realTheme: localStorage.getItem('initial-theme') === 'dark' ? 'dark' : ('light' as 'light' | 'dark'),
        messageListElement: null as RefObject<HTMLDivElement> | null,
        messageScrolling: null as RefObject<VirtuosoHandle> | null,
        messageScrollingAtTop: false,
        messageScrollingAtBottom: false,
        /** Desktop only: expanded tree vs icon-only rail (never fully hidden). */
        sidebarLayout: 'expanded' as 'expanded' | 'rail',
        /** The rail's expanded sidebar laid over the content (medium, wide-rail); UI-only, never persisted. */
        railPeek: false,
        sidebarMode: 'chat' as 'chat' | 'task',
        openSearchDialog: false,
        openAboutDialog: false, // (legacy)
        inputBoxWebBrowsingMode: false,
        sessionWebBrowsingMap: {} as Record<string, boolean | undefined>,
        // Cache for current session's computed web browsing state (for keyboard shortcut)
        currentWebBrowsingDisplay: { sessionId: '', value: false } as { sessionId: string; value: boolean },
        sessionKnowledgeBaseMap: {} as Record<string, Pick<KnowledgeBase, 'id' | 'name'> | undefined>,
        newSessionState: {} as {
          knowledgeBase?: Pick<KnowledgeBase, 'id' | 'name'>
          webBrowsing?: boolean
        },
        pictureShow: null as {
          picture: MessagePicture
          extraButtons?: {
            onClick: () => void
            icon: React.ReactNode
          }[]
          onSave?: () => void
        } | null,
        /**
         * Side workspace (Claude Artifacts–style): chat left, preview right.
         * html / markdown / svg / mermaid / code are first-class panel kinds.
         */
        workspacePanel: null as null | WorkspacePanelState,
        workspaceWidthPx: WORKSPACE_MAX_WIDTH_PX as number,
        workspaceExpanded: false as boolean,
        /** One-send explicit Project context draft, keyed by session id. */
        projectContextDrafts: {} as Record<string, import('@shared/types/workspace').WorkspaceContextDraftEntry[]>,
        showCopilotsInNewSession: false,
        sidebarWidth: null as number | null, // Custom sidebar width, null means use default
        /** User dismissed the Recents coaching banner once. */
        recentsCoachingDismissed: false,
      },
      (set, get) => ({
        addToast: (content: string, duration?: number) => {
          const newToast = { id: `toast:${uuidv4()}`, content, duration }
          set((state) => ({
            ...state,
            toasts: [...state.toasts, newToast],
          }))
        },
        removeToast: (id: string) => {
          set((state) => ({
            ...state,
            toasts: state.toasts.filter((toast) => toast.id !== id),
          }))
        },

        setQuoteDraft: (quoteDraft: QuoteDraft | null) => {
          set({ quoteDraft })
        },

        setComposerHasDraft: (composerHasDraft: boolean) => {
          set((state) => (state.composerHasDraft === composerHasDraft ? state : { composerHasDraft }))
        },
        setFileDragActive: (fileDragActive: boolean) => {
          set((state) => (state.fileDragActive === fileDragActive ? state : { fileDragActive }))
        },

        setSidebarLayout: (sidebarLayout: 'expanded' | 'rail') => {
          set((state) => (state.sidebarLayout === sidebarLayout ? state : { sidebarLayout }))
        },

        setRailPeek: (railPeek: boolean) => {
          set((state) => (state.railPeek === railPeek ? state : { railPeek }))
        },

        setSidebarMode: (sidebarMode: 'chat' | 'task') => {
          set({ sidebarMode })
        },

        setRecentsCoachingDismissed: (recentsCoachingDismissed: boolean) => {
          set((state) =>
            state.recentsCoachingDismissed === recentsCoachingDismissed ? state : { recentsCoachingDismissed }
          )
        },

        setOpenSearchDialog: (openSearchDialog: boolean) => {
          set((state) => (state.openSearchDialog === openSearchDialog ? state : { openSearchDialog }))
        },

        setOpenAboutDialog: (openAboutDialog: boolean) => {
          set((state) => (state.openAboutDialog === openAboutDialog ? state : { openAboutDialog }))
        },

        setInputBoxWebBrowsingMode: (inputBoxWebBrowsingMode: boolean) => {
          set({ inputBoxWebBrowsingMode })
        },

        setPictureShow: (pictureShow: ReturnType<typeof get>['pictureShow']) => {
          set({ pictureShow })
        },

        setWorkspacePanel: (workspacePanel: ReturnType<typeof get>['workspacePanel']) => {
          set(workspacePanel ? { workspacePanel } : { workspacePanel: null, workspaceExpanded: false })
        },

        setWorkspaceExpanded: (workspaceExpanded: boolean) => {
          set((state) => (state.workspaceExpanded === workspaceExpanded ? state : { workspaceExpanded }))
        },

        setWorkspaceWidthPx: (workspaceWidthPx: number) => {
          const clamped = Math.min(
            WORKSPACE_MAX_WIDTH_PX,
            Math.max(WORKSPACE_MIN_WIDTH_PX, Math.round(workspaceWidthPx))
          )
          set((state) => (state.workspaceWidthPx === clamped ? state : { workspaceWidthPx: clamped }))
        },

        setMessageListElement: (messageListElement: RefObject<HTMLDivElement> | null) => {
          set({ messageListElement })
        },

        setMessageScrolling: (messageScrolling: RefObject<VirtuosoHandle> | null) => {
          set({ messageScrolling })
        },

        setMessageScrollingAtTop: (messageScrollingAtTop: boolean) => {
          set({ messageScrollingAtTop })
        },

        setMessageScrollingAtBottom: (messageScrollingAtBottom: boolean) => {
          set({ messageScrollingAtBottom })
        },

        addSessionKnowledgeBase: (sessionId: string, knowledgeBase: Pick<KnowledgeBase, 'id' | 'name'>) => {
          set((state) => ({
            sessionKnowledgeBaseMap: {
              ...state.sessionKnowledgeBaseMap,
              [sessionId]: knowledgeBase,
            },
          }))
        },

        removeSessionKnowledgeBase: (sessionId: string) => {
          set((state) => {
            const newMap = { ...state.sessionKnowledgeBaseMap }
            delete newMap[sessionId]
            return { sessionKnowledgeBaseMap: newMap }
          })
        },

        getSessionWebBrowsing: (sessionId: string) => {
          return get().sessionWebBrowsingMap[sessionId]
        },

        setSessionWebBrowsing: (sessionId: string, enabled: boolean) => {
          set((state) => ({
            sessionWebBrowsingMap: {
              ...state.sessionWebBrowsingMap,
              [sessionId]: enabled,
            },
            // Update cache if it's for the current session (avoid race condition with kbd shortcut)
            currentWebBrowsingDisplay:
              state.currentWebBrowsingDisplay.sessionId === sessionId
                ? { sessionId, value: enabled }
                : state.currentWebBrowsingDisplay,
          }))
        },

        clearSessionWebBrowsing: (sessionId: string = 'new') => {
          set((state) => {
            const newMap = { ...state.sessionWebBrowsingMap }
            delete newMap[sessionId]
            // Clear cache if it's for the cleared session
            const updates: {
              sessionWebBrowsingMap: typeof newMap
              currentWebBrowsingDisplay?: typeof state.currentWebBrowsingDisplay
            } = { sessionWebBrowsingMap: newMap }
            if (state.currentWebBrowsingDisplay.sessionId === sessionId) {
              updates.currentWebBrowsingDisplay = { sessionId: '', value: false }
            }
            return updates
          })
        },

        // Update the cached display value (for kbd shortcut to work)
        updateCurrentWebBrowsingDisplay: (sessionId: string, value: boolean) => {
          set({ currentWebBrowsingDisplay: { sessionId, value } })
        },

        // Toggle web browsing for a session using the cached display value
        toggleSessionWebBrowsing: (sessionId: string) => {
          const { currentWebBrowsingDisplay } = get()
          // Use cached display value if it matches the session, otherwise fallback to stored value
          const currentValue =
            currentWebBrowsingDisplay.sessionId === sessionId
              ? currentWebBrowsingDisplay.value
              : (get().sessionWebBrowsingMap[sessionId] ?? false)
          const newValue = !currentValue
          set((state) => ({
            sessionWebBrowsingMap: {
              ...state.sessionWebBrowsingMap,
              [sessionId]: newValue,
            },
            // Update cache to keep it in sync
            currentWebBrowsingDisplay: { sessionId, value: newValue },
          }))
        },

        setNewSessionState: (
          newSessionState:
            | ReturnType<typeof get>['newSessionState']
            | ((prev: ReturnType<typeof get>['newSessionState']) => ReturnType<typeof get>['newSessionState'])
        ) => {
          set({
            newSessionState:
              typeof newSessionState === 'function' ? newSessionState(get().newSessionState) : newSessionState,
          })
        },

        setShowCopilotsInNewSession: (showCopilotsInNewSession: boolean) => {
          set({ showCopilotsInNewSession })
        },

        setSidebarWidth: (sidebarWidth: number | null) => {
          set((state) => (state.sidebarWidth === sidebarWidth ? state : { sidebarWidth }))
        },

        setProjectContextDraft: (
          sessionId: string,
          entries: import('@shared/types/workspace').WorkspaceContextDraftEntry[]
        ) => {
          set((state) => ({
            projectContextDrafts: { ...state.projectContextDrafts, [sessionId]: entries },
          }))
        },

        clearProjectContextDraft: (sessionId: string) => {
          set((state) => {
            const next = { ...state.projectContextDrafts }
            delete next[sessionId]
            return { projectContextDrafts: next }
          })
        },
      })
    ),
    {
      name: 'ui-store',
      version: 1,
      partialize: (state) => ({
        sidebarLayout: state.sidebarLayout,
        showCopilotsInNewSession: state.showCopilotsInNewSession,
        sidebarWidth: state.sidebarWidth,
        workspaceWidthPx: state.workspaceWidthPx,
        sessionWebBrowsingMap: state.sessionWebBrowsingMap,
        recentsCoachingDismissed: state.recentsCoachingDismissed,
      }),
      migrate: (persisted) => {
        const state = (persisted || {}) as Record<string, unknown>
        // Drop legacy widthFull; default layout expanded
        const { widthFull: _removed, ...rest } = state
        return {
          ...rest,
          sidebarLayout: rest.sidebarLayout === 'rail' ? 'rail' : 'expanded',
          recentsCoachingDismissed: Boolean(rest.recentsCoachingDismissed),
        }
      },
      storage: safeStorage,
    }
  )
)

export function useUIStore<U>(selector: Parameters<typeof useStore<typeof uiStore, U>>[1]) {
  return useStore<typeof uiStore, U>(uiStore, selector)
}
