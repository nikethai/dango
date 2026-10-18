import { Alert, Button, Checkbox, FileButton, Flex, Radio, Stack, Switch, Text, TextInput } from '@mantine/core'
import { type Language, type ProviderInfo, type Settings, Theme } from '@shared/types'
import { formatFileSize } from '@shared/utils'
import { IconInfoCircle } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { mapValues, uniqBy } from 'lodash'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import LazySlider from '@/components/common/LazySlider'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsCollapsible } from '@/components/settings/SettingsCollapsible'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsPrefRow } from '@/components/settings/SettingsPrefRow'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { languageNameMap, languages } from '@/i18n/locales'
import { DEFAULT_NOTIFICATIONS_CONFIG } from '@/packages/notifications/types'
import platform, { platformCapabilities } from '@/platform'
import storage, { StorageKey } from '@/storage'
import { recoverSessionList } from '@/stores/chatStore'
import { exportHistoryTransferFile, importHistoryTransferFile } from '@/stores/historyTransfer'
import { importRoomPack } from '@/stores/roomPack'
import { migrateOnData } from '@/stores/migration'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/general')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t('General Settings')}
        description={t('Language, theme, data, and system preferences for Dango.')}
      />

      <SettingsSection title={t('Display')}>
        <SettingsCard divided>
          <SettingsPrefRow
            title={t('Language')}
            control={
              <AdaptiveSelect
                maw={200}
                comboboxProps={{ withinPortal: true }}
                value={settings.language}
                data={languages.map((language) => ({
                  value: language,
                  label: languageNameMap[language],
                }))}
                onChange={(val) => {
                  if (val) {
                    setSettings({ language: val as Language })
                  }
                }}
              />
            }
          />
          <SettingsPrefRow
            title={t('Theme')}
            control={
              <AdaptiveSelect
                maw={200}
                comboboxProps={{ withinPortal: true, withArrow: true }}
                data={[
                  { value: `${Theme.System}`, label: t('Follow System') },
                  { value: `${Theme.Light}`, label: t('Light Mode') },
                  { value: `${Theme.Dark}`, label: t('Dark Mode') },
                ]}
                value={`${settings.theme}`}
                onChange={(val) => {
                  if (val) {
                    setSettings({ theme: parseInt(val) })
                  }
                }}
              />
            }
          />
          <SettingsPrefRow
            title={t('Font Size')}
            description={`${settings.fontSize}px`}
            align="start"
            control={
              <LazySlider
                step={1}
                min={10}
                max={22}
                w={160}
                marks={[{ value: 14 }]}
                value={settings.fontSize}
                onChange={(val) => setSettings({ fontSize: val })}
              />
            }
          />
          <SettingsPrefRow
            title={t('Startup Page')}
            align="start"
            control={
              <Radio.Group
                value={settings.startupPage}
                defaultValue="home"
                onChange={(val) => setSettings({ startupPage: val as 'home' | 'session' })}
              >
                <Flex gap="sm" direction="column">
                  <Radio label={t('Home Page')} value="home" />
                  <Radio label={t('Last Session')} value="session" />
                </Flex>
              </Radio.Group>
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsCollapsible
        title={t('Network Proxy')}
        description={t('Route outbound API traffic through a SOCKS or HTTP proxy.')}
        badge={settings.proxy?.trim() ? t('On') : t('Advanced')}
        badgeTone={settings.proxy?.trim() ? 'active' : 'quiet'}
        defaultOpen={Boolean(settings.proxy?.trim())}
      >
        <SettingsCard>
          <div className="settings-field">
            <span className="settings-field-label">{t('Proxy URL')}</span>
            <TextInput
              placeholder="socks5://127.0.0.1:6153"
              value={settings.proxy}
              onChange={(e) => setSettings({ proxy: e.currentTarget.value })}
              classNames={{ input: 'settings-mono-input' }}
              rightSection={
                settings.proxy?.trim() ? (
                  <button
                    type="button"
                    className="settings-input-clear"
                    aria-label={t('Clear')}
                    onClick={() => setSettings({ proxy: '' })}
                  >
                    ×
                  </button>
                ) : null
              }
              rightSectionPointerEvents="all"
            />
            <span className="settings-field-hint">
              {t('Supports socks5://, http://, and https://. Leave empty to use the system network.')}
            </span>
          </div>
        </SettingsCard>
      </SettingsCollapsible>

      <SettingsCollapsible
        title={t('Data & backup')}
        description={t('Recovery, export/import, and diagnostic logs. Encrypted self-host sync is in Settings → Sync.')}
        badge={t('Advanced')}
      >
        <div className="settings-collapsible-stack">
          <DataRecoverySection />
          <ImportExportDataSection />
          <ExportLogsSection />
        </div>
      </SettingsCollapsible>

      <SettingsSection
        title={t('System Notifications')}
        description={t(
          'Local OS alerts when a reply finishes while the app is in the background. Never includes message content. Not remote push.'
        )}
      >
        <SystemNotificationsSection />
      </SettingsSection>

      <SettingsSection
        title={t('Error Reporting')}
        description={t(
          'Dango respects your privacy and only uploads anonymous error data and events when necessary. You can change your preferences at any time in the settings.'
        )}
      >
        <SettingsCard divided>
          <SettingsPrefRow
            title={t('Anonymous crash & event reporting')}
            description={t('Enable optional anonymous reporting of crash and event data')}
            control={
              <Switch
                checked={settings.allowReportingAndTracking}
                onChange={(e) => setSettings({ allowReportingAndTracking: e.target.checked })}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>

      {platformCapabilities.supportsDesktopOnlySettings && platform.type === 'desktop' && (
        <SettingsSection title={t('Desktop')}>
          <SettingsCard divided>
            <SettingsPrefRow
              title={t('Keep running in menu bar / system tray')}
              description={t(
                'When enabled, closing the window hides Dango instead of quitting. Use the menu bar icon or hotkey to reopen.'
              )}
              control={
                <Switch
                  checked={settings.keepInTray !== false}
                  onChange={(e) => setSettings({ keepInTray: e.currentTarget.checked })}
                />
              }
            />
            <SettingsPrefRow
              title={t('Quick chat always on top')}
              description={t('Keep the floating quick chat window above other apps.')}
              control={
                <Switch
                  checked={settings.quickWindowAlwaysOnTop !== false}
                  onChange={(e) => setSettings({ quickWindowAlwaysOnTop: e.currentTarget.checked })}
                />
              }
            />
            <SettingsPrefRow
              title={t('Launch at system startup')}
              control={
                <Switch
                  checked={settings.autoLaunch}
                  onChange={(e) => setSettings({ autoLaunch: e.currentTarget.checked })}
                />
              }
            />
            <SettingsPrefRow
              title={t('Automatic updates')}
              control={
                <Switch
                  checked={settings.autoUpdate}
                  onChange={(e) => setSettings({ autoUpdate: e.currentTarget.checked })}
                />
              }
            />
            <SettingsPrefRow
              title={t('Beta updates')}
              control={
                <Switch
                  checked={settings.betaUpdate}
                  onChange={(e) => setSettings({ betaUpdate: e.currentTarget.checked })}
                />
              }
            />
          </SettingsCard>
        </SettingsSection>
      )}
    </SettingsPage>
  )
}

