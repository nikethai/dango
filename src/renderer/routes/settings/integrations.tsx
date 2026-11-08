import { Button, Stack, Text } from '@mantine/core'
import type { IntegrationAccount } from '@shared/types/integrations'
import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AccountFormModal, AccountList, McpBindingsPanel } from '@/components/settings/integrations'
import { SettingsCallout } from '@/components/settings/SettingsCallout'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { integrationsSecretBackendLabel } from '@/packages/integrations'
import { ensureIntegrationsStoreInit, useIntegrationsStore } from '@/stores/integrationsStore'

export const Route = createFileRoute('/settings/integrations')({
  component: IntegrationsSettingsPage,
})

export function IntegrationsSettingsPage() {
  const { t } = useTranslation()
  const ready = useIntegrationsStore((s) => s.ready)
  const accounts = useIntegrationsStore((s) => s.catalog.accounts)
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<IntegrationAccount | null>(null)

  useEffect(() => {
    void ensureIntegrationsStoreInit()
  }, [])

  const backend = integrationsSecretBackendLabel()

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t('Accounts')}
        description={t('Connected accounts for AI tools — multi-account, defaults, secure secrets.')}
        actions={
          accounts.length > 0 ? (
            <Button
              size="sm"
              onClick={() => {
                setEditing(null)
                setFormOpen(true)
              }}
            >
              {t('Connect account')}
            </Button>
          ) : null
        }
      />

      <Stack gap="md">
        <SettingsCallout>
          <Text size="sm">
            {backend === 'os_keychain'
              ? t(
                  'On desktop, account secrets prefer the OS keychain (macOS Keychain, Windows Credential Manager, or Linux secret service), with isolated app storage as fallback.'
                )
              : t(
                  'Secrets are stored in isolated app storage (not in chat settings). Desktop builds prefer the OS keychain when available.'
                )}{' '}
            {t('Tokens are never injected into the model prompt — only account labels and ids.')}
          </Text>
        </SettingsCallout>

        {!ready ? (
          <Text c="dimmed" size="sm">
            {t('Loading…')}
          </Text>
        ) : (
          <AccountList
            accounts={accounts}
            onAdd={() => {
              setEditing(null)
              setFormOpen(true)
            }}
            onEdit={(account) => {
              setEditing(account)
              setFormOpen(true)
            }}
          />
        )}

        <SettingsSection title={t('MCP server bindings')}>
          <McpBindingsPanel />
        </SettingsSection>

        <Text size="xs" c="dimmed">
          {t(
            'In chat, type # to tag an account (sticky for the session). Tools use defaults when you have one account or a Default set.'
          )}
        </Text>
      </Stack>

      <AccountFormModal
        opened={formOpen}
        account={editing}
        onClose={() => {
          setFormOpen(false)
          setEditing(null)
        }}
      />
    </SettingsPage>
  )
}
