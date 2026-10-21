import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { FirstRunCard } from '@/components/first-run/FirstRunCard'
import { type FirstRunStep, firstRunFrom, setFirstRun, useFirstRunResolution } from '@/packages/first-run'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/first-run')({
  component: FirstRunRoute,
  validateSearch: (search: Record<string, unknown>): { from?: string } => ({ from: firstRunFrom(search.from) }),
})

// Until Tasks 2–4 land each step's component, a step renders its card with the title only. Step 5 (the first Review)
// is the card above Review, not a page here; it shows the last step's card until then.
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
  const record = useSettingsStore((s) => s.firstRun)
  const resolution = useFirstRunResolution()

  // Save that first run has started, so a model added from Settings › Models and keys resumes at step 2 rather than
  // reading as an upgrade (no record and a model) and skipping first run.
  useEffect(() => {
    if (resolution.show && !record) setFirstRun({ step: 1 })
  }, [resolution.show, record])

  // Nothing to show (completed and a model is back, or opened directly): go back where the user was.
  useEffect(() => {
    if (!resolution.show) void navigate({ to: from ?? '/', replace: true })
  }, [resolution.show, from, navigate])

  if (!resolution.show) return null

  return (
    <div className="dg-first-run">
      <FirstRunCard step={resolution.step} title={t(STEP_TITLES[resolution.step])} footer={null}>
        {null}
      </FirstRunCard>
    </div>
  )
}
