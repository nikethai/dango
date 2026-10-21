import type { ReactNode } from 'react'
import { Sheet } from '@/components/ui/Sheet'
import { useLayoutMode } from '@/hooks/useLayoutMode'

export type InspectorFrameProps = {
  opened: boolean
  onClose: () => void
  title: string
  children: ReactNode
  /**
   * The caller's own docked shell at wide, wrapped around the body (the workspace keeps its aside, resizer, full
   * screen mode and exit animation). Without it, wide renders a plain aside. Never used in the sheets.
   */
  docked?: (body: ReactNode) => ReactNode
}

/**
 * The inspector's shell for the window size (RS1, RS2): docked beside the chat at wide (380–460 px, no focus trap), a
 * right sheet at medium, and a bottom sheet at phone, full height minus the safe-area top. The shell follows the mode
 * while open, so crossing 1200 or 760 px swaps it in place and never leaves a scrim behind.
 */
export function InspectorFrame({ opened, onClose, title, children, docked }: InspectorFrameProps) {
  const mode = useLayoutMode()

  if (mode === 'wide') {
    if (docked) return <>{docked(children)}</>
    if (!opened) return null
    return (
      <aside className="dango-inspector" aria-label={title}>
        {children}
      </aside>
    )
  }

  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={title}
      side={mode === 'medium' ? 'right' : 'bottom'}
      className="dango-inspector-sheet"
    >
      {children}
    </Sheet>
  )
}
