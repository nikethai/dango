import { Menu } from '@mantine/core'
import { isEverywhere, type Scope } from '@shared/types'
import { useTranslation } from 'react-i18next'

export type ScopePillProps = {
  scopes: Scope[]
  value: string | undefined
  onChange(scopeId: string | undefined): void
}

/** Composer pill that shows and changes the chat's scope. Everywhere holds no chats, so it is never offered. */
export function ScopePill({ scopes, value, onChange }: ScopePillProps) {
  const { t } = useTranslation()
  const options = scopes.filter((scope) => !isEverywhere(scope.id))
  const current = value ? options.find((scope) => scope.id === value) : undefined
  return (
    <Menu position="top-start" withinPortal shadow="md" transitionProps={{ transition: 'fade-up', duration: 160 }}>
      <Menu.Target>
        <button
          type="button"
          className="dg-scope composer-scope-pill"
          aria-label={current ? t('Scope: {{name}}', { name: current.name }) : t('Scope: None')}
        >
          <span className="min-w-0 truncate">{current ? current.name : t('No scope')}</span>
        </button>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item onClick={() => onChange(undefined)}>{t('None')}</Menu.Item>
        {options.map((scope) => (
          <Menu.Item
            key={scope.id}
            onClick={() => onChange(scope.id)}
            rightSection={scope.kind === 'client' ? <span className="dg-chip">{t('client')}</span> : undefined}
          >
            {scope.name}
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  )
}
