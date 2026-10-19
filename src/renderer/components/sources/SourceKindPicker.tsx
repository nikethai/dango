import type { SourceKind } from '@shared/types/sources'
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useKnowledgeBases } from '@/hooks/knowledge-base'
import {
  codexThreadsFound,
  codexThreadsHint,
  listSourceKinds,
  MCP_SOURCE_OPTION,
  type SourceChoice,
  type SourceKindDefinition,
  useCodexDetection,
} from '@/packages/sources'
import { ensureIntegrationsStoreInit, useIntegrationsStore } from '@/stores/integrationsStore'

/** Where "Add documents" goes. */
export const KNOWLEDGE_BASE_ROUTE = '/settings/knowledge-base'

export type SourceKindPickerProps = {
  onPick(kind: SourceKind, choice?: SourceChoice): void
  onMcp(): void
  /** "Add documents": opens Documents settings. Without it the button is not shown. */
  onOpenSettings?(to: string): void
  /** Activates this kind once what it needs is known: picks it, or opens its accounts or collections. */
  autoActivate?: SourceKind
}

const rowStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 'var(--dango-space-1)',
  width: '100%',
  padding: 'var(--dango-space-2) var(--dango-space-3)',
  border: 0,
  borderRadius: 'var(--dango-radius-md)',
  background: 'transparent',
  color: 'var(--dango-ink)',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}

const disabledRowStyle: CSSProperties = { ...rowStyle, cursor: 'default', color: 'var(--dango-muted)' }

const groupStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  gap: 'var(--dango-space-2)',
  padding: '0 var(--dango-space-3) var(--dango-space-2)',
}

function Row(props: {
  kind: string
  name: ReactNode
  hint: string
  disabled?: boolean
  expanded?: boolean
  onClick(): void
}) {
  return (
    <button
      type="button"
      data-kind={props.kind}
      disabled={props.disabled}
      aria-expanded={props.expanded}
      style={props.disabled ? disabledRowStyle : rowStyle}
      onClick={props.onClick}
    >
      <span className="dg-type-body" style={{ fontWeight: 500 }}>
        {props.name}
      </span>
      <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
        {props.hint}
      </span>
    </button>
  )
}

/**
 * The Add a source list: one row per kind with its hint (unavailable kinds disabled with theirs), then MCP server.
 * Gmail and Asana with active accounts open "Use {account}" / "Another account"; Documents opens its collections.
 */
export function SourceKindPicker({ onPick, onMcp, onOpenSettings, autoActivate }: SourceKindPickerProps) {
  const { t } = useTranslation()
  const kinds = listSourceKinds()
  const codex = useCodexDetection()
  const accounts = useIntegrationsStore((s) => s.catalog.accounts)
  const accountsReady = useIntegrationsStore((s) => s.ready)
  const { data: collections } = useKnowledgeBases()
  const [expanded, setExpanded] = useState<SourceKind | null>(null)

  useEffect(() => {
    void ensureIntegrationsStoreInit().catch((error) => console.warn('[sources] Could not load accounts', error))
  }, [])

  const activeAccounts = (def: SourceKindDefinition) =>
    def.connectorId ? accounts.filter((a) => a.connectorId === def.connectorId && a.status === 'active') : []

  const isDisabled = (def: SourceKindDefinition) =>
    !def.isAvailable() || (def.kind === 'codex-threads' && !codexThreadsFound(codex))

  const opens = (def: SourceKindDefinition) => def.kind === 'documents' || activeAccounts(def).length > 0

  const activate = (def: SourceKindDefinition) => {
    if (opens(def)) setExpanded((current) => (current === def.kind ? null : def.kind))
    else onPick(def.kind)
  }

  // `autoActivate` waits for what decides between picking and opening (accounts, the Codex lookup).
  const autoDone = useRef(false)
  useEffect(() => {
    if (!autoActivate || autoDone.current) return
    const def = kinds.find((k) => k.kind === autoActivate)
    if (!def) return
    if (def.connectorId && !accountsReady) return
    if (def.kind === 'codex-threads' && codex === undefined) return
    autoDone.current = true
    if (isDisabled(def)) return
    if (opens(def)) setExpanded(def.kind)
    else onPick(def.kind)
  })

  const hintFor = (def: SourceKindDefinition) => {
    if (!def.isAvailable()) return t(def.unavailableHint ?? 'Needs the desktop app.')
    if (def.kind === 'codex-threads') return codexThreadsHint(codex)
    return t(def.hint)
  }

  const expansion = (def: SourceKindDefinition) => {
    if (expanded !== def.kind) return null
    if (def.kind === 'documents') {
      // Unknown until the list loads: show nothing rather than "No documents yet".
      if (!collections) return null
      return (
        <div role="group" aria-label={t(def.name)} style={groupStyle}>
          {collections.length === 0 ? (
            <>
              <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
                {t('No documents yet')}
              </span>
              {onOpenSettings ? (
                <button type="button" className="dg-btn" onClick={() => onOpenSettings(KNOWLEDGE_BASE_ROUTE)}>
                  {t('Add documents')}
                </button>
              ) : null}
            </>
          ) : (
            collections.map((kb) => (
              // Collection names are user text.
              <button key={kb.id} type="button" className="dg-btn" onClick={() => onPick('documents', { kbId: kb.id })}>
                {kb.name}
              </button>
            ))
          )}
        </div>
      )
    }
    return (
      <div role="group" aria-label={t(def.name)} style={groupStyle}>
        {activeAccounts(def).map((account) => (
          <button
            key={account.id}
            type="button"
            className="dg-btn"
            onClick={() => onPick(def.kind, { accountId: account.id })}
          >
            {/* The account hint is external text (an address or name). */}
            {t('Use {{accountHint}}', { accountHint: account.accountHint || account.label })}
          </button>
        ))}
        <button type="button" className="dg-btn dg-btn--ghost" onClick={() => onPick(def.kind)}>
          {t('Another account')}
        </button>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      {kinds.map((def) => (
        <div key={def.kind}>
          <Row
            kind={def.kind}
            name={t(def.name)}
            hint={hintFor(def)}
            disabled={isDisabled(def)}
            expanded={opens(def) ? expanded === def.kind : undefined}
            onClick={() => activate(def)}
          />
          {expansion(def)}
        </div>
      ))}
      <Row
        kind="mcp"
        name={
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--dango-space-2)' }}>
            {t(MCP_SOURCE_OPTION.name)}
            <span className="dg-chip">{t(MCP_SOURCE_OPTION.badge)}</span>
          </span>
        }
        hint={t(MCP_SOURCE_OPTION.hint)}
        onClick={onMcp}
      />
    </div>
  )
}
