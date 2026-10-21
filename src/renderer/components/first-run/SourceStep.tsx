import type { SourceDraft, SourceKind } from '@shared/types/sources'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openConfiguration } from '@/components/sources/openConfiguration'
import { SourceKindPicker } from '@/components/sources/SourceKindPicker'
import { setFirstRun } from '@/packages/first-run/firstRun'
import {
  BACKGROUND_REVIEW_LINE,
  discardSourceDraft,
  getSourceKind,
  MCP_SOURCE_OPTION,
  pickSource,
  type SourceChoice,
} from '@/packages/sources'
import { FirstRunCard } from './FirstRunCard'
import { type SourceError, SourceErrorLine, sourceErrorLine } from './SourceErrorLine'

export type SourceStepProps = {
  /** A picked draft and whether to review it in the background, or null when skipped. Connects nothing. */
  onNext: (draft: SourceDraft | null, backgroundReview: boolean) => void
  /** An error handed back from step 3 (its connect failed and the draft is gone). */
  error?: SourceError
  /** Back from step 3 ("Change", or the draft was lost): focus starts on the kind list. */
  returned?: boolean
}

function discard(draft: SourceDraft) {
  void discardSourceDraft(draft).catch((e) => console.warn('[first-run] Could not discard the draft', e))
}

/**
 * FR2: picks one source with slice 7's kind list. A pick only makes a draft; step 3 connects it. Every exit that does
 * not hand the draft on (Change, Skip, leaving the page) removes what the pick set up, and an open picker or browser
 * sign-in is aborted, so cancelling leaves nothing connected.
 */
