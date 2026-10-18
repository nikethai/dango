import { EVERYWHERE_SCOPE_ID } from '@shared/types/scope'
import { readTrustLevel } from '@shared/types/settings'
import { useNavigate } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { navigateToSettings } from '@/modals/Settings'
import { useSettingsStore } from '@/stores/settingsStore'
import { SettingsCard } from '../SettingsCard'
import { SettingsPage } from '../SettingsPage'
import { SettingsPageHeader } from '../SettingsPageHeader'
import { SettingsPrefRow } from '../SettingsPrefRow'
import { SettingsSection } from '../SettingsSection'
import { TRUST_LABELS } from '../TrustSheet'
import { useTrustSheet } from '../useTrustSheet'
import { DontSuggestList } from './DontSuggestList'
import { useDontSuggestEntries } from './useDontSuggestEntries'

export function MemoryPrivacyPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const trustLevel = readTrustLevel(useSettingsStore((s) => s.trustLevel))
  const { open, sheet } = useTrustSheet()
  const { items, restore } = useDontSuggestEntries()
  const trustLine =
    trustLevel === 'auto'
      ? t('Dango does safe things first and shows you what it did.')
      : t('Everything waits for your approval.')
  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t('Memory and privacy')}
        description={t('What Dango keeps, what it may do before asking, and what it should stop suggesting.')}
      />
      <SettingsSection title={t('Trust')}>
        <SettingsCard>
          <SettingsPrefRow
            title={t('Trust level')}
            description={`${t(TRUST_LABELS[trustLevel])} · ${trustLine}`}
            control={
              <button type="button" className="dg-btn dg-btn--ghost" onClick={open}>
                {t('Change')}
              </button>
            }
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t("Don't suggest again")}>
        <SettingsCard>
          <DontSuggestList items={items} onRestore={(id) => void restore(id)} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t('Everywhere')}>
        <SettingsCard>
          <SettingsPrefRow
            title={t('Everywhere')}
            description={t('Preferences and facts every scope reads.')}
            control={
              <button
                type="button"
                className="dg-btn dg-btn--ghost"
                onClick={() =>
                  void navigate({
                    to: '/scope/$scopeId',
                    params: { scopeId: EVERYWHERE_SCOPE_ID },
                    search: { tab: 'overview' },
                  })
                }
              >
                {t('Open Everywhere')}
              </button>
            }
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title={t('Export')}>
        <SettingsCard>
          <SettingsPrefRow
            title={t('Export your data')}
            description={t('Back up chats, settings and knowledge to a file.')}
            control={
              <button type="button" className="dg-btn dg-btn--ghost" onClick={() => navigateToSettings('/general')}>
                {t('Open backup')}
              </button>
            }
          />
        </SettingsCard>
      </SettingsSection>
      {sheet}
    </SettingsPage>
  )
}
