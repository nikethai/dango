import { openConfiguration } from '@/components/sources/openConfiguration'
import { isOAuthClientIdError, SourceRuleError, sourceRuleErrorText } from '@/packages/sources'

/** A one-line error under a first-run step, with an optional settings link (an OAuth client id is missing). */
export type SourceError = { text: string; action?: { label: string; to: string } }

/** The first line of a message, clipped. Service messages are external text, shown as is. */
function oneLine(text: string): string {
  const first = text.split('\n', 1)[0].trim()
  return first.length > 160 ? `${first.slice(0, 159)}…` : first
}

/** The error text as the Add a source sheet shows it (slice 7). */
export function sourceErrorLine(error: unknown): SourceError {
  if (isOAuthClientIdError(error)) return { text: error.message, action: { label: error.actionLabel, to: error.to } }
  if (error instanceof SourceRuleError) return { text: sourceRuleErrorText(error) }
  return { text: oneLine(error instanceof Error ? error.message : String(error)) }
}

/** The error line (`role="alert"`); its settings link opens where the missing setting lives. */
export function SourceErrorLine({ error }: { error?: SourceError }) {
  if (!error) return null
  const { action } = error
  return (
    <div role="alert" className="dg-type-caption dg-first-run__error">
      <span>{error.text}</span>
      {action ? (
        <button
          type="button"
          className="dg-btn"
          onClick={() => void openConfiguration(action.to).catch((e) => console.error('[first-run] Could not open', e))}
        >
          {/* Already translated by the error. */}
          {action.label}
        </button>
      ) : null}
    </div>
  )
}
