import { Alert, Button, Code, Group, NumberInput, Switch, Text, Textarea, TextInput } from '@mantine/core'
import { IconCopy, IconExternalLink, IconFolder, IconInfoCircle, IconRefresh } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsPrefRow } from '@/components/settings/SettingsPrefRow'
import { SettingsSection } from '@/components/settings/SettingsSection'
import {
  permissionLabel,
  privacySettingsPathLabel,
  privacySettingsUrls,
  type OsFamily,
} from '@/packages/computer/privacy-settings'
import { exportComputerTrajectoryText } from '@/packages/computer/trajectory'
import { getOS } from '@/packages/navigator'
import platform from '@/platform'
import type { ComputerPermissionStatus } from '@/platform/interfaces'
import { currentSessionIdAtom } from '@/stores/atoms'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAtomValue } from 'jotai'

export const Route = createFileRoute('/settings/computer-use')({
  component: RouteComponent,
})

function statusTone(status: string | undefined): string {
  switch ((status || '').toLowerCase()) {
    case 'granted':
      return 'var(--mantine-color-green-text, var(--chatbox-tint-success, #2f9e44))'
    case 'denied':
      return 'var(--mantine-color-red-text, var(--chatbox-tint-danger, #e03131))'
    default:
      return 'var(--chatbox-tint-tertiary)'
  }
}

