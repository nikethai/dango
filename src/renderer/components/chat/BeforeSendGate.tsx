import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useStore } from 'zustand'
import { Sheet } from '@/components/ui/Sheet'
import { beforeSendStore, registerBeforeSendHost, settleCostHeadsUp } from './before-send'

/**
 * Shows the before-send cost sheet (CS1) for the composer and the message actions. Mount once per route that sends
 * (the chat and the new-chat page). Run sends; Cancel or Esc keeps the draft.
 */
export function BeforeSendHost() {
  const { t } = useTranslation()
  const ask = useStore(beforeSendStore, (s) => s.ask)

  useEffect(() => registerBeforeSendHost(), [])

  return (
    <Sheet
      opened={ask !== null}
      onClose={() => settleCostHeadsUp(false)}
      title={t('This run may cost about {{cost}}', { cost: ask?.cost ?? '' })}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={() => settleCostHeadsUp(false)}>
            {t('Cancel')}
          </button>
          <button type="button" className="dg-btn dg-btn--primary" onClick={() => settleCostHeadsUp(true)}>
            {t('Run')}
          </button>
        </>
      }
    >
      <p className="dg-type-body" style={{ margin: 0 }}>
        {t(
          '{{model}} · about {{tokens}} tokens. You asked to hear about runs over {{limit}}. Change the limit in Settings › Models and keys.',
          { model: ask?.model ?? '', tokens: ask?.tokens ?? '', limit: ask?.limit ?? '' }
        )}
      </p>
    </Sheet>
  )
}
