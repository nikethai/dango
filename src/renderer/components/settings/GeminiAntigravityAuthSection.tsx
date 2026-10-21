import { Alert, Button, Checkbox, Flex, Loader, SegmentedControl, Stack, Text, Textarea } from '@mantine/core'
import {
  enrichGeminiAntigravitySession,
  ensureGeminiAntigravityBearer,
  exchangeAuthorizationCode,
  fetchGeminiAntigravityModels,
  GEMINI_ANTIGRAVITY_DEFAULT_MODELS,
  GEMINI_ANTIGRAVITY_REDIRECT_URI,
  GeminiAntigravityOAuthError,
  type GeminiAntigravityPkceSession,
  type GeminiAuthMode,
  humanizeGeminiAntigravityOAuthNetworkError,
  parseGeminiAntigravityRedirectUrl,
  resolveGeminiAuthMode,
  resolveModelsAfterAntigravityLogin,
  settingsPatchFromGeminiAntigravityTokens,
  settingsPatchSignOutGeminiAntigravityOAuth,
  startGeminiAntigravityPkceAuth,
} from '@shared/providers/oauth'
import type { ProviderModelInfo, ProviderSettings } from '@shared/types'
import { withInferredImageCapabilitiesList } from '@shared/utils/image-model-capabilities'
import { IconExternalLink, IconLogout, IconRefresh } from '@tabler/icons-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { SettingsCallout } from '@/components/settings/SettingsCallout'
import { SettingsPrefRow } from '@/components/settings/SettingsPrefRow'
import platform from '@/platform'
import { add as addToast } from '@/stores/toastActions'
import {
  cancelLocalOAuthCallback,
  canUseLocalOAuthCallback,
  waitForLocalOAuthCallback,
} from '@/utils/oauth-local-callback'

interface GeminiAntigravityAuthSectionProps {
  providerSettings?: ProviderSettings
  setProviderSettings: (val: Partial<ProviderSettings>) => void
  /** Hides the "How do you connect?" row (first run already chose Google). The risk notice always shows. */
  hideModeSwitch?: boolean
}

/** The patch for switching Gemini into Google (OAuth) mode: Cloud Code Assist model ids, never the AI Studio catalog. */
export function geminiAntigravityOAuthModePatch(): Partial<ProviderSettings> {
  return { authMode: 'oauth', models: GEMINI_ANTIGRAVITY_DEFAULT_MODELS.map((m) => ({ ...m })) }
}

type SignInPhase = 'idle' | 'starting' | 'waiting' | 'exchanging' | 'error'

