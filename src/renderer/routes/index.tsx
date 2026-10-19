import { createFileRoute, redirect } from '@tanstack/react-router'
import { zodValidator } from '@tanstack/zod-adapter'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import Page from '@/components/layout/Page'
import { ReviewHome } from '@/components/review/ReviewHome'
import { useSources, useSourcesLoaded } from '@/packages/sources'

// Hand-edited URLs: numbers become strings, anything else is dropped instead of throwing.
const lenientId = z
  .union([z.string(), z.number().transform(String)])
  .optional()
  .catch(undefined)

export const Route = createFileRoute('/')({
  validateSearch: zodValidator(z.object({ scope: lenientId, copilotId: lenientId })),
  beforeLoad: ({ search }) => {
    // Old links (`/?copilotId=`) keep landing on /new.
    if (search.copilotId) throw redirect({ to: '/new', search: { copilotId: search.copilotId }, replace: true })
  },
  component: Index,
})

function Index() {
  const { t } = useTranslation()
  const sources = useSources()
  // Unknown until the stored sources are read (R4): ReviewHome then keeps its stand-in instead of flashing EM2.
  const loaded = useSourcesLoaded()
  return (
    <Page title={t('Review')}>
      <ReviewHome sourceCount={loaded ? sources.length : undefined} />
    </Page>
  )
}
