import { motionScrollBehavior } from '@/utils/scrollBehavior'
import { getSession } from './chatStore'
import { getAllMessageList } from './sessionHelpers'
import { uiStore } from './uiStore'

// scrollToMessage ， false
export async function scrollToMessage(
  sessionId: string,
  msgId: string,
  align: 'start' | 'center' | 'end' = 'start',
  behavior: 'auto' | 'smooth' = 'auto' // 'auto' ，'smooth'
): Promise<boolean> {
  const session = await getSession(sessionId)
  if (!session) {
    return false
  }
  const currentMessages = getAllMessageList(session)
  if (!currentMessages) {
    return false
  }
  const index = currentMessages.findIndex((msg) => msg.id === msgId)
  if (index === -1) {
    return false
  }
  scrollToIndex(index, align, behavior)
  return true
}

export function scrollToIndex(
  index: number | 'LAST',
  align: 'start' | 'center' | 'end' = 'start',
  behavior: 'auto' | 'smooth' = 'auto' // 'auto' ，'smooth'
) {
  const virtuoso = uiStore.getState().messageScrolling
  virtuoso?.current?.scrollToIndex({ index, align, behavior: motionScrollBehavior(behavior) })
}

export function scrollToTop(behavior: 'auto' | 'smooth' = 'auto') {
  clearAutoScroll()
  return scrollToIndex(0, 'start', behavior)
}

let lastScrollToBottomAt = 0
let pendingScrollToBottomRaf: number | null = null

/**
 * Pin to latest message. Throttled for 'auto' so multi-step tool streams
 * don't thrash the scrollbar (triple scrollTo was fighting Virtuoso followOutput).
 */
export function scrollToBottom(behavior: 'auto' | 'smooth' = 'auto') {
  clearAutoScroll()
  const now = Date.now()
  // Coalesce rapid auto pins (stream inserts, tool rounds, settle).
  if (behavior === 'auto' && now - lastScrollToBottomAt < 160) {
    if (pendingScrollToBottomRaf == null && typeof requestAnimationFrame === 'function') {
      pendingScrollToBottomRaf = requestAnimationFrame(() => {
        pendingScrollToBottomRaf = null
        lastScrollToBottomAt = Date.now()
        const virtuoso = uiStore.getState().messageScrolling
        virtuoso?.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' })
      })
    }
    return
  }
  lastScrollToBottomAt = now
  if (pendingScrollToBottomRaf != null && typeof cancelAnimationFrame === 'function') {
    cancelAnimationFrame(pendingScrollToBottomRaf)
    pendingScrollToBottomRaf = null
  }
  const virtuoso = uiStore.getState().messageScrolling
  // One scroll only. Dual rAF pins fought Virtuoso followOutput and made the bar thrash.
  virtuoso?.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: motionScrollBehavior(behavior) })
}

let autoScrollTask: {
  id: string
  task: {
    msgId: string
    align: 'start' | 'center' | 'end'
    behavior: 'auto' | 'smooth'
  }
} | null = null

export function startAutoScroll(
  msgId: string,
  align: 'start' | 'center' | 'end' = 'start',
  behavior: 'auto' | 'smooth' = 'auto' // 'auto' ，'smooth'
): string {
  const newTask = { msgId, align, behavior }
  const newId = JSON.stringify(newTask)
  if (autoScrollTask) {
    if (autoScrollTask.id === newId) {
      return autoScrollTask.id
    } else {
      clearAutoScroll()
    }
  }
  autoScrollTask = {
    id: newId,
    task: newTask,
  }
  return newId
}

export function clearAutoScroll(id?: string) {
  if (!autoScrollTask) {
    return true
  }
  if (id && id !== autoScrollTask.id) {
    return false
  }
  autoScrollTask = null
  return true
}

export function getMessageListViewportHeight() {
  const messageListElement = uiStore.getState().messageListElement
  if (!messageListElement) {
    return 0
  }
  return messageListElement.current?.clientHeight ?? 0
}
