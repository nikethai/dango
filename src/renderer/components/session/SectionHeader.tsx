import { useDroppable } from '@dnd-kit/core'
import { UnstyledButton } from '@mantine/core'
import { IconChevronDown } from '@tabler/icons-react'
import clsx from 'clsx'
import type { ReactNode } from 'react'

/**
 * A sidebar section header (Scopes, Recents): a toggle button for the section and its trailing buttons (New scope,
 * archive, clean up) side by side. The toggle's hit area covers the whole header (CSS); the trailing buttons sit
 * above it. They used to be inside the toggle, and a button inside a button hides the inner ones from screen readers.
 */
export function SectionHeader({
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
      <div className="rail-section group/rail-section">
        <UnstyledButton
          type="button"
          className="rail-section-toggle active:scale-[0.99] transition-transform"
          onClick={onToggle}
          aria-expanded={open}
        >
          <span className="rail-section-label">{label}</span>
        </UnstyledButton>
        <span className="rail-section-trail">
          {trailing}
          <IconChevronDown
            size={14}
            stroke={1.75}
            className={open ? 'rail-section-chevron is-open' : 'rail-section-chevron'}
            aria-hidden
          />
        </span>
      </div>
    </div>
  )
}
