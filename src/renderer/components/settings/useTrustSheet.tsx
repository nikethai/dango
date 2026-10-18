import { readTrustLevel, type TrustLevel } from '@shared/types/settings'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { pushUndo } from '@/packages/undo'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { TRUST_LABELS, TrustSheet } from './TrustSheet'

export function useTrustSheet(): { open(): void; sheet: JSX.Element } {
  const { t } = useTranslation()
  const [opened, setOpened] = useState(false)
  const value = readTrustLevel(useSettingsStore((s) => s.trustLevel))
  const open = useCallback(() => setOpened(true), [])
  const onClose = useCallback(() => setOpened(false), [])
  const onSave = useCallback(
    (next: TrustLevel) => {
      const previous = readTrustLevel(settingsStore.getState().trustLevel)
      setOpened(false)
      if (next === previous) return
      settingsStore.getState().setSettings({ trustLevel: next })
      pushUndo({
        message: t('Trust set to {{level}}. Items already in Review keep their state.', {
          level: t(TRUST_LABELS[next]),
        }),
        undo: () => settingsStore.getState().setSettings({ trustLevel: previous }),
        group: 'other',
      })
    },
    [t]
  )
  return { open, sheet: <TrustSheet opened={opened} value={value} onClose={onClose} onSave={onSave} /> }
}
