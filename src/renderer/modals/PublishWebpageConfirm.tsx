import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'

/**
 * Asks before "Publish Webpage" uploads a code block's HTML to EdgeOne Pages (Tencent), a third-party host.
 * Resolves true on Publish, false on Cancel or dismiss. Sending content off the device always asks (flow 7).
 */
const PublishWebpageConfirm = NiceModal.create(() => {
  const modal = useModal()
  const { t } = useTranslation()

  const close = (publish: boolean) => {
    modal.resolve(publish)
    void modal.hide()
  }

  return (
    <Sheet
      opened={modal.visible}
      onClose={() => close(false)}
      title={t('Publish this page to the web?')}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={() => close(false)}>
            {t('Cancel')}
          </button>
          <button type="button" className="dg-btn dg-btn--primary" onClick={() => close(true)}>
            {t('Publish')}
          </button>
        </>
      }
    >
      <p className="dg-type-body">
        {t(
          'Dango will upload this HTML to EdgeOne Pages, a hosting service run by Tencent, and give you a link. Anyone with the link can open the page.'
        )}
      </p>
    </Sheet>
  )
})

export default PublishWebpageConfirm