function SystemNotificationsSection() {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((state) => state.setSettings)
  const notifications = useSettingsStore((state) => state.extension.notifications)
  const enabled = notifications?.enabled === true
  const notifyOnNeedsYou = notifications?.notifyOnNeedsYou !== false
  const notifyOnGenerationComplete = notifications?.notifyOnGenerationComplete !== false
  const [permission, setPermission] = useState<string>('default')
  const [permissionBusy, setPermissionBusy] = useState(false)

  useEffect(() => {
    void platform
      .getSystemNotificationPermission()
      .then(setPermission)
      .catch(() => setPermission('unsupported'))
  }, [])

  const patchNotifications = (patch: {
    enabled?: boolean
    notifyOnNeedsYou?: boolean
    notifyOnGenerationComplete?: boolean
  }) => {
    setSettings((state) => {
      const current = state.extension.notifications ?? DEFAULT_NOTIFICATIONS_CONFIG
      state.extension.notifications = { ...current, ...patch }
    })
  }

  const onToggleEnabled = async (next: boolean) => {
    if (next) {
      setPermissionBusy(true)
      try {
        const result = await platform.requestSystemNotificationPermission()
        setPermission(result)
        if (result === 'granted') {
          patchNotifications({ enabled: true })
        } else if (result === 'unsupported') {
          patchNotifications({ enabled: false })
        } else {
          // Keep enabled false until granted
          patchNotifications({ enabled: false })
        }
      } finally {
        setPermissionBusy(false)
      }
      return
    }
    patchNotifications({ enabled: false })
  }

  const permissionLabel =
    permission === 'granted'
      ? t('Permission granted')
      : permission === 'denied'
        ? t('Permission denied')
        : permission === 'unsupported'
          ? t('Not supported on this platform')
          : t('Permission not requested')

  return (
    <SettingsCard divided>
      <SettingsPrefRow
        title={t('Enable system notifications')}
        description={t(
          'Only for things that need you and long runs that finish while Dango is in the background. At most one every 10 minutes.'
        )}
        control={
          <Switch
            checked={enabled}
            disabled={permissionBusy || permission === 'unsupported'}
            onChange={(e) => void onToggleEnabled(e.currentTarget.checked)}
          />
        }
      />
      <SettingsPrefRow
        title={t('Permission')}
        description={permissionLabel}
        control={
          <Button
            size="xs"
            variant="light"
            disabled={permission === 'unsupported' || permission === 'granted' || permissionBusy}
            loading={permissionBusy}
            onClick={() => void onToggleEnabled(true)}
          >
            {t('Request permission')}
          </Button>
        }
      />
      <SettingsPrefRow
        title={t('When something needs you')}
        control={
          <Switch
            checked={notifyOnNeedsYou}
            disabled={!enabled}
            onChange={(e) => patchNotifications({ notifyOnNeedsYou: e.currentTarget.checked })}
          />
        }
      />
      <SettingsPrefRow
        title={t('When a long run finishes in the background')}
        control={
          <Switch
            checked={notifyOnGenerationComplete}
            disabled={!enabled}
            onChange={(e) => patchNotifications({ notifyOnGenerationComplete: e.currentTarget.checked })}
          />
        }
      />
    </SettingsCard>
  )
}

