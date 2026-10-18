import type { Scope } from '@shared/types'
import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'

export type DeleteScopeSheetProps = {
  scope: Scope
  opened: boolean
  onClose(): void
  onConfirm(): void
}

export function DeleteScopeSheet({ scope, opened, onClose, onConfirm }: DeleteScopeSheetProps) {
  const { t } = useTranslation()
  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={t('Delete {{name}}?', { name: scope.name })}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={onClose}>
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
            {t('Delete scope')}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{t('Its chats move to Recents. You can undo for 5 seconds.')}</p>
    </Sheet>
  )
}
