import type { SourceDraft } from '@shared/types/sources'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FirstRunCard } from '@/components/first-run/FirstRunCard'
import { ModelStep } from '@/components/first-run/ModelStep'
import { ScopeStep } from '@/components/first-run/ScopeStep'
import type { SourceError } from '@/components/first-run/SourceErrorLine'
import { SourceStep } from '@/components/first-run/SourceStep'
import { type FirstRunStep, firstRunFrom, useFirstRunResolution } from '@/packages/first-run'

export const Route = createFileRoute('/first-run')({
  component: FirstRunRoute,
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({ from: firstRunFrom(search.from) }),
})

// Steps 1–3 have their components (Tasks 2–3). Until Task 4 lands, step 4 renders its card with the title only. Step 5 (the first Review) is the card above Review, not a page here; it shows the last step's card until
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
  // The draft picked in step 2, shown in step 3 until it is connected. Never persisted: a relaunch resumes at step 2
  // (the saved step), and leaving the page discards it (SourceStep and ScopeStep remove what the pick set up).
  const [picked, setPicked] = useState<{ draft: SourceDraft; backgroundReview: boolean } | null>(null)
  const [sourceError, setSourceError] = useState<SourceError | undefined>()

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

  if (resolution.step === 2) {
    return (
      <div className="dg-first-run">
        {picked ? (
          <ScopeStep
            draft={picked.draft}
            backgroundReview={picked.backgroundReview}
            onDraftLost={(error) => {
              setPicked(null)
              setSourceError(error)
            }}
          />
        ) : (
          <SourceStep
            error={sourceError}
            onNext={(draft, backgroundReview) => {
              setSourceError(undefined)
              // Skipping saves step 3 (SourceStep), which renders the scope step without a draft.
              if (draft) setPicked({ draft, backgroundReview })
            }}
          />
        )}
      </div>
    )
  }

  if (resolution.step === 3) {
    return (
      <div className="dg-first-run">
        <ScopeStep draft={null} backgroundReview={false} />
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
