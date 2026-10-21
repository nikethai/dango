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
}

/**
 * FR3: names the scope the first source goes into, creates it (or reuses one with the same name), then connects the
 * draft and moves to step 4. A scope created before a failed connect stays.
 */
export function ScopeStep({ draft, backgroundReview, onDraftLost }: ScopeStepProps) {
  const { t } = useTranslation()
  const { scopes, addScope } = useScopes()
  const kindLabelId = useId()
  const [name, setName] = useState(() => (draft ? suggestScopeName(draft) : ''))
  const [kind, setKind] = useState<ScopeKind>(() => (draft ? defaultScopeKind(draft.kind) : 'project'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<SourceError | undefined>()
  // Connected, or discarded by connectSource: nothing left to undo.
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
        void discardSourceDraft(draftRef.current).catch((e) => console.warn('[first-run] Could not discard', e))
      })
    }
  }, [])

  const trimmed = name.trim()
  const problem = validateScopeName(name)
  const lower = trimmed.toLowerCase()
  const existing = problem ? undefined : scopes.find((scope) => scope.name.trim().toLowerCase() === lower)

  const submit = async () => {
    if (problem || busy) return
    setBusy(true)
    setError(undefined)
    const scopeId = existing?.id ?? addScope({ name: trimmed, kind }).id
    if (!draft) {
      setFirstRun({ step: 4, scopeId })
      return
    }
    try {
      const { sourceId, jobId } = await connectSource(draft, { scopeId, backgroundReview })
      settled.current = true
      setFirstRun({ step: 4, scopeId, firstReadJobId: jobId, firstReadSourceId: sourceId })
    } catch (e) {
      const line = sourceErrorLine(e)
      setBusy(false)
      if (draftWasDiscarded(e) && onDraftLost) {
        settled.current = true
        onDraftLost(line)
        return
      }
      // The scope stays: it is still useful, and Continue reuses it by name.
      setError(line)
    }
  }

  return (
    <FirstRunCard
      step={3}
      title={t('Name this scope')}
      lead={t('A scope is one project or one client. Everything Dango learns from this source stays inside it.')}
      footer={
        <button
          type="button"
          className="dg-btn dg-btn--primary"
          disabled={Boolean(problem) || busy}
          aria-busy={busy || undefined}
          onClick={() => void submit()}
        >
          {t('Continue')}
        </button>
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
            value={kind}
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
