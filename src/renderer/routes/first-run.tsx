import type { SourceDraft } from '@shared/types/sources'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { ModelStep } from '@/components/first-run/ModelStep'
import { ScopeStep } from '@/components/first-run/ScopeStep'
import type { SourceError } from '@/components/first-run/SourceErrorLine'
import { SourceStep } from '@/components/first-run/SourceStep'
import { TrustStep } from '@/components/first-run/TrustStep'
import { type FirstRunStep, firstRunFrom, useFirstRunResolution } from '@/packages/first-run'

export const Route = createFileRoute('/first-run')({
  component: FirstRunRoute,
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({ from: firstRunFrom(search.from) }),
})

function FirstRunRoute() {
  const navigate = useNavigate()
  const { from } = Route.useSearch()
  const resolution = useFirstRunResolution()
  // The draft picked in step 2, shown in step 3 until it is connected. Never persisted: a relaunch resumes at step 2
  // (the saved step), and leaving the page discards it (SourceStep and ScopeStep remove what the pick set up).
  const [picked, setPicked] = useState<{ draft: SourceDraft; backgroundReview: boolean } | null>(null)
  const [sourceError, setSourceError] = useState<SourceError | undefined>()
  // Back from step 3: step 2 starts with focus on its list.
  const [returned, setReturned] = useState(false)

  // The last step shown here. Finishing step 4 (Trust) opens Review, where FR5's card is, whatever `from` says.
  const lastStep = useRef<FirstRunStep | null>(null)
  if (resolution.show) lastStep.current = resolution.step

  // Nothing to show (completed and a model is back, or opened directly): go back where the user was, query and hash
  // included. The record itself is written by the gate in __root (useFirstRunGate) and by the steps.
  useEffect(() => {
    if (resolution.show) return
    const finishedTrust = lastStep.current !== null && lastStep.current >= 4
    void navigate({ href: finishedTrust ? '/' : (from ?? '/'), replace: true })
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
              setReturned(true)
            }}
            onBack={() => {
              setPicked(null)
              setSourceError(undefined)
              setReturned(true)
            }}
          />
        ) : (
          <SourceStep
            error={sourceError}
            returned={returned}
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

  // Step 4, or a saved step 5 that never completed: Trust. Step 5 itself is FR5's card on Review.
  return (
    <div className="dg-first-run">
      <TrustStep />
    </div>
  )
}
