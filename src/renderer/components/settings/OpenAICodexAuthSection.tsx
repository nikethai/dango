import { Alert, Button, Flex, Loader, SegmentedControl, Stack, Text } from '@mantine/core'
import {
  ensureOpenAICodexBearer,
  fetchOpenAICodexModels,
  humanizeOpenAICodexOAuthNetworkError,
  mergeOpenAICodexModels,
  OPENAI_CODEX_DEFAULT_MODELS,
  type OpenAIAuthMode,
  OpenAICodexOAuthError,
  pollOpenAICodexDeviceAuth,
  resolveOpenAIAuthMode,
  settingsPatchFromOpenAICodexTokens,
  settingsPatchSignOutOpenAICodexOAuth,
  startOpenAICodexDeviceAuth,
  tokensFromCodexAuthJson,
} from '@shared/providers/oauth'
import type { ProviderSettings } from '@shared/types'
import { withInferredImageCapabilitiesList } from '@shared/utils/image-model-capabilities'
import { IconCopy, IconExternalLink, IconFileImport, IconLogout, IconRefresh } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { SettingsCallout } from '@/components/settings/SettingsCallout'
import { SettingsPrefRow } from '@/components/settings/SettingsPrefRow'
import platform from '@/platform'
import { add as addToast } from '@/stores/toastActions'

interface OpenAICodexAuthSectionProps {
  providerSettings?: ProviderSettings
  setProviderSettings: (val: Partial<ProviderSettings>) => void
  /** Hides the "How do you connect?" row (first run already chose ChatGPT). */
  hideModeSwitch?: boolean
}

/**
 * The patch for switching OpenAI into ChatGPT (OAuth) mode. Seeds subscription-safe models when the list is empty or
 * looks like the API catalog (API catalog models often fail on WHAM).
 */
export function openAICodexOAuthModePatch(providerSettings: ProviderSettings | undefined): Partial<ProviderSettings> {
  const looksLikeApiCatalog = (providerSettings?.models || []).some((m) =>
    /gpt-4o|gpt-5\.1|gpt-5-mini|o3|o4|embedding/i.test(m.modelId)
  )
  return {
    authMode: 'oauth',
    ...(looksLikeApiCatalog || !providerSettings?.models?.length ? { models: OPENAI_CODEX_DEFAULT_MODELS } : {}),
  }
}

type SignInPhase = 'idle' | 'starting' | 'waiting' | 'error'

