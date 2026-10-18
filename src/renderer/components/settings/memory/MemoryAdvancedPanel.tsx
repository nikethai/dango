import {
  Alert,
  Box,
  Button,
  Code,
  Collapse,
  Group,
  NumberInput,
  PasswordInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import type { MemoryRetrievalMode, MemorySettings } from '@shared/types/memory'
import type { MemorySyncConfig } from '@shared/types/settings'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { MemorySyncState } from '@/packages/memory/sync-types'
import {
  getMemorySyncState,
  pullMemoryFromServer,
  pushMemoryToServer,
  syncMemoryNow,
  testMemorySyncConnection,
} from '@/stores/memorySync'
import { useSettingsStore } from '@/stores/settingsStore'
import { memoryPanelStyle } from './memory-ui-state'

export type MemoryAdvancedPanelProps = {
  settings: MemorySettings
  factCount: number
  injectTokens: number
  injectText: string
  onSettingsChange: (patch: Partial<MemorySettings>) => void
}

const labelStyles = { label: { fontWeight: 400 as const } }

type MemorySyncFormState = {
  enabled: boolean
  endpoint: string
  token: string
  autoSync: boolean
  intervalSeconds: number
}

const DEFAULT_MEMORY_SYNC_FORM: MemorySyncFormState = {
  enabled: false,
  endpoint: '',
  token: '',
  autoSync: false,
  intervalSeconds: 60,
}

function clampMemorySyncIntervalSeconds(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_MEMORY_SYNC_FORM.intervalSeconds
  return Math.min(3600, Math.max(15, Math.round(value)))
}

function normalizeMemorySyncForm(config: Partial<MemorySyncConfig> | undefined | null): MemorySyncFormState {
  return {
    enabled: Boolean(config?.enabled),
    endpoint: typeof config?.endpoint === 'string' ? config.endpoint : '',
    token: typeof config?.token === 'string' ? config.token : '',
    autoSync: Boolean(config?.autoSync),
    intervalSeconds: clampMemorySyncIntervalSeconds(
      typeof config?.intervalSeconds === 'number' ? config.intervalSeconds : DEFAULT_MEMORY_SYNC_FORM.intervalSeconds
    ),
  }
}

function isSameMemorySyncForm(a: MemorySyncFormState, b: MemorySyncFormState): boolean {
  return (
    a.enabled === b.enabled &&
    a.endpoint === b.endpoint &&
    a.token === b.token &&
    a.autoSync === b.autoSync &&
    a.intervalSeconds === b.intervalSeconds
  )
}

export function MemoryAdvancedPanel({
  settings,
  factCount,
  injectTokens,
  injectText,
  onSettingsChange,
}: MemoryAdvancedPanelProps) {
  const { t } = useTranslation()
  const [showInjectPreview, setShowInjectPreview] = useState(() => process.env.NODE_ENV === 'development')
  const mode = settings.retrievalMode ?? 'hybrid'

  const modeHelp =
    mode === 'always'
      ? t('Always inject: profile + many facts every chat (highest reliability, more tokens).')
      : mode === 'on_demand'
        ? t(
            'On-demand: almost nothing injected. Model must search memory tools. Falls back to hybrid on models without tools.'
          )
        : t(
            'Hybrid (recommended): inject short profile + pinned facts only. Unpinned facts via search tools or auto-match from the user message.'
          )

  const storedSyncConfig = useSettingsStore((state) => state.extension.memorySync)
  const setSettings = useSettingsStore((state) => state.setSettings)
  const [syncForm, setSyncForm] = useState<MemorySyncFormState>(() => normalizeMemorySyncForm(storedSyncConfig))
  const [passphrase, setPassphrase] = useState('')
  const [syncState, setSyncState] = useState<MemorySyncState>()
  const [syncAction, setSyncAction] = useState<'test' | 'pull' | 'push' | 'sync' | null>(null)
  const [syncTips, setSyncTips] = useState('')
  const [syncError, setSyncError] = useState(false)

  useEffect(() => {
    void getMemorySyncState().then(setSyncState)
  }, [])

  const updateSyncForm = (next: Partial<MemorySyncFormState>) => {
    setSyncForm((current) => {
      const merged = normalizeMemorySyncForm({ ...current, ...next })
      return isSameMemorySyncForm(current, merged) ? current : merged
    })
  }

  const persistSyncConfig = () => {
    const normalized = normalizeMemorySyncForm(syncForm)
    setSettings((state) => {
      const current = normalizeMemorySyncForm(state.extension.memorySync)
      if (isSameMemorySyncForm(current, normalized)) return
      state.extension.memorySync = normalized
    })
    setSyncTips(t('Sync settings saved'))
    setSyncError(false)
  }

  const syncConfig = (): MemorySyncConfig => ({
    enabled: syncForm.enabled,
    endpoint: syncForm.endpoint,
    token: syncForm.token,
    autoSync: syncForm.autoSync,
    intervalSeconds: syncForm.intervalSeconds,
  })

  const runSyncAction = async (action: 'test' | 'pull' | 'push' | 'sync', runner: () => Promise<{ tip: string }>) => {
    setSyncAction(action)
    setSyncTips('')
    setSyncError(false)
    try {
      const result = await runner()
      setSyncState(await getMemorySyncState())
      setSyncTips(result.tip)
    } catch (error) {
      console.error(`Memory sync ${action} failed:`, error)
      setSyncError(true)
      setSyncTips(error instanceof Error ? error.message : t('Memory sync failed'))
      setSyncState(await getMemorySyncState())
    } finally {
      setSyncAction(null)
    }
  }

  const storedSyncForm = normalizeMemorySyncForm(storedSyncConfig)
  const hasUnsavedSyncChanges = !isSameMemorySyncForm(syncForm, storedSyncForm)
  const isSyncPending = syncAction !== null
  const hasSyncCredentials = Boolean(syncForm.endpoint.trim() && syncForm.token.trim())
  const canRunSyncAction = syncForm.enabled && hasSyncCredentials && !isSyncPending

  return (
    <Stack gap="lg" maw={640}>
      <Stack gap="md">
        <Title order={6}>{t('Retrieval')}</Title>
        <Select
          maw={360}
          styles={labelStyles}
          label={t('Memory retrieval mode')}
          description={modeHelp}
          data={[
            { value: 'hybrid', label: t('Hybrid (recommended)') },
            { value: 'always', label: t('Always inject') },
            { value: 'on_demand', label: t('On-demand only') },
          ]}
          value={mode}
          onChange={(v) => {
            if (v) onSettingsChange({ retrievalMode: v as MemoryRetrievalMode })
          }}
          allowDeselect={false}
        />
        <Text size="xs" c="chatbox-tertiary" style={{ textWrap: 'pretty' as const }}>
          {t(
            'Pin important facts so they stay in hybrid inject. Use memory_recall (or auto-match) for everything else to save tokens.'
          )}
        </Text>
      </Stack>

      <Stack gap="xs">
        <Title order={6}>{t('Inject preview')}</Title>
        <Box p="sm" style={memoryPanelStyle}>
          <Group justify="space-between" mb="xs" align="flex-start">
            <div>
              <Text size="sm" fw={600}>
                {t('System prompt block')}
                {process.env.NODE_ENV === 'development' ? ' (dev)' : ''}
              </Text>
              <Text size="xs" c="chatbox-tertiary" style={{ textWrap: 'pretty' as const }}>
                {t('Exact block prepended into the model system prompt when Memory is enabled. No Network tab needed.')}
              </Text>
            </div>
            <Button
              size="xs"
              variant="light"
              onClick={() => setShowInjectPreview((v) => !v)}
              className="active:scale-[0.96] transition-transform"
            >
              {showInjectPreview ? t('Hide') : t('Show')}
            </Button>
          </Group>
          <Text size="xs" c="chatbox-secondary" mb="xs" className="tabular-nums">
            {settings.enabled
              ? t('Status: {{mode}} · {{count}} facts · ~{{tokens}} tokens', {
                  mode,
                  count: factCount,
                  tokens: injectTokens,
                })
              : t('Status: Memory disabled — inject is empty')}
          </Text>
          <Collapse in={showInjectPreview}>
            <Code
              block
              style={{
                whiteSpace: 'pre-wrap',
                maxHeight: 320,
                overflow: 'auto',
                fontSize: 12,
                borderRadius: 9,
              }}
            >
              {injectText || t('(empty — enable Memory and add facts under Global)')}
            </Code>
            {injectText ? (
              <Button
                size="xs"
                variant="subtle"
                mt="xs"
                className="active:scale-[0.96] transition-transform"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(injectText)
                    toast.success(t('Copied inject preview'))
                  } catch {
                    toast.error(t('Copy failed'))
                  }
                }}
              >
                {t('Copy preview')}
              </Button>
            ) : null}
          </Collapse>
        </Box>
      </Stack>

      <Stack gap="md">
        <Title order={6}>{t('Budgets')}</Title>
        {(mode === 'hybrid' || mode === 'on_demand') && (
          <>
            <NumberInput
              maw={320}
              styles={labelStyles}
              label={t('Core global budget (tokens)')}
              description={t('Hybrid profile + pinned facts for global memory')}
              value={settings.injectBudgetTokensCoreGlobal ?? 250}
              min={50}
              max={2000}
              classNames={{ input: 'tabular-nums' }}
              onChange={(v) => onSettingsChange({ injectBudgetTokensCoreGlobal: Number(v) || 250 })}
            />
            <NumberInput
              maw={320}
              styles={labelStyles}
              label={t('Core agent budget (tokens)')}
              description={t('Hybrid profile + pinned facts for agent memory')}
              value={settings.injectBudgetTokensCoreAgent ?? 150}
              min={50}
              max={1500}
              classNames={{ input: 'tabular-nums' }}
              onChange={(v) => onSettingsChange({ injectBudgetTokensCoreAgent: Number(v) || 150 })}
            />
          </>
        )}
        {mode === 'always' && (
          <>
            <NumberInput
              maw={320}
              styles={labelStyles}
              label={t('Global inject budget (tokens)')}
              value={settings.injectBudgetTokensGlobal}
              min={200}
              max={8000}
              classNames={{ input: 'tabular-nums' }}
              onChange={(v) => onSettingsChange({ injectBudgetTokensGlobal: Number(v) || 1200 })}
            />
            <NumberInput
              maw={320}
              styles={labelStyles}
              label={t('Agent inject budget (tokens)')}
              value={settings.injectBudgetTokensAgent}
              min={100}
              max={4000}
              classNames={{ input: 'tabular-nums' }}
              onChange={(v) => onSettingsChange({ injectBudgetTokensAgent: Number(v) || 800 })}
            />
          </>
        )}
        <NumberInput
          maw={320}
          styles={labelStyles}
          label={t('Max global entries')}
          value={settings.maxEntriesGlobal}
          min={20}
          max={2000}
          classNames={{ input: 'tabular-nums' }}
          onChange={(v) => onSettingsChange({ maxEntriesGlobal: Number(v) || 300 })}
        />
        <NumberInput
          maw={320}
          styles={labelStyles}
          label={t('Max entries per agent')}
          value={settings.maxEntriesPerAgent}
          min={10}
          max={1000}
          classNames={{ input: 'tabular-nums' }}
          onChange={(v) => onSettingsChange({ maxEntriesPerAgent: Number(v) || 150 })}
        />
        <NumberInput
          maw={320}
          styles={labelStyles}
          label={t('Auto-save every N turns')}
          value={settings.retainEveryNTurns}
          min={1}
          max={20}
          classNames={{ input: 'tabular-nums' }}
          onChange={(v) => onSettingsChange({ retainEveryNTurns: Number(v) || 3 })}
        />
      </Stack>

      <Stack gap="md">
        <Title order={6}>{t('Auto-match from message')}</Title>
        <Switch
          label={t('Host pre-search')}
          description={t(
            'Keyword-match the latest user message against memory and attach a few relevant facts (hybrid / on-demand). No extra model call.'
          )}
          checked={settings.hostPreSearchEnabled !== false}
          onChange={(e) => onSettingsChange({ hostPreSearchEnabled: e.currentTarget.checked })}
        />
        <NumberInput
          maw={320}
          styles={labelStyles}
          label={t('Pre-search limit')}
          value={settings.hostPreSearchLimit ?? 5}
          min={1}
          max={20}
          disabled={settings.hostPreSearchEnabled === false}
          classNames={{ input: 'tabular-nums' }}
          onChange={(v) => onSettingsChange({ hostPreSearchLimit: Number(v) || 5 })}
        />
      </Stack>

      <Stack gap="md">
        <Title order={6}>{t('Behavior')}</Title>
        <Switch
          label={t('Auto-consolidate profile')}
          description={t('LLM rewrite of profile summary (lazy — after several new facts, not every turn)')}
          checked={settings.autoConsolidate}
          onChange={(e) => onSettingsChange({ autoConsolidate: e.currentTarget.checked })}
        />
        <NumberInput
          maw={320}
          styles={labelStyles}
          label={t('LLM consolidate every N new facts')}
          value={settings.consolidateEveryNRetains ?? 5}
          min={1}
          max={50}
          disabled={!settings.autoConsolidate}
          classNames={{ input: 'tabular-nums' }}
          onChange={(v) => onSettingsChange({ consolidateEveryNRetains: Number(v) || 5 })}
        />
        <Switch
          label={t('Soft-archive on overflow')}
          description={t('When over max entries, disable old unused facts instead of hard-delete (pins kept)')}
          checked={settings.softArchiveOnPrune !== false}
          onChange={(e) => onSettingsChange({ softArchiveOnPrune: e.currentTarget.checked })}
        />
        <Switch
          label={t('Local semantic boost')}
          description={t('Hybrid lexical + token-vector scoring for recall (no external embed API)')}
          checked={settings.semanticSearchEnabled !== false}
          onChange={(e) => onSettingsChange({ semanticSearchEnabled: e.currentTarget.checked })}
        />
      </Stack>

      <Stack gap="md">
        <Title order={6}>{t('Memory Sync')}</Title>
        <Text size="xs" c="chatbox-tertiary" style={{ textWrap: 'pretty' as const }}>
          {t(
            'Encrypted multi-device sync for the memory bank through your self-hosted sync server. Snapshots are encrypted with your passphrase before upload; losing the passphrase makes remote memory unrecoverable.'
          )}
        </Text>
        <Switch
          label={t('Enable memory sync')}
          description={t('Turn on encrypted pull/push to your sync server')}
          checked={syncForm.enabled}
          onChange={(e) => updateSyncForm({ enabled: e.currentTarget.checked })}
        />
        <TextInput
          maw={360}
          styles={labelStyles}
          label={t('Sync server endpoint')}
          placeholder="https://your-sync-host.example.com"
          value={syncForm.endpoint}
          onChange={(e) => updateSyncForm({ endpoint: e.currentTarget.value })}
        />
        <PasswordInput
          maw={360}
          styles={labelStyles}
          label={t('Sync token')}
          value={syncForm.token}
          onChange={(e) => updateSyncForm({ token: e.currentTarget.value })}
        />
        <PasswordInput
          maw={360}
          styles={labelStyles}
          label={t('Sync passphrase')}
          description={t('Used only to encrypt/decrypt snapshots, never saved. No passphrase recovery.')}
          value={passphrase}
          onChange={(e) => setPassphrase(e.currentTarget.value)}
        />
        <Switch
          label={t('Auto sync in background')}
          checked={syncForm.autoSync}
          onChange={(e) => updateSyncForm({ autoSync: e.currentTarget.checked })}
        />
        <NumberInput
          maw={320}
          styles={labelStyles}
          label={t('Auto sync interval (seconds)')}
          value={syncForm.intervalSeconds}
          min={15}
          max={3600}
          disabled={!syncForm.autoSync}
          classNames={{ input: 'tabular-nums' }}
          onChange={(v) => updateSyncForm({ intervalSeconds: clampMemorySyncIntervalSeconds(Number(v) || 60) })}
        />
        <div className="settings-actions">
          <Button variant="light" onClick={persistSyncConfig} disabled={!hasUnsavedSyncChanges}>
            {t('Save Sync Settings')}
          </Button>
        </div>
        {hasUnsavedSyncChanges && (
          <Text size="sm" c="chatbox-tertiary">
            {t('You have unsaved sync settings. Save to apply background auto sync.')}
          </Text>
        )}
        <Text size="xs" c="chatbox-secondary">
          {t('Local sync state: revision {{revision}}, last synced {{lastSyncedAt}}', {
            revision: syncState?.revision ?? 0,
            lastSyncedAt: syncState?.lastSyncedAt ? new Date(syncState.lastSyncedAt).toLocaleString() : t('Never'),
          })}
        </Text>
        {syncState?.lastError && (
          <Text size="sm" c="red">
            {syncState.lastError}
          </Text>
        )}
        {syncTips && (
          <Alert
            className="self-start"
            variant="light"
            color={syncError ? 'yellow' : 'green'}
            title={syncError ? t('Memory sync failed') : t('Memory sync completed')}
          >
            <Text size="sm">{syncTips}</Text>
          </Alert>
        )}
        {!hasSyncCredentials && (
          <Text size="sm" c="chatbox-tertiary">
            {t('Set endpoint and token first, then test/pull/push/sync')}
          </Text>
        )}
        <div className="settings-actions">
          <Button
            variant="light"
            onClick={() =>
              runSyncAction('test', async () => {
                const remote = await testMemorySyncConnection(syncConfig())
                return { tip: t('Connected. Remote revision {{revision}}.', { revision: remote.revision }) }
              })
            }
            loading={syncAction === 'test'}
            disabled={!hasSyncCredentials || isSyncPending}
          >
            {t('Test Connection')}
          </Button>
          <Button
            variant="light"
            onClick={() =>
              runSyncAction('pull', async () => {
                await pullMemoryFromServer(syncConfig(), passphrase)
                return { tip: t('Pulled memory from server') }
              })
            }
            loading={syncAction === 'pull'}
            disabled={!canRunSyncAction || !passphrase}
          >
            {t('Pull from Server')}
          </Button>
          <Button
            variant="light"
            onClick={() =>
              runSyncAction('push', async () => {
                await pushMemoryToServer(syncConfig(), passphrase)
                return { tip: t('Pushed memory to server') }
              })
            }
            loading={syncAction === 'push'}
            disabled={!canRunSyncAction || !passphrase}
          >
            {t('Push to Server')}
          </Button>
          <Button
            onClick={() =>
              runSyncAction('sync', async () => {
                await syncMemoryNow(syncConfig(), passphrase)
                return { tip: t('Sync completed') }
              })
            }
            loading={syncAction === 'sync'}
            disabled={!canRunSyncAction || !passphrase}
          >
            {t('Sync Now')}
          </Button>
        </div>
      </Stack>
    </Stack>
  )
}
