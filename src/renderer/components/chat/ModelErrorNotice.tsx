import { ProviderAPIError } from '@shared/models/errors'
import type { Message } from '@shared/types'
import { type ReactNode, useEffect, useState, useSyncExternalStore } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useCopied } from '@/hooks/useCopied'
import { formatDangoDuration } from '@/hooks/useThinkingTimer'
import { navigateToSettings } from '@/modals/Settings'
import {
  classifyModelError,
  type ModelErrorKind,
  modelErrorProviderId,
  modelErrorProviderName,
} from '@/packages/model-errors/classify'
import { isApprovedPlanRun } from '@/packages/plan/planSteps'
import {
  cancelRateLimitRetry,
  clearRateLimitAttempts,
  isRateLimitRetryPending,
  subscribeRateLimitRetries,
} from '@/stores/session/rate-limit-retry'
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

/** Can't paint (10003) and no chat API (10005) fail the same way on every retry. */
const REPEATING_ERROR_CODES = new Set([10003, 10005])

/**
 * A legacy Dango error sentence. Keys without component tags go through t(), so React escapes the model name; keys
 * with tags need Trans, so the model name loses its angle brackets and can never become markup.
 */
function LegacySentence({ i18nKey, model }: { i18nKey: string; model?: string }) {
  const { t } = useTranslation()
  const supported = 'gemini-2.0-flash(API), perplexity API'
  if (!/<\w+>/.test(i18nKey)) {
    return <>{t(i18nKey, { model, supported_web_browsing_models: supported })}</>
  }
  return (
    <Trans
      i18nKey={i18nKey}
      values={{ model: (model ?? '').replace(/[<>]/g, ''), supported_web_browsing_models: supported }}
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
  )
}

type Fix = { label: string; run(): unknown }

/** Time left before the scheduled rate-limit retry, ticking each second; undefined when no retry is waiting. */
function useRateLimitWait(sessionId: string, msg: Message): number | undefined {
  const pending = useSyncExternalStore(subscribeRateLimitRetries, () => isRateLimitRetryPending(sessionId, msg.id))
  const retryAt = typeof msg.errorExtra?.retryAt === 'number' ? msg.errorExtra.retryAt : undefined
  const [now, setNow] = useState(() => Date.now())
  const waiting = pending && retryAt !== undefined
  useEffect(() => {
    if (!waiting) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [waiting])
  return waiting ? Math.max(0, retryAt - now) : undefined
}

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
  const waitMs = useRateLimitWait(sessionId, msg)

  if (!msg.error) return null

  const kind: ModelErrorKind = classifyModelError(msg)
  const providerId = modelErrorProviderId(msg)
  const provider = modelErrorProviderName(providerId, customProviders) ?? t('AI provider')
  const host = typeof msg.errorExtra?.host === 'string' && msg.errorExtra.host ? msg.errorExtra.host : provider
  const openProvider = () => navigateToSettings(providerId ? `/provider/${providerId}` : '/provider')
  // A known Dango error (missing search key, model can't read images…) already says what to do; keep that sentence.
  const legacy = kind === 'provider' && msg.errorCode ? ProviderAPIError.getDetail(msg.errorCode) : null
  // Retrying these would fail the same way: the setting or the model has to change first.
  const repeats = !!legacy || (msg.errorCode !== undefined && REPEATING_ERROR_CODES.has(msg.errorCode))
  const retry: Fix | undefined =
    // An approved plan's execution run: its card's Continue is the fix, so the notice offers no Retry.
    isApprovedPlanRun(msg) || repeats
      ? undefined
      : {
          label: t('Retry'),
          run: () =>
            import('@/stores/session/retry').then(({ retryFailedMessage }) => retryFailedMessage(sessionId, msg)),
        }

  let sentence: ReactNode
  let fix: Fix | undefined
  switch (kind) {
    case 'budget':
      sentence = t("You've reached your usage budget.")
      fix = { label: t('Open Usage'), run: () => navigateToSettings('/usage') }
      break
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
    case 'rate-limit':
      // ER3: retried on schedule, then a Needs you entry. Stop or a new send cancels the wait: plain Retry then.
      if (msg.errorExtra?.rateLimitGaveUp === true) {
        sentence = t("{{provider}} is still limiting requests. It's waiting in Review.", { provider })
        // The person asked: if this fails again, the schedule starts over.
        fix = retry && {
          label: t('Retry'),
          run: () => {
            clearRateLimitAttempts(msg.id)
            return retry.run()
          },
        }
      } else if (waitMs !== undefined) {
        sentence = t('{{provider}} is limiting requests. Trying again in {{time}}.', {
          provider,
          time: formatDangoDuration(waitMs),
        })
        // Counts as the next attempt.
        fix = retry && {
          label: t('Retry now'),
          run: () => {
            cancelRateLimitRetry(sessionId)
            return retry.run()
          },
        }
      } else {
        sentence = t('{{provider}} is limiting requests.', { provider })
        fix = retry
      }
      break
    default:
      sentence = legacy ? (
        <LegacySentence i18nKey={legacy.i18nKey} model={msg.model} />
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