export function SourceStep({ onNext, error: initialError, returned = false }: SourceStepProps) {
  const { t } = useTranslation()
  const switchLabelId = useId()
  const switchLineId = useId()
  const switchOffId = useId()
  const [draft, setDraft] = useState<SourceDraft | null>(null)
  const [waiting, setWaiting] = useState<{ kind: SourceKind; choice?: SourceChoice } | null>(null)
  const [error, setError] = useState<SourceError | undefined>(initialError)
  const [backgroundReview, setBackgroundReview] = useState(true)
  const pickController = useRef<AbortController | null>(null)
  // The draft this step still owns: discarded on unmount unless it was handed to step 3.
  const ownedDraft = useRef<SourceDraft | null>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const skipRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  // When the content swaps (a pick lands, Change, back from step 3) the focused control is gone: move focus to
  // Continue when it is enabled, else the first enabled kind row (Skip when none is), never the body.
  const [focusRequest, setFocusRequest] = useState(returned ? 1 : 0)
  useEffect(() => {
    if (!focusRequest) return
    const target =
      (continueRef.current && !continueRef.current.disabled ? continueRef.current : null) ??
      listRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])') ??
      skipRef.current
    target?.focus()
  }, [focusRequest])
  const requestFocus = () => setFocusRequest((n) => n + 1)

  // Checked a tick later, so a StrictMode remount (cleanup, then setup again at once) keeps the pick and the draft.
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      queueMicrotask(() => {
        if (mounted.current) return
        pickController.current?.abort()
        if (ownedDraft.current) discard(ownedDraft.current)
        ownedDraft.current = null
      })
    }
  }, [])

  const cancelPick = () => {
    pickController.current?.abort()
    pickController.current = null
    setWaiting(null)
  }

  const startPick = async (kind: SourceKind, choice?: SourceChoice) => {
    // One pick at a time: a new one aborts the open picker or sign-in.
    pickController.current?.abort()
    const controller = new AbortController()
    pickController.current = controller
    setError(undefined)
    setWaiting({ kind, choice })
    try {
      const picked = await pickSource(kind, { signal: controller.signal, choice })
      if (controller.signal.aborted) {
        // Cancelled meanwhile: whatever the pick set up is removed again.
        if (picked) discard(picked)
        return
      }
      setWaiting(null)
      // Null: the picker was cancelled or the sign-in abandoned. Nothing was set up; the list stays.
      if (!picked) return
      ownedDraft.current = picked
      setDraft(picked)
      requestFocus()
      // On for this first source (FR2), unlike the Add a source sheet.
      setBackgroundReview(true)
    } catch (e) {
      if (controller.signal.aborted) return
      setWaiting(null)
      setError(sourceErrorLine(e))
    } finally {
      if (pickController.current === controller) pickController.current = null
    }
  }

  const change = () => {
    if (ownedDraft.current) discard(ownedDraft.current)
    ownedDraft.current = null
    setDraft(null)
    requestFocus()
  }

  const skip = () => {
    cancelPick()
    if (ownedDraft.current) discard(ownedDraft.current)
    ownedDraft.current = null
    setFirstRun({ step: 3, sourceSkipped: true })
    onNext(null, false)
  }

  const supportsReview = !!draft && !!getSourceKind(draft.kind)?.supportsBackgroundReview

  const next = () => {
    if (!draft) return
    // Step 3 owns the draft from here.
    ownedDraft.current = null
    onNext(draft, supportsReview && backgroundReview)
  }

  const waitingText = (() => {
    if (!waiting) return null
    // The browser opens only to sign in; an account already signed in is used without it.
    if (getSourceKind(waiting.kind)?.connectorId)
      return waiting.choice?.accountId ? null : t('Waiting for the browser…')
    return waiting.kind === 'folder' ? t('Choose a folder in the window that opened.') : null
  })()

  return (
    <FirstRunCard
      step={2}
      title={t('Connect a source')}
      lead={t('A source is where Dango reads from. Pick one to start; add more later in Settings.')}
      footer={
        <>
          <button ref={skipRef} type="button" className="dg-btn dg-btn--ghost" onClick={skip}>
            {t('Skip for now')}
          </button>
          <button ref={continueRef} type="button" className="dg-btn dg-btn--primary" disabled={!draft} onClick={next}>
            {t('Continue')}
          </button>
        </>
      }
    >
      <div className="dg-first-run__panel">
        {draft ? (
          <>
            <div className="dg-first-run__selected">
              <span className="dg-type-body">{t('Selected:')}</span>
              {/* The draft's label is external text (a folder, address or collection name). */}
              <span className="dg-type-body dg-first-run__mono">{draft.label}</span>
              <button type="button" className="dg-btn dg-btn--ghost" onClick={change}>
                {t('Change')}
              </button>
            </div>
            {supportsReview ? (
              <div className="dg-first-run__switch">
                <div className="dg-insp__row" style={{ alignItems: 'center' }}>
                  <span id={switchLabelId} className="dg-type-body">
                    {t('Background review')}
                  </span>
                  <button
                    type="button"
                    role="switch"
                    className="dg-switch"
                    aria-checked={backgroundReview ? 'true' : 'false'}
                    aria-labelledby={switchLabelId}
                    aria-describedby={draft.kind === 'gmail' ? `${switchLineId} ${switchOffId}` : switchLineId}
                    onClick={() => setBackgroundReview((on) => !on)}
                  />
                </div>
                <span id={switchLineId} className="dg-type-caption dg-first-run__choice-line">
                  {t(BACKGROUND_REVIEW_LINE)}
                </span>
                {/* B6: with the switch off, Gmail mail is only synced and stored. */}
                {draft.kind === 'gmail' ? (
                  <span id={switchOffId} className="dg-type-caption dg-first-run__choice-line">
                    {t("Off: Dango keeps new mail for search but doesn't read it with a model or write drafts.")}
                  </span>
                ) : null}
              </div>
            ) : null}
          </>
        ) : (
          <>
            <div ref={listRef}>
              <SourceKindPicker
                onPick={(kind, choice) => void startPick(kind, choice)}
                onMcp={() =>
                  void openConfiguration(MCP_SOURCE_OPTION.to).catch((e) =>
                    console.error('[first-run] Could not open', e)
                  )
                }
              />
            </div>
            {waitingText ? (
              <div className="dg-first-run__waiting">
                <span className="dg-type-body">{waitingText}</span>
                <button type="button" className="dg-btn dg-btn--ghost" onClick={cancelPick}>
                  {t('Cancel')}
                </button>
              </div>
            ) : null}
          </>
        )}
        <SourceErrorLine error={error} />
      </div>
    </FirstRunCard>
  )
}