const DataRecoverySection = () => {
  const { t } = useTranslation()
  const [isRecovering, setIsRecovering] = useState(false)
  const [recoveryResult, setRecoveryResult] = useState<{
    success: boolean
    recovered?: number
    failed?: number
    error?: string
  } | null>(null)

  const handleRecover = async () => {
    setIsRecovering(true)
    setRecoveryResult(null)
    try {
      const result = await recoverSessionList()
      setRecoveryResult({ success: true, recovered: result.recovered, failed: result.failed })
    } catch (error) {
      console.error('Failed to recover session list:', error)
      setRecoveryResult({ success: false, error: String(error) })
    } finally {
      setIsRecovering(false)
    }
  }

  const hasPartialFailure = recoveryResult?.success && recoveryResult.failed && recoveryResult.failed > 0

  return (
    <SettingsSection
      title={t('Data Recovery')}
      description={t(
        'If conversations are missing from the list, use this feature to scan and recover them from storage'
      )}
    >
      <SettingsCard>
        <div className="settings-card-fields">
          <div className="settings-actions">
            <Button onClick={handleRecover} disabled={isRecovering} loading={isRecovering}>
              {isRecovering ? t('Recovering...') : t('Recover Conversation List')}
            </Button>
          </div>
          {recoveryResult && (
            <Alert
              className="self-start"
              variant="light"
              color={recoveryResult.success ? (hasPartialFailure ? 'yellow' : 'green') : 'red'}
              title={
                recoveryResult.success
                  ? t('Recovered {{count}} conversations', { count: recoveryResult.recovered })
                  : t('Recovery failed')
              }
              icon={<IconInfoCircle />}
            >
              {recoveryResult.success ? (
                <Stack gap="xs">
                  <Text size="sm">{t('The conversation list has been successfully recovered')}</Text>
                  {hasPartialFailure && (
                    <Text size="sm" c="orange">
                      {t('{{count}} conversations could not be recovered due to data read errors', {
                        count: recoveryResult.failed,
                      })}
                    </Text>
                  )}
                </Stack>
              ) : (
                <Text size="sm">{recoveryResult.error || t('Unknown error')}</Text>
              )}
            </Alert>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}

const ImportExportDataSection = () => {
  const { t } = useTranslation()

  const [importTips, setImportTips] = useState('')
  const [historyTransferTips, setHistoryTransferTips] = useState('')
  const [historyTransferError, setHistoryTransferError] = useState(false)
  const [isHistoryTransferPending, setIsHistoryTransferPending] = useState(false)
  const [roomPackTips, setRoomPackTips] = useState('')
  const [roomPackError, setRoomPackError] = useState(false)
  const [isRoomPackPending, setIsRoomPackPending] = useState(false)
  const [exportItems, setExportItems] = useState<ExportDataItem[]>([
    ExportDataItem.Setting,
    ExportDataItem.Conversations,
    ExportDataItem.Copilot,
  ])

  const onExportHistoryTransfer = async () => {
    setHistoryTransferTips('')
    setHistoryTransferError(false)
    setIsHistoryTransferPending(true)
    try {
      const { fileName, content, sessionCount } = await exportHistoryTransferFile()
      await platform.exporter.exportTextFile(fileName, content)
      setHistoryTransferTips(t('Exported {{count}} conversations for transfer', { count: sessionCount }))
    } catch (error) {
      console.error('Failed to export history transfer file:', error)
      setHistoryTransferError(true)
      setHistoryTransferTips(t('Failed to export chat history'))
    } finally {
      setIsHistoryTransferPending(false)
    }
  }

  const onImportHistoryTransfer = (file: File | null) => {
    if (!file) {
      return
    }

    void (async () => {
      setHistoryTransferTips('')
      setHistoryTransferError(false)
      setIsHistoryTransferPending(true)
      try {
        const text = await file.text()
        const result = await importHistoryTransferFile(text)
        await recoverSessionList()
        setHistoryTransferTips(
          t('Imported {{imported}} new, updated {{updated}}, skipped {{skipped}} conversations', {
            imported: result.imported,
            updated: result.updated,
            skipped: result.skipped,
          })
        )
      } catch (error) {
        console.error('Failed to import history transfer file:', error)
        setHistoryTransferError(true)
        setHistoryTransferTips(error instanceof Error ? error.message : t('Failed to import chat history'))
      } finally {
        setIsHistoryTransferPending(false)
      }
    })()
  }

  const onExport = async () => {
    const data = await storage.getAll()
    delete data[StorageKey.Configs] // uuid
    ;(data[StorageKey.Settings] as Settings).licenseDetail = undefined // (legacy)
    ;(data[StorageKey.Settings] as Settings).licenseInstances = undefined // (legacy)
    if ((data[StorageKey.Settings] as Settings).extension?.historySync) {
      ;(data[StorageKey.Settings] as Settings).extension.historySync = {
        ...(data[StorageKey.Settings] as Settings).extension.historySync,
        passphrase: undefined,
      }
    }
    if (!exportItems.includes(ExportDataItem.Key)) {
      delete (data[StorageKey.Settings] as Settings).licenseKey
      data[StorageKey.Settings].providers = mapValues(
        (data[StorageKey.Settings] as Settings).providers,
        (provider: ProviderInfo) => {
          delete provider.apiKey
          delete provider.cloudflareClientSecret
          return provider
        }
      )
      // Scrub OpenClaw gateway secrets (token + CF Access credentials)
      const settings = data[StorageKey.Settings] as Settings
      if (settings.openclaw?.gateways) {
        settings.openclaw.gateways = settings.openclaw.gateways.map((gw) => {
          const { token, cloudflareClientSecret, ...rest } = gw
          return rest
        })
      }
    }
    if (!exportItems.includes(ExportDataItem.Setting)) {
      delete data[StorageKey.Settings]
    }
    if (!exportItems.includes(ExportDataItem.Conversations)) {
      delete data[StorageKey.ChatSessions]
      delete data[StorageKey.ChatSessionsList]
      for (const key of Object.keys(data)) {
        if (key.startsWith('session:')) {
          delete data[key]
        }
      }
    }
    if (!exportItems.includes(ExportDataItem.Copilot)) {
      delete data[StorageKey.MyCopilots]
    }
    const date = new Date()
    data.__exported_items = exportItems
    data.__exported_at = date.toISOString()
    const dateStr = dayjs(date).format('YYYY-M-D')
    platform.exporter.exportTextFile(`chatbox-exported-data-${dateStr}.json`, JSON.stringify(data))
  }

  const onImport = (file: File | null) => {
    const errTip = t('Import failed, unsupported data format')
    if (!file) {
      return
    }
    const reader = new FileReader()
    reader.onload = (event) => {
      void (async () => {
        setImportTips('')
        try {
          const result = event.target?.result
          if (typeof result !== 'string') {
            throw new Error('FileReader result is not string')
          }
          const importData = JSON.parse(result)
          // (legacy comment removed)
          await migrateOnData(
            {
              getData: (key, defaultValue) => Promise.resolve(importData[key] ?? defaultValue),
              setData: (key, value) => {
                importData[key] = value
                return Promise.resolve()
              },
              setAll: (data) => {
                Object.assign(importData, data)
                return Promise.resolve()
              },
            },
            false
          )

          const entriesToImport = Object.entries(importData).filter(
            ([key]) => key !== StorageKey.ChatSessionsList && key !== StorageKey.ConfigVersion && !key.startsWith('__')
          )

          const importedChatSessions = Array.isArray(importData[StorageKey.ChatSessionsList])
            ? importData[StorageKey.ChatSessionsList]
            : undefined

          for (const [key, value] of entriesToImport) {
            await storage.setItemNow(key, value)
          }

          if (importedChatSessions) {
            const previousChatSessions = await storage.getItem(StorageKey.ChatSessionsList, [])

            await storage.setItemNow(
              StorageKey.ChatSessionsList,
              uniqBy([...previousChatSessions, ...importedChatSessions], 'id')
            )
          }

          // (legacy comment)
          // (legacy comment)
          platform.relaunch() // (legacy)
        } catch (err) {
          setImportTips(errTip)

          throw err
        }
      })()
    }
    reader.onerror = (event) => {
      setImportTips(errTip)
      const err = event.target?.error
      if (!err) {
        throw new Error('FileReader error but no error message')
      }
      throw err
    }
    reader.readAsText(file)
  }

  const onImportRoomPack = (file: File | null) => {
    if (!file) return
    setIsRoomPackPending(true)
    setRoomPackTips('')
    setRoomPackError(false)
    const reader = new FileReader()
    reader.onload = () => {
      void (async () => {
        try {
          const skills = (await storage.getItem(StorageKey.Skills, [])) || []
          const installed = (Array.isArray(skills) ? skills : []).map((s: { id: string; name: string }) => ({
            id: s.id,
            name: s.name,
          }))
          const result = await importRoomPack(String(reader.result || ''), installed)
          const missing = result.missingSkills.length
            ? t(' Missing skills: {{names}}', { names: result.missingSkills.map((s) => s.name).join(', ') })
            : ''
          setRoomPackTips(
            t('Imported "{{name}}" with {{count}} agents.{{missing}}', {
              name: result.preview.name,
              count: result.preview.memberCount,
              missing,
            })
          )
        } catch (error) {
          setRoomPackError(true)
          setRoomPackTips(error instanceof Error ? error.message : t('Room pack import failed'))
        } finally {
          setIsRoomPackPending(false)
        }
      })()
    }
    reader.onerror = () => {
      setRoomPackError(true)
      setRoomPackTips(t('Room pack import failed'))
      setIsRoomPackPending(false)
    }
    reader.readAsText(file)
  }

  const [showStorageInfo, setShowStorageInfo] = useState(false)
  const [storagePersisted, setStoragePersisted] = useState<boolean>()
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimate>()
  const storageInfo = useMemo(
    () =>
      `Storage persisted: ${storagePersisted}; Storage Estimate: { quota: ${formatFileSize(storageEstimate?.quota || 0)}, usage: ${formatFileSize(storageEstimate?.usage || 0)} }`,
    [storagePersisted, storageEstimate]
  )
  useEffect(() => {
    if (window?.navigator?.storage) {
      window.navigator.storage.estimate?.().then((res) => setStorageEstimate(res))
      window.navigator.storage.persisted?.().then((p) => setStoragePersisted(p))
    }
  }, [])
  return (
    <>
      <SettingsSection
        title={t('Cross-device Chat History')}
        description={t(
          'Export conversations from this machine and import them on another machine. Existing conversations will be merged by session id.'
        )}
      >
        <SettingsCard>
          <div className="settings-card-fields">
            {historyTransferTips && (
              <Alert
                className="self-start"
                variant="light"
                color={historyTransferError ? 'yellow' : 'green'}
                title={historyTransferError ? t('History transfer failed') : t('History transfer completed')}
                icon={<IconInfoCircle />}
              >
                <Text size="sm">{historyTransferTips}</Text>
              </Alert>
            )}
            <div className="settings-actions">
              <Button onClick={onExportHistoryTransfer} loading={isHistoryTransferPending}>
                {t('Export Chat History for Transfer')}
              </Button>
              <FileButton accept="application/json" onChange={onImportHistoryTransfer}>
                {(props) => (
                  <Button {...props} loading={isHistoryTransferPending}>
                    {t('Import and Merge Chat History')}
                  </Button>
                )}
              </FileButton>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('Room packs')}
        description={t('Share a room as a file. Import creates a new room with new ids. Keys never go in the file.')}
      >
        <SettingsCard>
          <div className="settings-card-fields">
            {roomPackTips && (
              <Alert
                className="self-start"
                variant="light"
                color={roomPackError ? 'yellow' : 'green'}
                title={roomPackError ? t('Room pack import failed') : t('Room pack imported')}
                icon={<IconInfoCircle />}
              >
                <Text size="sm">{roomPackTips}</Text>
              </Alert>
            )}
            <div className="settings-actions">
              <FileButton
                accept=".json,.dango-room.json,.chaeboxi-room.json,application/json"
                onChange={onImportRoomPack}
              >
                {(props) => (
                  <Button {...props} loading={isRoomPackPending}>
                    {t('Import room pack')}
                  </Button>
                )}
              </FileButton>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('Data Backup')}>
        <SettingsCard>
          <div className="settings-card-fields">
            <span className="settings-field-label select-none" onDoubleClick={() => setShowStorageInfo(true)}>
              {t('Include in export')}
            </span>
            {showStorageInfo && (
              <Text size="xs" c="chatbox-tertiary">
                {storageInfo}
              </Text>
            )}
            {[
              { label: t('Settings'), value: ExportDataItem.Setting },
              { label: t('API Keys'), value: ExportDataItem.Key },
              { label: t('Chat History'), value: ExportDataItem.Conversations },
              { label: t('My Agents'), value: ExportDataItem.Copilot },
            ].map(({ label, value }) => (
              <Checkbox
                key={value}
                checked={exportItems.includes(value)}
                label={label}
                onChange={(e) => {
                  const checked = e.currentTarget.checked
                  if (checked && !exportItems.includes(value)) {
                    setExportItems([...exportItems, value])
                  } else if (!checked) {
                    setExportItems(exportItems.filter((v) => v !== value))
                  }
                }}
              />
            ))}
            <div className="settings-actions">
              <Button onClick={onExport}>{t('Export Selected Data')}</Button>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('Data Restore')}
        description={t('Upon import, changes will take effect immediately and existing data will be overwritten')}
      >
        <SettingsCard>
          <div className="settings-card-fields">
            {importTips && (
              <Alert
                className="self-start"
                variant="light"
                color="yellow"
                title={importTips}
                icon={<IconInfoCircle />}
              />
            )}
            <div className="settings-actions">
              <FileButton accept="application/json" onChange={onImport}>
                {(props) => <Button {...props}>{t('Import and Restore')}</Button>}
              </FileButton>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>
    </>
  )
}

