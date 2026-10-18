import { Select, TextInput } from '@mantine/core'
import { readsEverywhereFor, type Scope, type ScopeKind } from '@shared/types'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SegmentedControl from '@/components/common/SegmentedControl'
import { validateScopeName } from '@/projects/scope-store'
import { DeleteScopeSheet } from './DeleteScopeSheet'

export const NO_AGENT_VALUE = 'none'

export type ScopeSettingsTabProps = {
  scope: Scope
  agentOptions: Array<{ value: string; label: string }>
  onChange(patch: Partial<Omit<Scope, 'id'>>): void
  onDelete(): void
}

function SwitchRow(props: {
  id: string
  label: string
  caption: string
  checked: boolean
  disabled?: boolean
  onToggle?(): void
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span id={props.id}>{props.label}</span>
        <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
          {props.caption}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        className="dg-switch"
        aria-checked={props.checked}
        aria-labelledby={props.id}
        disabled={props.disabled}
        onClick={props.onToggle}
      />
    </div>
  )
}

export function ScopeSettingsTab({ scope, agentOptions, onChange, onDelete }: ScopeSettingsTabProps) {
  const { t } = useTranslation()
  const [name, setName] = useState(scope.name)
  const kindLabelId = useId()
  const switchId = useId()
  const [confirming, setConfirming] = useState(false)
  const reads = readsEverywhereFor(scope)

  useEffect(() => {
    setName(scope.name)
  }, [scope.id, scope.name])

  const problem = validateScopeName(name)
  const error = problem === 'reserved' ? t('Everywhere is built in. Pick another name.') : undefined

  const commitName = () => {
    const next = name.trim()
    if (!next) {
      setName(scope.name)
      return
    }
    if (problem) return
    if (next !== scope.name) onChange({ name: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <TextInput
        label={t('Name')}
        value={name}
        error={error}
        styles={{ input: { background: 'var(--dango-raised)', borderColor: 'var(--dango-control-border)' } }}
        onChange={(event) => setName(event.currentTarget.value)}
        onBlur={commitName}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commitName()
          }
        }}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <span id={kindLabelId} className="dg-type-body" style={{ fontWeight: 500 }}>
          {t('Is this a project or a client?')}
        </span>
        <SegmentedControl
          aria-labelledby={kindLabelId}
          value={scope.kind}
          onChange={(value) => {
            if (value !== scope.kind) onChange({ kind: value as ScopeKind })
          }}
          data={[
            { label: t('Project'), value: 'project' },
            { label: t('Client'), value: 'client' },
          ]}
        />
      </div>
      <Select
        label={t('Default agent')}
        data={agentOptions}
        value={scope.defaultAgentId ?? NO_AGENT_VALUE}
        allowDeselect={false}
        onChange={(value) => onChange({ defaultAgentId: !value || value === NO_AGENT_VALUE ? undefined : value })}
      />
      <section style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h3 className="dg-type-headline">{t('What this scope reads from Everywhere')}</h3>
        <SwitchRow
          id={`${switchId}-prefs`}
          label={t('Preferences')}
          caption={t('How you like answers. Always on.')}
          checked
          disabled
        />
        <SwitchRow
          id={`${switchId}-facts`}
          label={t('Facts')}
          caption={t('Things that are true in every scope.')}
          checked={reads.facts}
          onToggle={() => onChange({ readsEverywhere: { facts: !reads.facts, documents: reads.documents } })}
        />
        <SwitchRow
          id={`${switchId}-docs`}
          label={t('Documents')}
          caption={t('Files connected to Everywhere.')}
          checked={reads.documents}
          onToggle={() => onChange({ readsEverywhere: { facts: reads.facts, documents: !reads.documents } })}
        />
        <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
          {t('When this scope and Everywhere disagree, this scope wins here.')}
        </span>
      </section>
      <div>
        <button type="button" className="dg-btn dg-btn--danger" onClick={() => setConfirming(true)}>
          {t('Delete scope')}
        </button>
      </div>
      <DeleteScopeSheet scope={scope} opened={confirming} onClose={() => setConfirming(false)} onConfirm={onDelete} />
    </div>
  )
}