export function OpenAICodexAuthSection({
  providerSettings,
  setProviderSettings,
  hideModeSwitch = false,
}: OpenAICodexAuthSectionProps) {
  const { t } = useTranslation()
  const authMode = resolveOpenAIAuthMode(providerSettings)
  const signedIn = Boolean(providerSettings?.oauth?.accessToken)
  const planType = providerSettings?.oauth?.planType

  const [phase, setPhase] = useState<SignInPhase>('idle')
  const [userCode, setUserCode] = useState<string | null>(null)
  const [verificationUri, setVerificationUri] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cancelSignIn = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setPhase('idle')
    setUserCode(null)
    setVerificationUri(null)
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
    }
  }, [])

  const handleModeChange = (value: string) => {
    if (value !== 'oauth' && value !== 'api_key') return
    cancelSignIn()
    if (value === 'oauth') {
      setProviderSettings(openAICodexOAuthModePatch(providerSettings))
      return
    }
    setProviderSettings({ authMode: value as OpenAIAuthMode })
  }

  const handleSignIn = async () => {
    cancelSignIn()
    const ac = new AbortController()
    abortRef.current = ac
    setPhase('starting')
    setErrorMessage(null)
    setUserCode(null)
    setVerificationUri(null)

    try {
      const device = await startOpenAICodexDeviceAuth()
      if (ac.signal.aborted) return

      setUserCode(device.user_code)
      setVerificationUri(device.verification_uri_complete || device.verification_uri)
      setPhase('waiting')

      const openUrl = device.verification_uri_complete || device.verification_uri
      try {
        await platform.openLink(openUrl)
      } catch {
        // User can open manually
      }

      const tokens = await pollOpenAICodexDeviceAuth(device, { signal: ac.signal })
      if (ac.signal.aborted) return

      const authPatch = settingsPatchFromOpenAICodexTokens(tokens)
      let nextModels = providerSettings?.models
      try {
        const remoteModels = await fetchOpenAICodexModels(tokens.accessToken, {
          accountId: tokens.accountId,
        })
        if (remoteModels.length > 0) {
          nextModels = mergeOpenAICodexModels(providerSettings?.models, remoteModels, {
            replaceAll: true,
          })
        }
      } catch (modelErr) {
        console.warn('[OpenAI Codex] post-auth model list failed', modelErr)
      }

      setProviderSettings({
        ...authPatch,
        ...(nextModels ? { models: nextModels } : {}),
      })
      setPhase('idle')
      setUserCode(null)
      setVerificationUri(null)
      const modelCount = nextModels?.length
      addToast(
        modelCount && nextModels !== providerSettings?.models
          ? t('Signed in to ChatGPT · {{count}} models loaded', { count: modelCount })
          : t('Signed in to ChatGPT')
      )
    } catch (err) {
      if (ac.signal.aborted) return
      const message =
        err instanceof OpenAICodexOAuthError
          ? err.message
          : err instanceof Error
            ? humanizeOpenAICodexOAuthNetworkError(err)
            : t('Sign-in failed. Please try again.')
      setErrorMessage(message)
      setPhase('error')
    } finally {
      if (abortRef.current === ac) {
        abortRef.current = null
      }
    }
  }

  const handleSignOut = () => {
    cancelSignIn()
    setProviderSettings(settingsPatchSignOutOpenAICodexOAuth())
    addToast(t('Signed out of ChatGPT'))
  }

  const [refreshingModels, setRefreshingModels] = useState(false)
  const handleRefreshModels = async () => {
    if (!providerSettings?.oauth?.accessToken && !providerSettings?.oauth?.refreshToken) {
      addToast(t('Sign in first to refresh models'))
      return
    }
    setRefreshingModels(true)
    try {
      // Refresh expired ChatGPT tokens before catalog fetch (stored accessToken alone often 401s).
      const { bearer, accountId, settingsPatch } = await ensureOpenAICodexBearer(providerSettings)
      if (settingsPatch) {
        setProviderSettings(settingsPatch)
      }
      const remoteModels = await fetchOpenAICodexModels(bearer, {
        accountId: accountId || providerSettings?.oauth?.accountId,
      })
      if (remoteModels.length > 0) {
        const nextModels = withInferredImageCapabilitiesList(
          mergeOpenAICodexModels(providerSettings?.models, remoteModels, { replaceAll: true })
        )
        setProviderSettings({
          ...(settingsPatch || {}),
          models: nextModels,
        })
        addToast(t('Refreshed {{count}} models', { count: nextModels.length }))
      } else {
        addToast(t('No models returned'))
      }
    } catch (err) {
      console.warn('[OpenAI Codex] manual model refresh failed', err)
      const message =
        err instanceof OpenAICodexOAuthError
          ? err.message
          : err instanceof Error
            ? humanizeOpenAICodexOAuthNetworkError(err)
            : t('Failed to refresh models')
      addToast(message)
    } finally {
      setRefreshingModels(false)
    }
  }

  /** Import tokens from local Codex CLI (~/.codex/auth.json) after `codex login`. */
  const handleImportCodexAuth = async () => {
    cancelSignIn()
    setErrorMessage(null)
    setPhase('starting')
    try {
      const raw = platform.readCodexAuthConfig
        ? await platform.readCodexAuthConfig()
        : await Promise.reject(new Error('Codex auth import is only available on desktop'))
      const parsed = JSON.parse(raw) as unknown
      const tokens = tokensFromCodexAuthJson(parsed)
      const authPatch = settingsPatchFromOpenAICodexTokens(tokens)
      let nextModels = OPENAI_CODEX_DEFAULT_MODELS
      try {
        const remoteModels = await fetchOpenAICodexModels(tokens.accessToken, {
          accountId: tokens.accountId,
        })
        if (remoteModels.length > 0) {
          nextModels = mergeOpenAICodexModels(undefined, remoteModels, { replaceAll: true })
        }
      } catch (modelErr) {
        console.warn('[OpenAI Codex] model list after import failed', modelErr)
      }
      setProviderSettings({
        ...authPatch,
        models: nextModels,
      })
      setPhase('idle')
      addToast(t('Imported ChatGPT session from Codex CLI'))
    } catch (err) {
      const message =
        err instanceof OpenAICodexOAuthError
          ? err.message
          : err instanceof Error
            ? err.message
            : t('Could not read ~/.codex/auth.json. Run `codex login` first.')
      setErrorMessage(message)
      setPhase('error')
    }
  }

  const handleCopyCode = async () => {
    if (!userCode) return
    try {
      await navigator.clipboard.writeText(userCode)
      addToast(t('Copied'))
    } catch {
      addToast(t('Copy failed'))
    }
  }

  const handleOpenAgain = () => {
    if (verificationUri) {
      void platform.openLink(verificationUri)
    }
  }

  return (
    <div className="settings-card-fields">
      {!hideModeSwitch && (
        <SettingsPrefRow
          title={t('How do you connect?')}
          description={
            authMode === 'oauth'
              ? t('Uses your ChatGPT Plus, Pro, or Team quota — not Platform API billing.')
              : t('API keys from platform.openai.com are billed separately from ChatGPT Plus/Pro.')
          }
          align="start"
          control={
            <SegmentedControl
              className="settings-segmented"
              value={authMode}
              onChange={handleModeChange}
              data={[
                { label: t('Subscription'), value: 'oauth' },
                { label: t('API Key'), value: 'api_key' },
              ]}
            />
          }
        />
      )}

      {authMode === 'oauth' && (
        <>
          <SettingsPrefRow
            title={t('Account')}
            description={!signedIn ? t('Not signed in') : undefined}
            align="start"
            control={
              <div className="settings-actions">
                {signedIn ? (
                  <>
                    <span className="settings-status-pill settings-status-pill-ok">
                      {planType ? t('Signed in ({{plan}})', { plan: planType }) : t('Signed in')}
                    </span>
                    <Button
                      variant="default"
                      size="compact-sm"
                      leftSection={<ScalableIcon icon={IconLogout} size={14} />}
                      onClick={handleSignOut}
                    >
                      {t('Sign out')}
                    </Button>
                    <Button variant="subtle" size="compact-sm" onClick={() => void handleSignIn()}>
                      {t('Re-authenticate')}
                    </Button>
                    <Button
                      variant="subtle"
                      size="compact-sm"
                      loading={refreshingModels}
                      leftSection={<ScalableIcon icon={IconRefresh} size={14} />}
                      onClick={() => void handleRefreshModels()}
                    >
                      {t('Refresh models')}
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      loading={phase === 'starting' && !userCode}
                      disabled={phase === 'waiting'}
                      onClick={() => void handleSignIn()}
                    >
                      {t('Sign in with ChatGPT')}
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      leftSection={<ScalableIcon icon={IconFileImport} size={14} />}
                      loading={phase === 'starting' && !userCode}
                      disabled={phase === 'waiting'}
                      onClick={() => void handleImportCodexAuth()}
                    >
                      {t('Import Codex login')}
                    </Button>
                  </>
                )}
              </div>
            }
          />

          {!signedIn && (
            <Text size="xs" c="chatbox-tertiary">
              {t('Tip: if device sign-in fails, run `codex login` in Terminal then click Import Codex login.')}
            </Text>
          )}

          {(phase === 'waiting' || phase === 'starting' || (phase === 'error' && userCode)) && (
            <div className="settings-device-code-panel">
              {(phase === 'waiting' || phase === 'starting') && (
                <Flex gap="xs" align="center">
                  <Loader size="sm" />
                  <Text size="sm" fw={600}>
                    {t('Enter this code on the ChatGPT page that opened')}
                  </Text>
                </Flex>
              )}

              {userCode ? (
                <Stack gap="xs" align="center">
                  <Text size="xs" c="chatbox-tertiary" ta="center">
                    {t('Your one-time code')}
                  </Text>
                  <Text
                    ff="monospace"
                    fw={700}
                    className="settings-device-code"
                    style={{
                      fontSize: 26,
                      letterSpacing: '0.16em',
                      lineHeight: 1.2,
                      userSelect: 'all',
                    }}
                  >
                    {userCode}
                  </Text>
                  <div className="settings-actions" style={{ justifyContent: 'center' }}>
                    <Button
                      variant="default"
                      size="sm"
                      leftSection={<ScalableIcon icon={IconCopy} size={16} />}
                      onClick={() => void handleCopyCode()}
                    >
                      {t('Copy code')}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      leftSection={<ScalableIcon icon={IconExternalLink} size={16} />}
                      onClick={handleOpenAgain}
                    >
                      {t('Open login page')}
                    </Button>
                    {(phase === 'waiting' || phase === 'starting') && (
                      <Button variant="subtle" size="sm" onClick={cancelSignIn}>
                        {t('Cancel')}
                      </Button>
                    )}
                  </div>
                  <Text size="xs" c="chatbox-tertiary" ta="center">
                    {t('Open https://auth.openai.com/codex/device · paste the code · return here')}
                  </Text>
                </Stack>
              ) : (
                <Flex gap="xs" align="center">
                  <Loader size="sm" />
                  <Text size="sm">{t('Starting sign-in…')}</Text>
                </Flex>
              )}
            </div>
          )}

          {phase === 'error' && errorMessage && (
            <Alert color="red" title={t('Sign-in failed')} radius="md">
              <Stack gap="xs">
                <Text size="sm">{errorMessage}</Text>
                <Button size="compact-sm" className="self-start" onClick={() => void handleSignIn()}>
                  {t('Try again')}
                </Button>
              </Stack>
            </Alert>
          )}

          <div className="settings-actions">
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<ScalableIcon icon={IconExternalLink} size={14} />}
              onClick={() => platform.openLink('https://chatgpt.com/')}
            >
              {t('ChatGPT')}
            </Button>
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<ScalableIcon icon={IconExternalLink} size={14} />}
              onClick={() => platform.openLink('https://openai.com/chatgpt/pricing/')}
            >
              {t('Plans')}
            </Button>
          </div>
        </>
      )}

      {authMode === 'api_key' && (
        <SettingsCallout title={t('Developer API')} tone="warning">
          <Text size="sm" c="inherit" component="div">
            {t(
              'API keys from platform.openai.com are billed separately from ChatGPT Plus/Pro. Switch to ChatGPT subscription to use your plan quota.'
            )}
          </Text>
          <Button
            mt="xs"
            variant="default"
            size="compact-sm"
            leftSection={<ScalableIcon icon={IconExternalLink} size={14} />}
            onClick={() => platform.openLink('https://platform.openai.com/api-keys')}
          >
            {t('Get API Key')}
          </Button>
        </SettingsCallout>
      )}
    </div>
  )
}