enum ExportDataItem {
  Setting = 'setting',
  Key = 'key',
  Conversations = 'conversations',
  Copilot = 'copilot',
}

const ExportLogsSection = () => {
  const { t } = useTranslation()
  const [isExporting, setIsExporting] = useState(false)
  const [exportResult, setExportResult] = useState<{
    success: boolean
    error?: string
  } | null>(null)

  const handleExportLogs = async () => {
    setIsExporting(true)
    setExportResult(null)
    try {
      const logs = await platform.exportLogs()
      if (!logs || logs.trim() === '') {
        setExportResult({ success: true })
        return
      }

      const date = new Date()
      const dateStr = dayjs(date).format('YYYY-M-D_H-m')
      await platform.exporter.exportTextFile(`chatbox-logs-${dateStr}.txt`, logs)
      setExportResult({ success: true })
    } catch (error) {
      console.error('Failed to export logs:', error)
      setExportResult({ success: false, error: String(error) })
    } finally {
      setIsExporting(false)
    }
  }

  const _handleClearLogs = async () => {
    try {
      await platform.clearLogs()
      setExportResult({ success: true })
    } catch (error) {
      console.error('Failed to clear logs:', error)
    }
  }

  return (
    <SettingsSection
      title={t('Diagnostic Logs')}
      description={t(
        'Export application logs for troubleshooting. These logs may be requested by support to help diagnose issues.'
      )}
    >
      <SettingsCard>
        <div className="settings-card-fields">
          <div className="settings-actions">
            <Button variant="primary" onClick={handleExportLogs} disabled={isExporting} loading={isExporting}>
              {isExporting ? t('Exporting...') : t('Export Logs')}
            </Button>
          </div>
          {exportResult && !exportResult.success && (
            <Alert
              className="self-start"
              variant="light"
              color="red"
              title={t('Export failed')}
              icon={<IconInfoCircle />}
            >
              <Text size="sm">{exportResult.error || t('Unknown error')}</Text>
            </Alert>
          )}
        </div>
      </SettingsCard>
    </SettingsSection>
  )
}
