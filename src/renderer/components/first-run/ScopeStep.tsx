import { TextInput } from '@mantine/core'
import type { ScopeKind } from '@shared/types'
import type { SourceDraft } from '@shared/types/sources'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SegmentedControl from '@/components/common/SegmentedControl'
import { useScopes } from '@/hooks/useScopes'
import { setFirstRun } from '@/packages/first-run/firstRun'
import { defaultScopeKind, suggestScopeName } from '@/packages/first-run/scopeName'
import { connectSource, discardSourceDraft, draftWasDiscarded } from '@/packages/sources'
import { validateScopeName } from '@/projects/scope-store'
import { FirstRunCard } from './FirstRunCard'
import { type SourceError, SourceErrorLine, sourceErrorLine } from './SourceErrorLine'

export type ScopeStepProps = {
  /** The draft step 2 picked, or null when the source was skipped. */
  draft: SourceDraft | null
  backgroundReview: boolean
  /** Connecting failed and discarded the draft (a scope rule error): step 2 shows `error` and picks again. */
  onDraftLost?: (error: SourceError) => void
  /** "Change": the draft is discarded and step 2 picks again. Shown only with a draft. */
  onBack?: () => void
}

function discard(draft: SourceDraft) {
  void discardSourceDraft(draft).catch((e) => console.warn('[first-run] Could not discard the draft', e))
}

/**
 * FR3: names the scope the first source goes into, creates it (or reuses one with the same name), then connects the
 * draft and moves to step 4. A scope created before a failed connect stays.
 */
export function ScopeStep({ draft, backgroundReview, onDraftLost, onBack }: ScopeStepProps) {
  const { t } = useTranslation()
  const { scopes, addScope } = useScopes()
  const kindLabelId = useId()
  const [name, setName] = useState(() => (draft ? suggestScopeName(draft) : ''))
  const [kind, setKind] = useState<ScopeKind>(() => (draft ? defaultScopeKind(draft.kind) : 'project'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SourceError | undefined>()
  // Not this step's to discard: being connected, connected, or already discarded.
  const settled = useRef(false)
  const draftRef = useRef(draft)
  draftRef.current = draft

  // Leaving without connecting removes what the pick set up. Checked a tick later for a StrictMode remount.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (mounted.current || settled.current || !draftRef.current) return
        discard(draftRef.current)
      })
    }
  }, [])

  const trimmed = name.trim()
  const problem = validateScopeName(name)
  const lower = trimmed.toLowerCase()
  const existing = problem ? undefined : scopes.find((scope) => scope.name.trim().toLowerCase() === lower)
  // A reused scope keeps its kind: show it, and the choice does not apply.
  const shownKind = existing?.kind ?? kind

  const submit = async () => {
    if (problem || busy) return
    setBusy(true)
    setError(undefined)
    const scopeId = existing?.id ?? addScope({ name: trimmed, kind }).id
    if (!draft) {
      setFirstRun({ step: 4, scopeId })
      return
    }
    // While connecting, the draft is being attached: leaving now must not discard it.
    settled.current = true
    try {
      const { sourceId, jobId } = await connectSource(draft, { scopeId, backgroundReview })
      setFirstRun({ step: 4, scopeId, firstReadJobId: jobId, firstReadSourceId: sourceId })
    } catch (e) {
      const line = sourceErrorLine(e)
      if (draftWasDiscarded(e)) {
        setBusy(false)
        if (onDraftLost) onDraftLost(line)
        else setError(line)
        return
      }
      // The draft is still alive: the step owns it again, or discards it when the step is already gone.
      settled.current = false
      if (!mounted.current) {
        discard(draft)
        return
      }
      setBusy(false)
      // The scope stays: it is still useful, and Continue reuses it by name.
      setError(line)
    }
  }

  const back = () => {
    if (busy || !draft || !onBack) return
    settled.current = true
    discard(draft)
    onBack()
  }

  return (
    <FirstRunCard
      step={3}
      title={t('Name this scope')}
      lead={t('A scope is one project or one client. Everything Dango learns from this source stays inside it.')}
      footer={
        <>
          {draft && onBack ? (
            <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={back}>
              {t('Change')}
            </button>
          ) : null}
          <button
            type="button"
            className="dg-btn dg-btn--primary"
            disabled={Boolean(problem) || busy}
            aria-busy={busy || undefined}
            onClick={() => void submit()}
          >
            {t('Continue')}
          </button>
        </>
      }
    >
      <div className="dg-first-run__panel">
        <TextInput
          label={t('Name')}
          value={name}
          error={problem === 'reserved' ? t('Everywhere is built in. Pick another name.') : undefined}
          styles={{ input: { background: 'var(--dango-raised)', borderColor: 'var(--dango-control-border)' } }}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
        {existing && draft ? (
          <span className="dg-type-caption dg-first-run__choice-line">
            {/* The scope name is user text. */}
            {t('{{name}} already exists. Continue adds this source to it.', { name: existing.name })}
          </span>
        ) : null}
        <div className="dg-first-run__group">
          <span id={kindLabelId} className="dg-type-body" style={{ fontWeight: 500 }}>
            {t('Is this a project or a client?')}
          </span>
          <SegmentedControl
            aria-labelledby={kindLabelId}
            value={shownKind}
            disabled={Boolean(existing)}
            onChange={(value) => setKind(value as ScopeKind)}
            data={[
              { label: t('Project'), value: 'project' },
              { label: t('Client'), value: 'client' },
            ]}
          />
          <span className="dg-type-caption dg-first-run__choice-line">
            {t("Client scopes don't read your Everywhere documents unless you turn that on.")}
          </span>
        </div>
        <SourceErrorLine error={error} />
      </div>
    </FirstRunCard>
  )
}