function RouteComponent() {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((s) => s.setSettings)
  const extension = useSettingsStore((s) => s.extension)
  const computerUse = useMemo(
    () => ({
      enabled: false,
      maxScreenshotsPerTurn: 16,
      abortHotkey: '',
      appAllowlist: [] as string[],
      debugTrajectory: false,
      ...(extension.computerUse || {}),
    }),
    [extension.computerUse]
  )
  const currentSessionId = useAtomValue(currentSessionIdAtom)

  const desktop = platform.type === 'desktop'
  const os = (getOS() === 'Unknown' ? 'Mac' : getOS()) as OsFamily
  const [perm, setPerm] = useState<ComputerPermissionStatus | null>(null)
  const [checking, setChecking] = useState(false)

  const refreshPermission = useCallback(
    async (opts?: { request?: boolean }) => {
      if (!desktop || !platform.computerPermissionStatus) {
        setPerm(null)
        return null
      }
      setChecking(true)
      try {
        const status =
          opts?.request && platform.computerPermissionRequest
            ? await platform.computerPermissionRequest()
            : await platform.computerPermissionStatus()
        setPerm(status)
        return status
      } catch (err) {
        console.error('[computer-use] permission recheck failed', err)
        const fallback: ComputerPermissionStatus = {
          screenRecording: 'unknown',
          accessibility: 'unknown',
          platform: os.toLowerCase(),
        }
        setPerm(fallback)
        toast.error(t('Could not recheck permissions. Restart Dango and try again.'))
        return fallback
      } finally {
        setChecking(false)
      }
    },
    [desktop, os, t]
  )

  const onRecheck = async () => {
    // Main-thread CGRequestScreenCaptureAccess registers this process in TCC (dev needs this).
    const status = await refreshPermission({ request: true })
    if (!status) return
    const screen = (status.screenRecording || '').toLowerCase()
    const access = (status.accessibility || '').toLowerCase()
    if (screen === 'granted' && (access === 'granted' || access === 'unknown')) {
      toast.success(t('Permissions look good.'))
      return
    }
    if (screen === 'granted' && access === 'denied') {
      toast.message(t('Screen Recording is allowed. Enable Accessibility for click/type and AX focus.'))
      return
    }
    if (screen === 'denied') {
      if (status.isDevBinary) {
        toast.error(
          t(
            'Still blocked for this process. In Screen Recording enable the entry for this binary, fully quit Dango, restart `pnpm dev`, then Recheck. (macOS only applies Screen Recording after relaunch.)'
          )
        )
      } else {
        toast.error(t('Still blocked. Enable Dango in Screen Recording, then quit and reopen the app once.'))
      }
      return
    }
    toast.message(t('Status updated.'))
  }

  const revealExecutable = async () => {
    if (!platform.computerRevealExecutable) {
      toast.message(t('Reveal is only available in the desktop app.'))
      return
    }
    try {
      const result = await platform.computerRevealExecutable()
      toast.message(t('Finder highlighted the running binary. Use + in Screen Recording and select it if missing.'))
      if (result?.executablePath) {
        console.info('[computer-use] executable', result.executablePath)
      }
    } catch (err) {
      console.error('[computer-use] reveal failed', err)
      toast.error(t('Could not reveal the binary. Path is shown under Screen Recording.'))
    }
  }

  useEffect(() => {
    void refreshPermission()
  }, [refreshPermission])

  const patch = (partial: Partial<typeof computerUse>) => {
    setSettings({
      extension: {
        ...extension,
        computerUse: { ...computerUse, ...partial },
      },
    })
  }

  const openPrivacy = async (pane: 'screen-recording' | 'accessibility') => {
    const urls = privacySettingsUrls(os, pane)
    if (!urls.length) {
      toast.message(t('Open System Settings → Privacy & Security manually.'))
      return
    }
    let lastError: unknown
    for (const url of urls) {
      try {
        await platform.openLink(url)
        // Give OS a beat, then nudge recheck so status can update after user returns.
        return
      } catch (err) {
        lastError = err
      }
    }
    console.error('[computer-use] open privacy settings failed', lastError)
    toast.error(
      t('Could not open System Settings. Open Privacy & Security → {{pane}} manually.', {
        pane: pane === 'screen-recording' ? t('Screen Recording') : t('Accessibility'),
      })
    )
  }

  const screenStatus = perm?.screenRecording || 'unknown'
  const accessStatus = perm?.accessibility || 'unknown'
  const showRestartHint = screenStatus === 'denied'
  const canOpenPrivacy = desktop && os !== 'Linux'
  const isDevBinary = Boolean(perm?.isDevBinary)
  const processName = perm?.processName || 'dango'
  const executablePath = perm?.executablePath

  const screenDescription = (() => {
    if (screenStatus === 'granted') return t('Screenshots allowed.')
    if (screenStatus === 'denied' && isDevBinary) {
      return t(
        'Dev binary uses a separate TCC identity. Enable “{{name}}” (or “Dango”) in Screen Recording, then fully quit and restart `pnpm dev` once. Rebuilds without stable signing can drop the grant.',
        { name: processName }
      )
    }
    if (screenStatus === 'denied') {
      return t('Blocked. Enable Dango in System Settings, then recheck. Restart may be required once.')
    }
    return t('Needed for observe. Opens: {{path}}', {
      path: privacySettingsPathLabel(os, 'screen-recording'),
    })
  })()

  const accessDescription = (() => {
    if (accessStatus === 'granted') return t('Click, type, and AX focus/press allowed.')
    if (accessStatus === 'denied') return t('Blocked. Enable Dango under Accessibility, then recheck.')
    return t('Needed for act. Status updates after the first click/type prompt. Opens: {{path}}', {
      path: privacySettingsPathLabel(os, 'accessibility'),
    })
  })()

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t('Computer use')}
        description={t('Observe the screen and optionally click or type. Desktop only.')}
      />

      {!desktop && (
        <Alert icon={<IconInfoCircle size={16} />} color="yellow" mb="md">
          {t('Computer use is only available in the desktop app.')}
        </Alert>
      )}

      <SettingsSection title={t('General')}>
        <SettingsCard divided>
          <SettingsPrefRow
            title={t('Enable computer use')}
            description={t('Master switch. Arm per chat from the composer + menu.')}
            control={
              <Switch
                checked={computerUse.enabled}
                disabled={!desktop}
                onChange={(e) => {
                  const next = e.currentTarget.checked
                  patch({ enabled: next })
                  if (next) void refreshPermission()
                }}
                aria-label={t('Enable computer use')}
              />
            }
          />
          <SettingsPrefRow
            title={t('Max screenshots per turn')}
            description={t('Caps capture calls in one reply.')}
            control={
              <NumberInput
                min={1}
                max={20}
                step={1}
                size="sm"
                clampBehavior="strict"
                value={computerUse.maxScreenshotsPerTurn}
                disabled={!desktop || !computerUse.enabled}
                onChange={(v) => patch({ maxScreenshotsPerTurn: typeof v === 'number' ? v : 16 })}
                w={88}
                styles={{ input: { textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }}
                aria-label={t('Max screenshots per turn')}
              />
            }
          />
          <SettingsPrefRow
            title={t('Abort hotkey')}
            description={t('Optional. HUD Stop is the reliable abort today.')}
            control={
              <TextInput
                size="sm"
                value={computerUse.abortHotkey || ''}
                placeholder="Ctrl+Shift+Esc"
                disabled={!desktop || !computerUse.enabled}
                onChange={(e) => patch({ abortHotkey: e.currentTarget.value })}
                w={148}
                aria-label={t('Abort hotkey')}
              />
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('Permissions')}
        description={t('macOS manages these switches. Open Settings, enable Dango, then recheck.')}
      >
        <SettingsCard divided>
          <SettingsPrefRow
            title={t('Screen Recording')}
            description={
              <span>
                <Text span size="xs" fw={600} style={{ color: statusTone(screenStatus) }}>
                  {t(permissionLabel(screenStatus))}
                </Text>
                <Text span size="xs" c="dimmed">
                  {' · '}
                  {screenDescription}
                </Text>
              </span>
            }
            control={
              <Group gap={6} wrap="nowrap">
                {screenStatus !== 'granted' && (
                  <Button
                    size="compact-xs"
                    variant="light"
                    loading={checking}
                    disabled={!desktop}
                    onClick={() => void onRecheck()}
                  >
                    {t('Request Access')}
                  </Button>
                )}
                <Button
                  size="compact-xs"
                  variant="default"
                  leftSection={<IconExternalLink size={13} />}
                  disabled={!canOpenPrivacy}
                  onClick={() => void openPrivacy('screen-recording')}
                >
                  {t('Open')}
                </Button>
              </Group>
            }
          />
          {isDevBinary && screenStatus !== 'granted' && executablePath && (
            <SettingsPrefRow
              title={t('Dev binary')}
              description={
                <span>
                  <Text size="xs" c="dimmed">
                    {t('macOS lists this path, not “Dango.app”. If missing, use + and pick the revealed file.')}
                  </Text>
                  <Code block mt={6} style={{ fontSize: 11, wordBreak: 'break-all' }}>
                    {executablePath}
                  </Code>
                </span>
              }
              control={
                <Button
                  size="compact-xs"
                  variant="default"
                  leftSection={<IconFolder size={13} />}
                  disabled={!desktop}
                  onClick={() => void revealExecutable()}
                >
                  {t('Reveal')}
                </Button>
              }
            />
          )}
          <SettingsPrefRow
            title={t('Accessibility')}
            description={
              <span>
                <Text span size="xs" fw={600} style={{ color: statusTone(accessStatus) }}>
                  {t(permissionLabel(accessStatus))}
                </Text>
                <Text span size="xs" c="dimmed">
                  {' · '}
                  {accessDescription}
                </Text>
              </span>
            }
            control={
              <Button
                size="compact-xs"
                variant="default"
                leftSection={<IconExternalLink size={13} />}
                disabled={!canOpenPrivacy}
                onClick={() => void openPrivacy('accessibility')}
              >
                {t('Open')}
              </Button>
            }
          />
          <SettingsPrefRow
            title={t('Verify')}
            description={
              showRestartHint
                ? t('If still blocked after enabling, quit and reopen Dango once.')
                : t('Refresh status after changing System Settings.')
            }
            control={
              <Button
                size="compact-xs"
                variant="light"
                leftSection={<IconRefresh size={13} />}
                loading={checking}
                disabled={!desktop}
                onClick={() => void onRecheck()}
              >
                {t('Recheck')}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsSection
        title={t('Safety & debug')}
        description={t(
          'Dev and App Store builds are different apps for macOS privacy. Permissions apply only to the running binary.'
        )}
      >
        <SettingsCard divided>
          <SettingsPrefRow
            title={t('App allowlist')}
            description={t('Optional. One app name per line. Empty = allow all (except blocked Finder for messaging).')}
            control={
              <Textarea
                size="sm"
                minRows={2}
                maxRows={5}
                autosize
                w={220}
                disabled={!desktop || !computerUse.enabled}
                value={(computerUse.appAllowlist || []).join('\n')}
                placeholder={'WhatsApp\nCalculator'}
                onChange={(e) => {
                  const lines = e.currentTarget.value
                    .split('\n')
                    .map((s) => s.trim())
                    .filter(Boolean)
                  patch({ appAllowlist: lines })
                }}
                aria-label={t('App allowlist')}
              />
            }
          />
          <SettingsPrefRow
            title={t('Record tool trajectory')}
            description={t('Keeps last steps (names/args summary) for the current chat. Off by default.')}
            control={
              <Switch
                checked={Boolean(computerUse.debugTrajectory)}
                disabled={!desktop || !computerUse.enabled}
                onChange={(e) => patch({ debugTrajectory: e.currentTarget.checked })}
                aria-label={t('Record tool trajectory')}
              />
            }
          />
          <SettingsPrefRow
            title={t('Export trajectory')}
            description={t('Copy last computer tool steps from the current session to the clipboard.')}
            control={
              <Button
                size="compact-xs"
                variant="default"
                leftSection={<IconCopy size={13} />}
                disabled={!desktop || !computerUse.enabled || !currentSessionId}
                onClick={async () => {
                  if (!currentSessionId) {
                    toast.error(t('Open a chat session first.'))
                    return
                  }
                  const text = exportComputerTrajectoryText(currentSessionId)
                  try {
                    await navigator.clipboard.writeText(text)
                    toast.success(t('Trajectory copied'))
                  } catch {
                    toast.error(t('Could not copy trajectory'))
                  }
                }}
              >
                {t('Copy')}
              </Button>
            }
          />
        </SettingsCard>
      </SettingsSection>

      {os === 'Linux' && (
        <Text size="xs" c="dimmed" px={4}>
          {t('Linux is experimental: gnome-screenshot / ImageMagick for capture, xdotool for act.')}
        </Text>
      )}
    </SettingsPage>
  )
}
