import { TextInput } from '@mantine/core'
import type { ScopeKind } from '@shared/types'
import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import SegmentedControl from '@/components/common/SegmentedControl'
import { Sheet } from '@/components/ui/Sheet'
import { validateScopeName } from '@/projects/scope-store'

export type NewScopeSheetProps = {
  opened: boolean
  onClose: () => void
  onCreate: (input: { name: string; kind: ScopeKind }) => void
}

export function NewScopeSheet({ opened, onClose, onCreate }: NewScopeSheetProps) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const kindLabelId = useId()
  const [kind, setKind] = useState<ScopeKind>('project')

  useEffect(() => {
    if (!opened) {
      setName('')
      setKind('project')
    }
  }, [opened])

  const problem = validateScopeName(name)
  const error = problem === 'reserved' ? t('Everywhere is built in. Pick another name.') : undefined

  const submit = () => {
    if (problem) return
    onCreate({ name: name.trim(), kind })
  }

  return (
    <Sheet
      opened={opened}
      onClose={onClose}
      title={t('New scope')}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={onClose}>
            {t('Cancel')}
          </button>
          <button type="button" className="dg-btn dg-btn--primary" disabled={Boolean(problem)} onClick={submit}>
            {t('Create')}
          </button>
        </>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <TextInput
          data-autofocus
          label={t('Name')}
          value={name}
          placeholder={t('Acme Co, Dango app…')}
          error={error}
          styles={{
            input: { background: 'var(--dango-raised)', borderColor: 'var(--dango-control-border)' },
          }}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              submit()
            }
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
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
          <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
            {t("Client scopes don't read your Everywhere documents unless you turn that on.")}
          </span>
        </div>
      </div>
    </Sheet>
  )
}