export function GeminiAntigravityAuthSection({
  providerSettings,
  setProviderSettings,
  hideModeSwitch = false,
}: GeminiAntigravityAuthSectionProps) {
  const { t } = useTranslation()
  const authMode = resolveGeminiAuthMode(providerSettings)
  const signedIn = Boolean(providerSettings?.oauth?.accessToken)
  const email = providerSettings?.oauth?.email
  const planType = providerSettings?.oauth?.planType
  const riskAccepted = Boolean(providerSettings?.oauth?.riskAcceptedAt)
  const desktopCallback = canUseLocalOAuthCallback()

  const [phase, setPhase] = useState<SignInPhase>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [redirectPaste, setRedirectPaste] = useState('')
  const [riskChecked, setRiskChecked] = useState(riskAccepted)
  /** True when local server failed and user must paste */
  const [forcePasteMode, setForcePasteMode] = useState(false)
  const pkceRef = useRef<GeminiAntigravityPkceSession | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cancelSignIn = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    pkceRef.current = null
    void cancelLocalOAuthCallback()
    setPhase('idle')
    setRedirectPaste('')
    setForcePasteMode(false)
  }, [])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      void cancelLocalOAuthCallback()
    }
  }, [])

  const finishWithRedirectUrl = useCallback(
    async (redirectUrl: string, session: GeminiAntigravityPkceSession, signal: AbortSignal) => {
      setPhase('exchanging')
      setErrorMessage(null)

      const { code, state } = parseGeminiAntigravityRedirectUrl(redirectUrl)
      if (state && state !== session.state) {
        throw new GeminiAntigravityOAuthError('OAuth state mismatch. Cancel and start sign-in again.', 'state_mismatch')
      }
      if (signal.aborted) return

      let tokens = await exchangeAuthorizationCode({
        code,
        verifier: session.verifier,
        redirectUri: session.redirectUri,
      })
      if (signal.aborted) return

      tokens = await enrichGeminiAntigravitySession(tokens)
      if (signal.aborted) return

      const riskAcceptedAt = providerSettings?.oauth?.riskAcceptedAt || Date.now()
      const authPatch = settingsPatchFromGeminiAntigravityTokens(tokens, { riskAcceptedAt })

      // Always replace Studio catalog after oauth login — Studio IDs 404 on cloudcode-pa
      let remoteModels: ProviderModelInfo[] | undefined
      try {
        if (tokens.projectId) {
          remoteModels = await fetchGeminiAntigravityModels(tokens.accessToken, tokens.projectId)
        }
      } catch (modelErr) {
        console.warn('[Gemini Antigravity] post-auth model list failed', modelErr)
      }
      const nextModels = resolveModelsAfterAntigravityLogin(remoteModels, providerSettings?.models)

      if (signal.aborted) return

      setProviderSettings({
        ...authPatch,
        models: nextModels,
      })
      setPhase('idle')
      setRedirectPaste('')
      setForcePasteMode(false)
      pkceRef.current = null
      addToast(
        remoteModels && remoteModels.length > 0
          ? t('Signed in to Google · {{count}} models loaded', { count: nextModels.length })
          : t('Signed in to Google · using Antigravity model list')
      )
    },
    [providerSettings?.models, providerSettings?.oauth?.riskAcceptedAt, setProviderSettings, t]
  )

  const handleModeChange = (value: string) => {
    if (value !== 'oauth' && value !== 'api_key') return
    cancelSignIn()
    if (value === 'oauth') {
      setProviderSettings(geminiAntigravityOAuthModePatch())
      return
    }
    setProviderSettings({ authMode: value as GeminiAuthMode })
  }

  const handleStartSignIn = async () => {
    if (!riskChecked && !riskAccepted) {
      setErrorMessage(t('You must acknowledge the experimental risk notice before signing in with Google.'))
      setPhase('error')
      return
    }

    cancelSignIn()
    const ac = new AbortController()
    abortRef.current = ac
    setPhase('starting')
    setErrorMessage(null)
    setRedirectPaste('')
    setForcePasteMode(false)

    try {
      const session = await startGeminiAntigravityPkceAuth()
      if (ac.signal.aborted) return
      pkceRef.current = session
      setPhase('waiting')

      // Desktop: start local listener BEFORE opening browser so redirect is captured
      if (desktopCallback) {
        const waitPromise = waitForLocalOAuthCallback({
          port: 51121,
          timeoutMs: 5 * 60 * 1000,
          signal: ac.signal,
        })

        try {
          await platform.openLink(session.authUrl)
        } catch {
          // User can open manually
        }

        let redirectUrl: string
        try {
          ;({ redirectUrl } = await waitPromise)
        } catch (waitErr) {
          if (ac.signal.aborted) return
          // Port busy / timeout → fall back to paste mode instead of hard fail
          const msg = waitErr instanceof Error ? waitErr.message : String(waitErr)
          if (/cancelled/i.test(msg)) return
          console.warn('[Gemini Antigravity] local callback failed, paste fallback', waitErr)
          setForcePasteMode(true)
          setErrorMessage(
            t(
              'Automatic callback failed ({{detail}}). Paste the full redirect URL from the browser address bar below.',
              { detail: msg }
            )
          )
          // Keep waiting phase so paste UI stays visible
          return
        }

        if (ac.signal.aborted) return
        try {
          await finishWithRedirectUrl(redirectUrl, session, ac.signal)
          return
        } catch (finishErr) {
          if (ac.signal.aborted) return
          const message =
            finishErr instanceof GeminiAntigravityOAuthError
              ? finishErr.message
              : finishErr instanceof Error
                ? humanizeGeminiAntigravityOAuthNetworkError(finishErr)
                : t('Sign-in failed. Please try again.')
          setErrorMessage(message)
          setPhase('error')
          return
        }
      }

      // Web / no desktop IPC: open browser + paste flow
      try {
        await platform.openLink(session.authUrl)
      } catch {
        // User can open manually
      }
      setForcePasteMode(true)
    } catch (err) {
      if (ac.signal.aborted) return
      const message =
        err instanceof GeminiAntigravityOAuthError
          ? err.message
          : err instanceof Error
            ? humanizeGeminiAntigravityOAuthNetworkError(err)
            : t('Sign-in failed. Please try again.')
      setErrorMessage(message)
      setPhase('error')
      pkceRef.current = null
    }
  }

  const handleCompleteSignIn = async () => {
    const session = pkceRef.current
    if (!session) {
      setErrorMessage(t('Start sign-in first, then paste the redirect URL.'))
      setPhase('error')
      return
    }

    const ac = new AbortController()
    abortRef.current = ac

    try {
      await finishWithRedirectUrl(redirectPaste, session, ac.signal)
    } catch (err) {
      if (ac.signal.aborted) return
      const message =
        err instanceof GeminiAntigravityOAuthError
          ? err.message
          : err instanceof Error
            ? humanizeGeminiAntigravityOAuthNetworkError(err)
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
    setProviderSettings(settingsPatchSignOutGeminiAntigravityOAuth())
    addToast(t('Signed out of Google'))
  }

  const [refreshingModels, setRefreshingModels] = useState(false)
  const handleRefreshModels = async () => {
    if (!providerSettings?.oauth?.accessToken && !providerSettings?.oauth?.refreshToken) {
      addToast(t('Sign in first to refresh models'))
      return
    }
    setRefreshingModels(true)
    try {
      // Refresh expired Google tokens before catalog fetch.
      const {
        bearer,
        projectId: ensuredProjectId,
        settingsPatch,
      } = await ensureGeminiAntigravityBearer(providerSettings)
      if (settingsPatch) {
        setProviderSettings(settingsPatch)
      }
      const projectId = ensuredProjectId || providerSettings?.oauth?.projectId
      let remoteModels: ProviderModelInfo[] | undefined
      if (projectId) {
        remoteModels = await fetchGeminiAntigravityModels(bearer, projectId)
      }
      const nextModels = withInferredImageCapabilitiesList(
        resolveModelsAfterAntigravityLogin(remoteModels, providerSettings?.models)
      )
      setProviderSettings({
        ...(settingsPatch || {}),
        models: nextModels,
      })
      addToast(
        remoteModels && remoteModels.length > 0
          ? t('Refreshed {{count}} models', { count: nextModels.length })
          : t('Using Antigravity model list')
      )
    } catch (err) {
      console.warn('[Gemini Antigravity] manual model refresh failed', err)
      const message =
        err instanceof GeminiAntigravityOAuthError
          ? err.message
          : err instanceof Error
            ? humanizeGeminiAntigravityOAuthNetworkError(err)
            : t('Failed to refresh models')
      addToast(message)
    } finally {
      setRefreshingModels(false)
    }
  }

  const handleOpenAgain = () => {
    if (pkceRef.current?.authUrl) {
      void platform.openLink(pkceRef.current.authUrl)
    }
  }

  const showPasteUi =
    phase === 'waiting' || phase === 'exchanging' || phase === 'starting' || (phase === 'error' && forcePasteMode)

  const signedInLabel = signedIn
    ? email
      ? planType
        ? t('Signed in as {{email}} ({{plan}})', { email, plan: planType })
        : t('Signed in as {{email}}', { email })
      : planType
        ? t('Signed in ({{plan}})', { plan: planType })
        : t('Signed in')
    : t('Not signed in')

  return (
    <div className="settings-card-fields">
      {!hideModeSwitch && (
        <SettingsPrefRow
          title={t('How do you connect?')}
          description={
            authMode === 'oauth'
              ? desktopCallback
                ? t(
                    'Google OAuth (PKCE). Approve in the browser — Dango finishes via localhost. Quota is separate from AI Studio API keys.'
                  )
                : t(
                    'Google OAuth (PKCE). After the browser opens, paste the full redirect URL from the address bar. Quota is separate from AI Studio API keys.'
                  )
              : t('API keys from Google AI Studio are billed separately from Google AI / Antigravity quotas.')
          }
          align="start"
          control={
            <SegmentedControl
              className="settings-segmented"
              value={authMode}
              onChange={handleModeChange}
              data={[
                { label: t('Google'), value: 'oauth' },
                { label: t('API Key'), value: 'api_key' },
              ]}
            />
          }
        />
      )}

      {authMode === 'oauth' && (
        <>
          <SettingsCallout title={t('Experimental · account risk')} tone="warning">
            <Text size="sm" c="inherit" component="div">
              {t(
                'Sign in with Google uses the unofficial Antigravity / Cloud Code Assist path (similar to some TUIs). It is not an official Google product integration. Your Google account may be restricted or banned. Prefer an AI Studio API key for production use.'
              )}
            </Text>
            {!signedIn && (
              <Checkbox
                mt="sm"
                checked={riskChecked || riskAccepted}
                onChange={(e) => setRiskChecked(e.currentTarget.checked)}
                label={t('I understand the risk and want to continue')}
              />
            )}
          </SettingsCallout>

          <SettingsPrefRow
            title={t('Account')}
            description={!signedIn ? t('Not signed in') : undefined}
            align="start"
            control={
              <div className="settings-actions">
                {signedIn ? (
                  <>
                    <span className="settings-status-pill settings-status-pill-ok" title={signedInLabel}>
                      {email
                        ? planType
                          ? `${email} · ${planType}`
                          : email
                        : planType
                          ? t('Signed in ({{plan}})', { plan: planType })
                          : t('Signed in')}
                    </span>
                    <Button
                      variant="default"
                      size="compact-sm"
                      leftSection={<ScalableIcon icon={IconLogout} size={14} />}
                      onClick={handleSignOut}
                    >
                      {t('Sign out')}
                    </Button>
                    <Button variant="subtle" size="compact-sm" onClick={() => void handleStartSignIn()}>
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
                  <Button
                    size="sm"
                    loading={phase === 'starting' || phase === 'exchanging'}
                    disabled={phase === 'waiting'}
                    onClick={() => void handleStartSignIn()}
                  >
                    {t('Sign in with Google')}
                  </Button>
                )}
              </div>
            }
          />

          {showPasteUi && (
            <div className="settings-device-code-panel">
              <Flex gap="xs" align="center">
                <Loader size="sm" />
                <Text size="sm" fw={600}>
                  {phase === 'exchanging'
                    ? t('Completing sign-in…')
                    : desktopCallback && !forcePasteMode
                      ? t('Waiting for Google in the browser…')
                      : t('Complete Google sign-in in the browser, then paste the redirect URL')}
                </Text>
              </Flex>

              {desktopCallback && !forcePasteMode && phase === 'waiting' && (
                <Text size="sm" c="chatbox-tertiary">
                  {t(
                    'Approve access in the browser. This window will finish automatically when Google redirects to {{uri}}.',
                    { uri: GEMINI_ANTIGRAVITY_REDIRECT_URI }
                  )}
                </Text>
              )}

              {(forcePasteMode || !desktopCallback) && (
                <>
                  <Textarea
                    label={t('Redirect URL')}
                    placeholder="http://localhost:51121/oauth-callback?code=...&state=..."
                    value={redirectPaste}
                    onChange={(e) => setRedirectPaste(e.currentTarget.value)}
                    minRows={2}
                    autosize
                  />
                  <div className="settings-actions">
                    <Button
                      size="sm"
                      disabled={!redirectPaste.trim() || phase === 'exchanging'}
                      loading={phase === 'exchanging'}
                      onClick={() => void handleCompleteSignIn()}
                    >
                      {t('Complete sign-in')}
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      leftSection={<ScalableIcon icon={IconExternalLink} size={16} />}
                      onClick={handleOpenAgain}
                    >
                      {t('Open login page')}
                    </Button>
                    <Button variant="subtle" size="sm" onClick={cancelSignIn}>
                      {t('Cancel')}
                    </Button>
                  </div>
                  <Text size="xs" c="chatbox-tertiary">
                    {t(
                      'If the browser shows a connection error on localhost, copy the full URL from the address bar anyway — it still contains the code.'
                    )}
                  </Text>
                </>
              )}

              {desktopCallback && !forcePasteMode && (
                <div className="settings-actions">
                  <Button
                    variant="default"
                    size="sm"
                    leftSection={<ScalableIcon icon={IconExternalLink} size={16} />}
                    onClick={handleOpenAgain}
                  >
                    {t('Open login page')}
                  </Button>
                  <Button variant="subtle" size="sm" onClick={cancelSignIn}>
                    {t('Cancel')}
                  </Button>
                  <Button
                    variant="subtle"
                    size="sm"
                    onClick={() => {
                      setForcePasteMode(true)
                      setErrorMessage(null)
                    }}
                  >
                    {t('Paste URL instead')}
                  </Button>
                </div>
              )}
            </div>
          )}

          {phase === 'error' && errorMessage && (
            <Alert color="red" title={t('Sign-in failed')} radius="md">
              <Stack gap="xs">
                <Text size="sm">{errorMessage}</Text>
                <Button size="compact-sm" className="self-start" onClick={() => void handleStartSignIn()}>
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
              onClick={() => platform.openLink('https://antigravity.google/')}
            >
              {t('Antigravity')}
            </Button>
            <Button
              variant="subtle"
              size="compact-xs"
              leftSection={<ScalableIcon icon={IconExternalLink} size={14} />}
              onClick={() => platform.openLink('https://aistudio.google.com/apikey')}
            >
              {t('AI Studio API keys')}
            </Button>
          </div>
        </>
      )}

      {authMode === 'api_key' && (
        <SettingsCallout title={t('Developer API')} tone="warning">
          <Text size="sm" c="inherit" component="div">
            {t(
              'API keys from Google AI Studio are billed separately from Google AI / Antigravity quotas. Switch to Google sign-in (experimental) to try subscription-style access.'
            )}
          </Text>
          <Button
            mt="xs"
            variant="default"
            size="compact-sm"
            leftSection={<ScalableIcon icon={IconExternalLink} size={14} />}
            onClick={() => platform.openLink('https://aistudio.google.com/apikey')}
          >
            {t('Get API Key')}
          </Button>
        </SettingsCallout>
      )}
    </div>
  )
}
