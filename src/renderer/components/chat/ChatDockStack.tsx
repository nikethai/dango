import type { ReactNode } from 'react'

type ChatDockStackProps = {
  sessionId: string
  children: ReactNode
  afterComposer?: ReactNode
  /**
   * @deprecated Dual live chrome removed — thread work strip + statusline pulse are SoT.
   * Kept optional so call sites can drop props without a flag day.
   */
  generating?: boolean
  /** @deprecated See `generating`. */
  liveMessage?: unknown
}

/** The composer dock. Plan progress lives in the plan card in the thread; task lists in TodoAppCard. */
export default function ChatDockStack({ children, afterComposer }: ChatDockStackProps) {
  return (
    <div className="chat-dock-stack chat-col">
      {/* Live generation lives in the thread strip + statusline pulse only (no dual chrome). */}
      <div className="chat-dock-composer">{children}</div>
      {afterComposer ? <div className="chat-dock-after-composer">{afterComposer}</div> : null}
    </div>
  )
}
