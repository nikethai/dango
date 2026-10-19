import NiceModal, { useModal } from '@ebay/nice-modal-react'
import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import type { SourceDraft, SourceKind } from '@shared/types/sources'
import { type ReactNode, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'
import { useScopes } from '@/hooks/useScopes'
import {
  connectSource,
  discardSourceDraft,
  isOAuthClientIdError,
  listSourceKinds,
  MCP_SOURCE_OPTION,
  pickSource,
  revokeSource,
  type SourceChoice,
  SourceRuleError,
  sourceRuleErrorText,
} from '@/packages/sources'
import { pushUndo } from '@/packages/undo'
import platform from '@/platform'
import { SourceKindPicker } from './SourceKindPicker'

export const ADD_SOURCE_MODAL_ID = 'add-source'
/** Where the quick window sends "Add a source": connecting is configuring, which happens in the main window. */
export const SOURCES_SETTINGS_ROUTE = '/settings/sources'

export type AddSourceSheetProps = { scopeId?: string; kind?: SourceKind }
export type AddSourceResult = { sourceId: string } | null

const BACKGROUND_REVIEW_LINE =
  'Lets Dango read this source on a schedule to propose knowledge. Reading never makes anything authoritative.'

async function inQuickWindow(): Promise<boolean> {
  if (!platform.openInMain || !platform.getWindowLabel) return false
  try {
    return (await platform.getWindowLabel()) === 'quick'
  } catch {
    return false
  }
}

/** Opens a settings route: in the main window when called from the quick window, else here. */
export async function openConfiguration(to: string): Promise<void> {
  if (await inQuickWindow()) {
    try {
      await platform.openInMain?.(to)
      return
    } catch (error) {
      console.error('[sources] Could not open the main window', error)
    }
  }
  // Loaded on demand: the router pulls in every route.
  const { router } = await import('@/router')
  await router.navigate({ to: to as never })
}

/**
 * Opens the Add a source sheet. Resolves to the connected source, or null when nothing was connected. `kind` starts
 * that kind at once. From the quick window it opens Sources in the main window instead and resolves null.
 */
export async function openAddSourceSheet(opts: AddSourceSheetProps = {}): Promise<AddSourceResult> {
  if (await inQuickWindow()) {
    await openConfiguration(SOURCES_SETTINGS_ROUTE)
    return null
  }
  return (await NiceModal.show(ADD_SOURCE_MODAL_ID, opts)) as AddSourceResult
}

type ErrorLine = { text: string; action?: { label: string; to: string } }

type Step =
  | { name: 'pick'; error?: ErrorLine; expand?: SourceKind }
  | { name: 'waiting'; kind: SourceKind }
  | { name: 'connect'; draft: SourceDraft; error?: ErrorLine }

/** One line: the first line of the message, clipped. Service messages are external text, shown as is. */
function oneLine(text: string): string {
  const first = text.split('\n', 1)[0].trim()
  return first.length > 160 ? `${first.slice(0, 159)}…` : first
}

function errorLine(error: unknown): ErrorLine {
  if (isOAuthClientIdError(error)) return { text: error.message, action: { label: error.actionLabel, to: error.to } }
  if (error instanceof SourceRuleError) return { text: sourceRuleErrorText(error) }
  return { text: oneLine(error instanceof Error ? error.message : String(error)) }
}

const kindDef = (kind: SourceKind) => listSourceKinds().find((def) => def.kind === kind)

const AddSourceSheet = NiceModal.create(({ scopeId: openedFrom, kind: startKind }: AddSourceSheetProps) => {
  const modal = useModal()
  const { t } = useTranslation()
  const { scopes } = useScopes()
  const scopeLabelId = useId()
  const switchLabelId = useId()
  const [step, setStep] = useState<Step>({ name: 'pick' })
  const [scopeId, setScopeId] = useState('')
  const [backgroundReview, setBackgroundReview] = useState(false)
  const [busy, setBusy] = useState(false)
  const pickController = useRef<AbortController | null>(null)
  const settled = useRef(false)
  // `kind` starts the pick only once, not again when the list comes back.
  const pickedOnce = useRef(false)

  const finish = (result: AddSourceResult) => {
    if (settled.current) return
    settled.current = true
    pickController.current?.abort()
    modal.resolve(result)
    void modal.remove()
  }

  const initialScope = (kind: SourceKind) => {
    const ids = scopes.map((s) => s.id)
    if (kind === 'folder') return openedFrom && ids.includes(openedFrom) ? openedFrom : (ids[0] ?? '')
    return openedFrom && (openedFrom === EVERYWHERE_SCOPE_ID || ids.includes(openedFrom))
      ? openedFrom
      : EVERYWHERE_SCOPE_ID
  }

  const startPick = async (kind: SourceKind, choice?: SourceChoice) => {
    const controller = new AbortController()
    pickController.current = controller
    setStep({ name: 'waiting', kind })
    try {
      const draft = await pickSource(kind, { signal: controller.signal, choice })
      if (controller.signal.aborted) {
        // Cancelled meanwhile: whatever the pick set up is removed again.
        if (draft) await discardSourceDraft(draft).catch((e) => console.warn('[sources] Could not discard', e))
        return
      }
      // No draft: back to the list (Documents keeps its collections open).
      if (!draft) {
        setStep({ name: 'pick', expand: kind === 'documents' ? kind : undefined })
        return
      }
      setScopeId(initialScope(draft.kind))
      setBackgroundReview(false)
      setStep({ name: 'connect', draft })
    } catch (error) {
      if (controller.signal.aborted) return
      setStep({ name: 'pick', error: errorLine(error) })
    } finally {
      if (pickController.current === controller) pickController.current = null
    }
  }

  const cancel = async () => {
    if (busy || settled.current) return
    if (step.name === 'connect') {
      setBusy(true)
      await discardSourceDraft(step.draft).catch((e) => console.warn('[sources] Could not discard the draft', e))
    }
    // During a pick, `finish` aborts it.
    finish(null)
  }

  const openSettings = (to: string) => {
    finish(null)
    void openConfiguration(to).catch((e) => console.error('[sources] Could not open settings', e))
  }

  const connect = async () => {
    if (step.name !== 'connect' || busy || !scopeId) return
    const { draft } = step
    const def = kindDef(draft.kind)
    setBusy(true)
    try {
      const { sourceId } = await connectSource(draft, {
        scopeId,
        backgroundReview: !!def?.supportsBackgroundReview && backgroundReview,
      })
      const scopeName =
        scopeId === EVERYWHERE_SCOPE_ID ? t('Everywhere') : (scopes.find((s) => s.id === scopeId)?.name ?? scopeId)
      finish({ sourceId })
      // The label and scope name are user or service text.
      pushUndo({
        message: t('Connected {{label}} to {{scope}}', { label: draft.label, scope: scopeName }),
        undo: () => revokeSource(sourceId),
        group: 'other',
      })
    } catch (error) {
      setBusy(false)
      // A scope rule error has already discarded the draft: pick again.
      if (error instanceof SourceRuleError) setStep({ name: 'pick', error: errorLine(error) })
      else setStep({ name: 'connect', draft, error: errorLine(error) })
    }
  }

  const def = step.name === 'connect' ? kindDef(step.draft.kind) : undefined
  const title =
    step.name === 'connect' ? t('Connect {{name}}', { name: t(def?.name ?? step.draft.kind) }) : t('Add a source')

  const errorView = (error?: ErrorLine) =>
    error ? (
      <div
        role="alert"
        className="dg-type-caption"
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--dango-space-2)', color: 'var(--dango-danger)' }}
      >
        <span>{error.text}</span>
        {error.action ? (
          <button type="button" className="dg-btn" onClick={() => openSettings(error.action?.to ?? '')}>
            {error.action.label}
          </button>
        ) : null}
      </div>
    ) : null

  const cancelButton = (
    <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={() => void cancel()}>
      {t('Cancel')}
    </button>
  )

  let body: ReactNode
  let actions: ReactNode = cancelButton
  let hint: string | undefined

  if (step.name === 'pick') {
    body = (
      <>
        <SourceKindPicker
          key={step.expand ?? 'list'}
          autoActivate={step.expand ?? (startKind && !pickedOnce.current ? startKind : undefined)}
          onPick={(kind, choice) => {
            pickedOnce.current = true
            void startPick(kind, choice)
          }}
          onMcp={() => openSettings(MCP_SOURCE_OPTION.to)}
          onOpenSettings={openSettings}
        />
        {errorView(step.error)}
      </>
    )
  } else if (step.name === 'waiting') {
    const waitingDef = kindDef(step.kind)
    const text = waitingDef?.connectorId
      ? t('Waiting for the browser…')
      : step.kind === 'folder'
        ? t('Choose a folder in the window that opened.')
        : null
    body = text ? <p className="dg-type-body">{text}</p> : null
  } else {
    const isFolder = step.draft.kind === 'folder'
    const options = [
      ...(isFolder ? [] : [{ id: EVERYWHERE_SCOPE_ID, name: t('Everywhere') }]),
      ...scopes.map((s) => ({ id: s.id, name: s.name })),
    ]
    const showSwitch = !!def?.supportsBackgroundReview
    if (showSwitch) hint = t(BACKGROUND_REVIEW_LINE)
    body = (
      <>
        {/* The draft's label is external text (a folder, address or collection name). */}
        <p className="dg-type-body" style={{ fontWeight: 500, overflowWrap: 'anywhere' }}>
          {step.draft.label}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dango-space-1)' }}>
          <label id={scopeLabelId} htmlFor={`${scopeLabelId}-select`} className="dg-type-caption">
            {t('Scope')}
          </label>
          <select
            id={`${scopeLabelId}-select`}
            value={scopeId}
            disabled={busy}
            onChange={(event) => setScopeId(event.currentTarget.value)}
            style={{
              height: 30,
              padding: '0 var(--dango-space-2)',
              borderRadius: 'var(--dango-radius-md)',
              border: '1px solid var(--dango-control-border)',
              background: 'var(--dango-raised)',
              color: 'var(--dango-ink)',
              font: 'inherit',
            }}
          >
            {options.map((o) => (
              // Scope names are user text.
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {isFolder && options.length === 0 ? (
            <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
              {t('Folders belong to a project or client.')}
            </span>
          ) : null}
        </div>
        {showSwitch ? (
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
              disabled={busy}
              onClick={() => setBackgroundReview((on) => !on)}
            />
          </div>
        ) : null}
        {errorView(step.error)}
      </>
    )
    actions = (
      <>
        {cancelButton}
        <button
          type="button"
          className="dg-btn dg-btn--primary"
          disabled={busy || !scopeId}
          onClick={() => void connect()}
        >
          {t('Connect')}
        </button>
      </>
    )
  }

  return (
    <Sheet opened={modal.visible} onClose={() => void cancel()} title={title} actions={actions} hint={hint}>
      {body}
    </Sheet>
  )
})

export default AddSourceSheet
