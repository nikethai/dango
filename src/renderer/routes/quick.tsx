/**
 * Quick Chat: one compact panel. In the desktop quick window it fills the frameless window; on web and mobile it is a
 * centred page.
 */
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useLayoutEffect } from 'react'
import { QuickChatPanel } from '@/components/quick-chat'
import { useQuickChat } from '@/components/quick-chat/useQuickChat'
import platform, { platformCapabilities } from '@/platform'

export const Route = createFileRoute('/quick')({
  component: QuickChatPage,
})

function QuickChatPage() {
  const { panelRef, ...panel } = useQuickChat()
  const windowed = platformCapabilities.supportsDesktopOnlySettings

  useEffect(() => {
    void platform.notifyQuickRendererReady?.()
    return () => {
      void platform.notifyQuickRendererGone?.()
    }
  }, [])

  // Portaled popovers leave the panel — flag root early so density CSS applies same paint.
  useLayoutEffect(() => {
    const root = document.documentElement
    root.dataset.quickChat = '1'
    return () => {
      delete root.dataset.quickChat
    }
  }, [])

  if (windowed) {
    return <QuickChatPanel ref={panelRef} {...panel} windowed />
  }

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: 'var(--dango-surface)',
      }}
    >
      <QuickChatPanel ref={panelRef} {...panel} windowed={false} />
    </div>
  )
}
