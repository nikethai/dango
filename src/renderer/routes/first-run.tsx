import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FirstRunCard } from '@/components/first-run/FirstRunCard'
import { ModelStep } from '@/components/first-run/ModelStep'
import { type FirstRunStep, firstRunFrom, useFirstRunResolution } from '@/packages/first-run'

export const Route = createFileRoute('/first-run')({
  component: FirstRunRoute,
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({ from: firstRunFrom(search.from) }),
})

// Step 1 is the model step (Task 2). Until Tasks 3–4 land their components, a later step renders its card with the
// title only. Step 5 (the first Review) is the card above Review, not a page here; it shows the last step's card until
// then.
const STEP_TITLES: Record<FirstRunStep, string> = {
  1: 'Sign in to a model',
  2: 'Connect a source',
  3: 'Name this scope',
  4: 'How much should it do on its own?',
  5: 'How much should it do on its own?',
}

function FirstRunRoute() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { from } = Route.useSearch()
  const resolution = useFirstRunResolution()

  // Nothing to show (completed and a model is back, or opened directly): go back where the user was, query and hash
  // included. The record itself is written by the gate in __root (useFirstRunGate).
  useEffect(() => {
    if (!resolution.show) void navigate({ href: from ?? '/', replace: true })
  }, [resolution.show, from, navigate])

  if (!resolution.show) return null

  if (resolution.step === 1) {
    return (
      <div className="dg-first-run">
        <ModelStep modelOnly={resolution.modelOnly} from={from} />
      </div>
    )
  }

  return (
    <div className="dg-first-run">
      <FirstRunCard step={resolution.step} title={t(STEP_TITLES[resolution.step])} footer={null}>
        {null}
      </FirstRunCard>
    </div>
  )
}
