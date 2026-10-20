import NiceModal, { useModal } from '@ebay/nice-modal-react'
import type { ReviewEntry } from '@shared/types/review'
import { t } from 'i18next'
import { useId, useState } from 'react'
import { Sheet } from '@/components/ui/Sheet'
import { applyEditedDraft } from './act-call'

export type DraftEditSheetProps = { opened: boolean; entry: ReviewEntry; onClose: () => void }

/**
 * Edit the reply: the waiting draft in a text area, Apply writes the edited text into Gmail (never sends), Cancel or
 * Esc changes nothing. The draft is mail-derived model text, shown only as the text area's plain value.
 */
export function DraftEditSheet({ opened, entry, onClose }: DraftEditSheetProps) {
  const fieldId = useId()
  const [text, setText] = useState(entry.text)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const ready = text.trim().length > 0 && !busy

  const apply = async () => {
    if (!ready) return
    setBusy(true)
    setFailed(false)
    let ok = false
    try {
      ok = await applyEditedDraft(entry, text)
    } catch {
      ok = false
    }
    setBusy(false)
    if (ok) onClose()
    else setFailed(true)
  }

  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={t('Edit the reply')}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="dg-btn dg-btn--primary" disabled={!ready} onClick={() => void apply()}>
            {t('Apply')}
          </button>
        </>
      }
    >
      <label htmlFor={fieldId} className="dg-type-caption">
        {t('Reply')}
      </label>
      <textarea
        id={fieldId}
        data-autofocus
        className="dango-field"
        rows={12}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {failed ? (
        <p role="alert" className="dg-type-caption">
          {t("Couldn't draft the reply in Gmail. Nothing was sent.")}
        </p>
      ) : null}
    </Sheet>
  )
}

/** The sheet as a NiceModal, opened by the `'draft'` opener in the main window. */
export const DraftEditModal = NiceModal.create(({ entry }: { entry: ReviewEntry }) => {
  const modal = useModal()
  const close = () => {
    modal.resolve()
    void modal.remove()
  }
  return <DraftEditSheet opened={modal.visible} entry={entry} onClose={close} />
})
