import { useTranslation } from 'react-i18next'
import { EverywhereKnowledge } from '@/components/knowledge/EverywhereKnowledge'
import Page from '@/components/layout/Page'

export function EverywherePage() {
  const { t } = useTranslation()
  return (
    <Page title={t('Everywhere')}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 py-4">
        <div className="flex flex-col gap-1">
          <h2 className="dg-type-title-2">{t('Everywhere')}</h2>
          <p style={{ margin: 0 }}>{t("Read by every scope. A scope's own knowledge wins inside that scope.")}</p>
        </div>
        <section data-section="preferences" className="flex flex-col gap-2">
          <h3 className="dg-type-headline">{t('Preferences')}</h3>
          <EverywhereKnowledge section="preferences" />
        </section>
        <section data-section="facts" className="flex flex-col gap-2">
          <h3 className="dg-type-headline">{t('Facts')}</h3>
          <EverywhereKnowledge section="facts" />
        </section>
        <section data-section="documents" className="flex flex-col gap-2">
          <h3 className="dg-type-headline">{t('Documents')}</h3>
          <p style={{ margin: 0 }}>
            {t(
              'Documents connected to Everywhere will appear here. Client scopes read them only when you turn that on.'
            )}
          </p>
        </section>
      </div>
    </Page>
  )
}
