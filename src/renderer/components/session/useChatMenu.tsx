import NiceModal from '@ebay/nice-modal-react'
import { isEverywhere, type SessionMeta } from '@shared/types'
import { getDefaultStore } from 'jotai'
import { type ReactNode, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'
import { useScopes } from '@/hooks/useScopes'
import { startNewChat } from '@/lib/startNewChat'
import { getLogger } from '@/lib/utils'
import { getEffectiveProjectId } from '@/projects/project-context'
import { currentSessionIdAtom } from '@/stores/atoms'
import { getSession, updateSession } from '@/stores/chatStore'
import { branchChatFromMessage } from '@/stores/session/branch'
import { archiveChatWithUndo, deleteChatWithUndo, moveChatWithUndoOrToast } from '@/stores/session/chat-menu-actions'
import { switchCurrentSession } from '@/stores/sessionActions'
import * as toastActions from '@/stores/toastActions'
import type { ActionMenuItemProps } from '../ActionMenu'
import { buildChatMenuItems } from './chatMenu'

const log = getLogger('chat-menu')

/**
 * The chat menu (CM1) wired to its actions, for the sidebar row and the chat header. `sheet` is the Move to scope
 * picker: render it outside any clickable row (it portals, but React events still bubble to the row).
 * Without `onRename` (the compact workspace toolbar has no title to edit) the Rename row is left out.
 */
export function useChatMenu(
  session: SessionMeta,
  opts: { selected: boolean; onRename?: () => void }
): { items: ActionMenuItemProps[]; sheet: ReactNode } {
  const { t } = useTranslation()
  const { scopes } = useScopes()
  const [moveOpen, setMoveOpen] = useState(false)
  const { selected, onRename } = opts
  const sessionId = session.id

  const items = useMemo(() => {
    const fail = (message: string) => (error: unknown) => {
      log.error(message, error)
      toastActions.add(t("Couldn't save that. Try again."))
    }
    const all = buildChatMenuItems(
      session,
      {
        onRename: () => onRename?.(),
        onTogglePin: () => {
          void updateSession(sessionId, (s) => {
            if (!s) {
              throw new Error(`Session ${sessionId} not found`)
            }
            return { ...s, starred: !s.starred }
          }).catch(fail('Pin failed'))
        },
        onMoveToScope: () => setMoveOpen(true),
        onBranch: () => {
          // Branch the whole chat: everything up to its latest message.
          void getSession(sessionId)
            .then((full) => {
              const last = full?.messages.at(-1)
              if (!last) return
              return branchChatFromMessage(sessionId, last.id)
            })
            .catch(fail('Branch failed'))
        },
        onExport: () => {
          // The export sheet exports the current chat.
          if (getDefaultStore().get(currentSessionIdAtom) !== sessionId) {
            switchCurrentSession(sessionId)
          }
          void NiceModal.show('export-chat')
        },
        onToggleArchive: () => {
          void archiveChatWithUndo(sessionId).catch(fail('Archive failed'))
        },
        onDelete: () => {
          void deleteChatWithUndo(sessionId)
            .then((deleted) => {
              if (deleted && selected) {
                startNewChat()
              }
            })
            .catch((error: unknown) => {
              log.error('Delete failed', error)
              toastActions.add(t("Couldn't delete {{name}}. Try again.", { name: session.name }))
            })
        },
      },
      t
    )
    // Rename is always buildChatMenuItems' first row.
    return onRename ? all : all.slice(1)
  }, [session, sessionId, selected, onRename, t])

  const currentScopeId = getEffectiveProjectId(session)
  const choose = (scopeId: string | undefined) => {
    setMoveOpen(false)
    if (scopeId === currentScopeId) return
    void moveChatWithUndoOrToast(sessionId, scopeId)
  }
  const options = scopes.filter((scope) => !isEverywhere(scope.id))

  const sheet = (
    <Sheet
      opened={moveOpen}
      onClose={() => setMoveOpen(false)}
      title={t('Move to scope')}
      actions={
        <button type="button" className="dg-btn dg-btn--ghost" onClick={() => setMoveOpen(false)}>
          {t('Cancel')}
        </button>
      }
    >
      <div className="dg-menu dg-menu--sheet">
        <button
          type="button"
          className={currentScopeId ? undefined : 'is-current'}
          aria-pressed={!currentScopeId}
          onClick={() => choose(undefined)}
        >
          <span>{t('None')}</span>
        </button>
        {options.map((scope) => (
          <button
            key={scope.id}
            type="button"
            className={scope.id === currentScopeId ? 'is-current' : undefined}
            aria-pressed={scope.id === currentScopeId}
            onClick={() => choose(scope.id)}
          >
            <span className="min-w-0 truncate">{scope.name}</span>
            {scope.kind === 'client' ? <span className="dg-chip">{t('client')}</span> : null}
          </button>
        ))}
      </div>
    </Sheet>
  )

  return { items, sheet }
}
