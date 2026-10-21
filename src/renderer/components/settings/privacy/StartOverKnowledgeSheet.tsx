import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'

export type StartOverKnowledgeSheetProps = {
  opened: boolean
  onClose(): void
  onConfirm(): void
}

/** Confirms replacing knowledge that can't be read with an empty document. Cancel takes first focus; Esc cancels. */
export function StartOverKnowledgeSheet({ opened, onClose, onConfirm }: StartOverKnowledgeSheetProps) {
  const { t } = useTranslation()
  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={t('Start over with empty knowledge?')}
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
            {t('Delete and start over')}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>{t("Your saved facts, preferences and proposals are deleted. This can't be undone.")}</p>
    </Sheet>
  )
}
