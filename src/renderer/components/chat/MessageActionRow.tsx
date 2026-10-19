import type { Message } from '@shared/types'
import { ChevronDown, Copy, Ellipsis, type LucideIcon, Pencil, RotateCcw, ThumbsDown, ThumbsUp } from 'lucide-react'
import { forwardRef, type MouseEventHandler } from 'react'
import { useTranslation } from 'react-i18next'
import ActionMenu, { type ActionMenuItemProps } from '../ActionMenu'
import { ModelSelector } from '../ModelSelector'
import { formatAnswerMeta } from './messageMeta'

type RowButtonProps = {
  label: string
  icon: LucideIcon
  onClick?: MouseEventHandler<HTMLButtonElement>
  pressed?: boolean
}

/** One icon button of the row: Lucide 16 px, stroke 1.8; pressed shows by aria-pressed (green), never a filled icon. */
const RowButton = forwardRef<HTMLButtonElement, RowButtonProps>(
  ({ label, icon: Icon, onClick, pressed, ...rest }, ref) => (
    <button
      {...rest}
      ref={ref}
      type="button"
      className="dg-btn dg-btn--ghost dg-btn--icon"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
    >
      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
    </button>
  )
)
RowButton.displayName = 'RowButton'

export type MessageActionRowProps = {
  msg: Message
  onCopy(): void
  onRedo(): void
  onRedoWithModel(provider: string, modelId: string): void
  onFeedback(rating: 'up' | 'down'): void
  menu: ActionMenuItemProps[]
  /** User messages only: edit and resend. */
  onEdit?(): void
  /** Lets the host keep the hover row visible while More is open. */
  menuOpened?: boolean
  onMenuChange?(opened: boolean): void
}

/**
 * The row under a chat message (MA1). Assistant: Copy · Redo · Redo ▾ (another model) · thumbs · More, then
 * model · tokens · time. User: Copy · Edit · More.
 */
export function MessageActionRow(props: MessageActionRowProps) {
  const { msg, onCopy, onRedo, onRedoWithModel, onFeedback, menu, onEdit, menuOpened, onMenuChange } = props
  const { t } = useTranslation()
  const isAssistant = msg.role === 'assistant'
  const rating = msg.feedback?.rating
  const meta = isAssistant ? formatAnswerMeta(msg, t) : ''

  return (
    <div className="dg-msg-actions">
      <RowButton label={t('Copy')} icon={Copy} onClick={onCopy} />
      {isAssistant ? (
        <>
          <RowButton label={t('Redo')} icon={RotateCcw} onClick={onRedo} />
          <ModelSelector onSelect={(provider, modelId) => onRedoWithModel(provider, modelId)} position="bottom-start">
            <RowButton label={t('Redo with another model')} icon={ChevronDown} />
          </ModelSelector>
          <RowButton
            label={t('Good answer')}
            icon={ThumbsUp}
            pressed={rating === 'up'}
            onClick={() => onFeedback('up')}
          />
          <RowButton
            label={t('Bad answer')}
            icon={ThumbsDown}
            pressed={rating === 'down'}
            onClick={() => onFeedback('down')}
          />
        </>
      ) : (
        onEdit && <RowButton label={t('Edit')} icon={Pencil} onClick={onEdit} />
      )}
      <ActionMenu items={menu} opened={menuOpened} onChange={onMenuChange}>
        <RowButton label={t('More')} icon={Ellipsis} />
      </ActionMenu>
      {meta && <span className="dg-type-caption dg-msg-actions__meta">{meta}</span>}
    </div>
  )
}
