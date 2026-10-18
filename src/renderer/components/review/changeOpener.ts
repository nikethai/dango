import { getDefaultStore } from 'jotai'
import { registerReviewOpener, reviewRegistryStore } from '@/packages/review'
import { router } from '@/router'
import { currentSessionIdAtom } from '@/stores/atoms'
import { ChatQueryKeys } from '@/stores/chatStore'
import queryClient from '@/stores/queryClient'

/** False only when the cached chat list is loaded and lacks `chatId` (deleted); unknown counts as present. */
function chatExists(chatId: string): boolean {
  const list = queryClient.getQueryData<{ id: string }[]>(ChatQueryKeys.ChatSessionsList)
  return !list || list.some((s) => s.id === chatId)
}

/**
 * The opener for a Change row: the chat whose plan staged the edits (`chatId`, slice 6a). The staged set is applied
 * from that chat's project panel. Entries without a chat, or whose chat was deleted, are refused by `canOpen`, so
 * their row shows no Open.
 * Registered once at app init next to the default question opener; leaves an opener already registered alone.
 * Returns the cleanup (a no-op when it registered nothing).
 */
export function registerChangeOpener(): () => void {
  if (reviewRegistryStore.getState().openers.change) return () => {}
  return registerReviewOpener(
    'change',
    (e) => {
      if (!e.chatId) return
      getDefaultStore().set(currentSessionIdAtom, e.chatId)
      void router.navigate({ to: '/session/$sessionId', params: { sessionId: e.chatId } })
    },
    { canOpen: (e) => Boolean(e.chatId && chatExists(e.chatId)) }
  )
}
