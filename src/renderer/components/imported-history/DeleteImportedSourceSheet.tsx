import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'

export type DeleteImportedSourceSheetProps = {
  filename: string
  conversationCount: number
  opened: boolean
  onClose(): void
  onConfirm(): void
}

/** Confirms deleting an imported source. Cancel takes first focus; Esc cancels. */
export function DeleteImportedSourceSheet({
  filename,
  conversationCount,
  opened,
  onClose,
  onConfirm,
}: DeleteImportedSourceSheetProps) {
  const { t } = useTranslation()
  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={t('Delete “{{filename}}”?', { filename })}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" data-autofocus onClick={onClose}>
            {t('Cancel')}
          </button>
          <button
            type="button"
            className="dg-btn dg-btn--danger"
            onClick={() => {
              onClose()
              onConfirm()
            }}
          >
            {t('Delete import')}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        {t(
          "This removes {{count}} imported conversations from Dango and can't be undone. Chats you continued from them stay.",
          { count: conversationCount }
        )}
      </p>
    </Sheet>
  )
}
