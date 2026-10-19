import { type FC, memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { type FirstChatScopeKind, firstChatSuggestions } from '@/utils/firstChatSuggestions'

export type EmptyThreadStateProps = {
  sessionName?: string
  onPickStarter: (fill: string) => void
  /** Compact layout for quick chat / narrow panels */
  compact?: boolean
  /** The chat's scope, when it has one: the suggestions ask about it by name. */
  scopeName?: string
  scopeKind?: FirstChatScopeKind
}

/** EM3: three things to ask in a first chat, as chips; a click fills the composer (never sends). */
export function FirstChatSuggestionChips(props: {
  scopeName?: string
  scopeKind?: FirstChatScopeKind
  onPick: (fill: string) => void
  className?: string
}) {
  const { scopeName, scopeKind = null, onPick, className } = props
  const { t } = useTranslation()
  const suggestions = useMemo(
    () => firstChatSuggestions({ scopeName, scopeKind }, (key) => t(key, { skipInterpolation: true })),
    [scopeName, scopeKind, t]
  )
  return (
    <div className={className ? `dg-starters ${className}` : 'dg-starters'} role="group" aria-label={t('Suggestions')}>
      {suggestions.map((text) => (
        <button key={text} type="button" className="dg-chip" onClick={() => onPick(text)}>
          {text}
        </button>
      ))}
    </div>
  )
}

/**
 * Quiet empty-thread stage: greeting, then three first-chat suggestions.
 * Composer stays in the session dock.
 */
const EmptyThreadState: FC<EmptyThreadStateProps> = ({
  sessionName,
  compact = false,
  onPickStarter,
  scopeName,
  scopeKind = null,
}) => {
  const { t } = useTranslation()

  const hasName = Boolean(sessionName && sessionName !== 'Untitled')
  // Compact (Quick Chat): short invite. Full session: session name or default greeting.
  const title = compact ? t('Ask anything') : hasName ? sessionName! : t('Ready when you are')

  return (
    <div
      className={compact ? 'empty-thread empty-thread--compact' : 'empty-thread'}
      role="region"
      aria-label={t('Empty conversation')}
    >
      <div className="empty-thread-stage">
        <h2 className="empty-thread-title blank-enter">{title}</h2>
        <FirstChatSuggestionChips scopeName={scopeName} scopeKind={scopeKind} onPick={onPickStarter} />
      </div>
    </div>
  )
}

export default memo(EmptyThreadState)
