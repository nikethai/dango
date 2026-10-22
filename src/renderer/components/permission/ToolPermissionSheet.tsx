import { type CSSProperties, useLayoutEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Sheet } from '@/components/ui/Sheet'
import {
  alwaysAsksByEffect,
  isCommandTool,
  type PermissionChoice,
  type PermissionRequest,
} from '@/packages/tool-permission'

export type ToolPermissionSheetProps = {
  request: PermissionRequest | null
  onChoose(choice: PermissionChoice): void
}

const MAX_TOUCHES = 5
/**
 * Each new head ignores clicks this long, so a click or Enter meant for the composer, Stop or the previous sheet
 * can't answer it.
 */
const NEW_HEAD_GUARD_MS = 400

const touchStyle: CSSProperties = {
  fontFamily: 'var(--dango-font-mono)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
}

/** Dango's own account of a recognised command: a warning block with a danger rule on the leading edge. */
const explainsStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--dango-space-1)',
  paddingInlineStart: 'var(--dango-space-2)',
  borderInlineStart: '2px solid var(--dango-danger)',
}

/** Asks before a tool call runs. Tool-provided text (what, why, touches) and command targets in `explains` render as plain React children. */
export function ToolPermissionSheet({ request, onChoose }: ToolPermissionSheetProps) {
  const { t } = useTranslation()
  const allowRef = useRef<HTMLButtonElement>(null)
  const shownIdRef = useRef<string | null>(null)
  const guardedRef = useRef(false)
  const requestId = request?.id ?? null

  // Layout effect: the guard is up before the new sheet paints.
  useLayoutEffect(() => {
    const previous = shownIdRef.current
    shownIdRef.current = requestId
    if (!requestId) return
    // First open: the Sheet focuses Allow once itself. A new head while open: refocus it.
    if (previous && previous !== requestId) allowRef.current?.focus()
    guardedRef.current = true
    const timer = setTimeout(() => {
      guardedRef.current = false
    }, NEW_HEAD_GUARD_MS)
    return () => {
      clearTimeout(timer)
      guardedRef.current = false
    }
  }, [requestId])

  if (!request) return null

  const choose = (choice: PermissionChoice) => {
    if (guardedRef.current) return
    onChoose(choice)
  }
  const { what, why, touches, explains } = request.summary
  const shown = touches.slice(0, MAX_TOUCHES)
  const hidden = touches.length - shown.length

  return (
    <Sheet
      opened
      onClose={() => choose('deny')}
      title={what}
      hint={
        alwaysAsksByEffect(request.toolName)
          ? t('Dango always asks before it sends, deletes or changes your files.')
          : request.readOnlyCommand && request.allowAlways
            ? t('“Always” only skips this question for commands that just look, like this one. Commands that change anything will still ask.')
            : isCommandTool(request.toolName, request.toolDescription)
              ? t('Dango always asks before it runs commands.')
              : undefined
      }
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={() => choose('deny')}>
            {t('Not now')}
          </button>
          {request.allowAlways ? (
            <button type="button" className="dg-btn" onClick={() => choose('always')}>
              {request.scopeId ? t('Always in this scope') : t('Always in this chat')}
            </button>
          ) : null}
          <button
            ref={allowRef}
            type="button"
            className="dg-btn dg-btn--primary"
            data-autofocus
            onClick={() => choose('once')}
          >
            {t('Allow once')}
          </button>
        </>
      }
    >
      {explains && explains.length > 0 ? (
        <section aria-label={t('What this does')} style={explainsStyle}>
          <span className="dg-type-caption" style={{ color: 'var(--dango-danger)' }}>
            {t('What this does')}
          </span>
          {explains.map((line) => (
            <p key={line} className="dg-type-callout" style={{ margin: 0, color: 'var(--dango-ink)' }}>
              {line}
            </p>
          ))}
        </section>
      ) : null}
      {why ? (
        <p className="dg-type-body" style={{ margin: 0, color: 'var(--dango-ink-2)' }}>
          {why}
        </p>
      ) : null}
      {shown.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--dango-space-1)', minWidth: 0 }}>
          <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
            {t('Touches')}
          </span>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', minWidth: 0 }}>
            {shown.map((touch) => (
              <li key={touch} className="dg-type-callout" style={touchStyle} title={touch}>
                {touch}
              </li>
            ))}
          </ul>
          {hidden > 0 ? (
            <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
              {t('and {{count}} more', { count: hidden })}
            </span>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  )
}
