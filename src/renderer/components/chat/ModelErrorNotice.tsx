import { ProviderAPIError } from '@shared/models/errors'
import type { Message } from '@shared/types'
import { type ReactNode, useState } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useCopied } from '@/hooks/useCopied'
import { navigateToSettings } from '@/modals/Settings'
import { classifyModelError, type ModelErrorKind, modelErrorProviderName } from '@/packages/model-errors/classify'
import { useSettingsStore } from '@/stores/settingsStore'

function rawDetail(msg: Message): string {
  const body = msg.errorExtra?.responseBody
  if (body === undefined || body === null || body === '') return msg.error ?? ''
  let pretty = String(body)
  try {
    pretty = JSON.stringify(JSON.parse(pretty), null, 2)
  } catch {
    // not JSON: show as sent
  }
  return msg.error ? `${msg.error}\n\n${pretty}` : pretty
}

function SettingsLink({ children, onClick }: { children?: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className="msg-error-link" onClick={onClick}>
      {children}
    </button>
  )
}

/** An execution run of an approved plan: its card's Continue is the fix, so the notice offers no Retry. */
function isPlanRun(msg: Message): boolean {
  return msg.contentParts.some((part) => part.type === 'plan' && part.status === 'approved')
}

type Fix = { label: string; run(): unknown }

/**
 * A failed model call under its answer (ER1, ER2, ER5, CH5): one sentence that says what happened, one button that
 * names the fix, and the raw detail behind "Show details". Never switches models; the composer stays usable.
 */
export function ModelErrorNotice(props: { msg: Message; sessionId: string }) {
  const { msg, sessionId } = props
  const { t } = useTranslation()
  const customProviders = useSettingsStore((state) => state.customProviders)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState(false)
  const detail = rawDetail(msg)
  const { copied, copy } = useCopied(detail)

  if (!msg.error) return null

  const kind: ModelErrorKind = classifyModelError(msg)
  const providerId =
    typeof msg.errorExtra?.aiProvider === 'string' && msg.errorExtra.aiProvider
      ? msg.errorExtra.aiProvider
      : msg.aiProvider
  const provider = modelErrorProviderName(providerId, customProviders) ?? t('AI provider')
  const host = typeof msg.errorExtra?.host === 'string' && msg.errorExtra.host ? msg.errorExtra.host : provider
  const openProvider = () => navigateToSettings(providerId ? `/provider/${providerId}` : '/provider')
  const retry: Fix | undefined = isPlanRun(msg)
    ? undefined
    : {
        label: t('Retry'),
        run: () =>
          import('@/stores/session/retry').then(({ retryFailedMessage }) => retryFailedMessage(sessionId, msg)),
      }
  // A known Dango error (missing search key, model can't read images…) already says what to do; keep that sentence.
  const legacy = kind === 'provider' && msg.errorCode ? ProviderAPIError.getDetail(msg.errorCode) : null

  let sentence: ReactNode
  let fix: Fix | undefined
  switch (kind) {
    case 'invalid-key':
      sentence = t('Your {{provider}} key was rejected.', { provider })
      fix = { label: t('Update key'), run: openProvider }
      break
    case 'out-of-credit':
      sentence = t('Your {{provider}} account is out of credit.', { provider })
      fix = { label: t('Add credit'), run: openProvider }
      break
    case 'too-long':
      sentence = t('This chat is too long for {{model}}.', { model: msg.model || provider })
      fix = {
        label: t('Start a new chat with a summary'),
        run: () =>
          import('@/stores/session/new-chat-with-summary').then(({ startNewChatWithSummary }) =>
            startNewChatWithSummary(sessionId)
          ),
      }
      break
    case 'network':
      sentence = t("Couldn't reach {{host}}.", { host })
      fix = retry
      break
    default:
      // 'provider', and 'rate-limit' until its waiting states land (ER3).
      sentence = legacy ? (
        <Trans
          i18nKey={legacy.i18nKey}
          values={{ model: msg.model, supported_web_browsing_models: 'gemini-2.0-flash(API), perplexity API' }}
          components={{
            OpenSettingButton: <SettingsLink onClick={() => navigateToSettings()} />,
            OpenExtensionSettingButton: <SettingsLink onClick={() => navigateToSettings('/web-search')} />,
            OpenMorePlanButton: <SettingsLink onClick={() => navigateToSettings('/provider')} />,
            LinkToHomePage: <span />,
            LinkToAdvancedFileProcessing: <span />,
            LinkToAdvancedUrlProcessing: <span />,
            OpenDocumentParserSettingButton: <SettingsLink onClick={() => navigateToSettings('/document-parser')} />,
          }}
        />
      ) : (
        t('{{provider}} returned an error.', { provider })
      )
      fix = retry
  }

  const runFix = async () => {
    if (!fix || busy) return
    setBusy(true)
    try {
      await fix.run()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="msg-error-tips message-error-tips" role="alert">
      <div className="msg-error-tips-body">
        <p className="msg-error-tips-line dg-type-callout">{sentence}</p>
      </div>
      <div className="dg-model-error__actions">
        {fix ? (
          <button type="button" className="dg-btn dg-btn--primary" disabled={busy} onClick={() => void runFix()}>
            {fix.label}
          </button>
        ) : null}
        <button
          type="button"
          className="dg-btn dg-btn--ghost"
          aria-expanded={expanded}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded ? t('Hide details') : t('Show details')}
        </button>
        {expanded ? (
          <button type="button" className="dg-btn dg-btn--ghost" onClick={copy}>
            {copied ? t('Copied') : t('Copy')}
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="msg-error-detail">
          <div className="msg-error-detail-text dg-type-caption whitespace-pre-wrap break-all">{detail}</div>
        </div>
      ) : null}
    </div>
  )
}
