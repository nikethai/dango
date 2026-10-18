import { t } from 'i18next'
import { useId, useState } from 'react'
import { Sheet } from '@/components/ui/Sheet'

export type KeepBothSheetProps = { opened: boolean; onClose: () => void; onConfirm: (condition: string) => void }

/** RV7: both statements stay, each under a condition the user writes. */
export function KeepBothSheet({ opened, onClose, onConfirm }: KeepBothSheetProps) {
  const fieldId = useId()
  const [condition, setCondition] = useState('')
  const [wasOpened, setWasOpened] = useState(opened)
  // A reopened sheet starts blank.
  if (wasOpened !== opened) {
    setWasOpened(opened)
    if (!opened) setCondition('')
  }
  const ready = condition.trim().length > 0
  const confirm = () => {
    if (ready) onConfirm(condition.trim())
  }
  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={t('Keep both')}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="dg-btn dg-btn--primary" disabled={!ready} onClick={confirm}>
            {t('Keep both')}
          </button>
        </>
      }
    >
      <label htmlFor={fieldId} className="dg-type-caption">
        {t('Both are true when…')}
      </label>
      <input
        id={fieldId}
        data-autofocus
        className="dango-field"
        placeholder={t('For example: for the EU launch')}
        value={condition}
        onChange={(e) => setCondition(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.keyCode !== 229) {
            e.preventDefault()
            confirm()
          }
        }}
      />
    </Sheet>
  )
}
