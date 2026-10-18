import { SegmentedControl } from '@mantine/core'
import type { ShowThinking } from '@shared/types/settings'
import { useTranslation } from 'react-i18next'
import { SettingsPrefRow } from './SettingsPrefRow'

export function ShowThinkingRow({ value, onChange }: { value: ShowThinking; onChange(next: ShowThinking): void }) {
  const { t } = useTranslation()
  return (
    <SettingsPrefRow
      title={t('Show thinking')}
      description={t(
        'Auto opens it in project scopes and chats without a scope, and keeps it closed in client scopes.'
      )}
      control={
        <SegmentedControl
          value={value}
          onChange={(v) => onChange(v as ShowThinking)}
          data={[
            { label: t('Auto'), value: 'auto' },
            { label: t('Open'), value: 'open' },
            { label: t('Closed'), value: 'closed' },
          ]}
        />
      }
    />
  )
}
