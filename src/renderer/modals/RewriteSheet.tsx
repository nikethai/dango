import NiceModal, { useModal } from '@ebay/nice-modal-react'
import type { WritingModel, WritingStyle } from '@shared/types/writing'
import { useTranslation } from 'react-i18next'
import { RewritePanel } from '@/components/rewrite'
import { Sheet } from '@/components/ui/Sheet'

export type RewriteSheetProps = {
  text: string
  option: WritingStyle | null
  model?: WritingModel
  onUse?: (text: string) => void
}

export default NiceModal.create(({ text, option, model, onUse }: RewriteSheetProps) => {
  const modal = useModal()
  const { t } = useTranslation()
  const close = () => {
    modal.resolve()
    // Removing immediately aborts the request and releases the draft.
    modal.remove()
  }

  return (
    <Sheet opened={modal.visible} onClose={close} title={t('Rewrite')}>
      <RewritePanel
        text={text}
        option={option}
        model={model}
        onUse={
          onUse
            ? (result) => {
                onUse(result)
                close()
              }
            : undefined
        }
        onBack={close}
      />
    </Sheet>
  )
})
