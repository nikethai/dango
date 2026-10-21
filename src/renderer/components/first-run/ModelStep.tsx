import { NativeSelect, PasswordInput } from '@mantine/core'
import { hasProviderCredentials } from '@shared/providers/provider-credentials'
import { ModelProviderEnum, type ProviderSettings } from '@shared/types'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FirstRunCard } from '@/components/first-run/FirstRunCard'
import {
  GeminiAntigravityAuthSection,
  geminiAntigravityOAuthModePatch,
} from '@/components/settings/GeminiAntigravityAuthSection'
import { OpenAICodexAuthSection, openAICodexOAuthModePatch } from '@/components/settings/OpenAICodexAuthSection'
import { navigateToSettings } from '@/modals/Settings'
import { apiKeyPatch, checkProviderKey, firstModelId, withProviderPatch } from '@/packages/first-run/checkProviderKey'
import { setFirstRun, stepAfterModel } from '@/packages/first-run/firstRun'
import { router } from '@/router'
import { needEditSetting } from '@/stores/settingActions'
import { settingsStore, useProviderSettings, useSettingsStore } from '@/stores/settingsStore'

type Choice = 'google' | 'chatgpt' | 'key'

const CHOICES: { id: Choice; title: string; line: string }[] = [
  { id: 'google', title: 'Continue with Google', line: 'Gemini. Google receives your questions when you ask them.' },
  {
    id: 'chatgpt',
    title: 'Continue with ChatGPT',
    line: 'Codex models. OpenAI receives your questions when you ask them.',
  },
  { id: 'key', title: 'I have a key', line: 'OpenAI, Anthropic, Gemini, OpenRouter, Ollama and more.' },
]

const KEY_PROVIDERS: { id: string; name: string }[] = [
  { id: ModelProviderEnum.OpenAI, name: 'OpenAI' },
  { id: ModelProviderEnum.Claude, name: 'Anthropic' },
  { id: ModelProviderEnum.Gemini, name: 'Gemini' },
  { id: ModelProviderEnum.OpenRouter, name: 'OpenRouter' },
]

type KeyStatus = 'idle' | 'checking' | 'rejected' | 'unreachable'

type Seeded = Record<
  string,
  { snapshot: Pick<ProviderSettings, 'authMode' | 'models'>; restore: (patch: Partial<ProviderSettings>) => void }
>

/** Puts back what a ChatGPT or Google seed overwrote, unless that provider has signed in since. */
function restoreSeed(seeded: Seeded, providerId: string) {
  const entry = seeded[providerId]
  if (!entry) return
  delete seeded[providerId]
  if (hasProviderCredentials(settingsStore.getState().providers?.[providerId])) return
  entry.restore(entry.snapshot)
}

/**
 * FR1, step 1: sign in with Google or ChatGPT, or enter a key. A key is checked on a settings copy (one basic request)
 * and saved only when it works. With `modelOnly` (every model was removed after first run) the step returns to
 * `from` instead of moving to step 2.
 */
export function ModelStep({ modelOnly, from }: { modelOnly: boolean; from?: string }) {
  const { t } = useTranslation()
  const [choice, setChoice] = useState<Choice | null>(null)
  const [keyProvider, setKeyProvider] = useState<string>(ModelProviderEnum.OpenAI)
  const [apiKey, setApiKey] = useState('')
  const [status, setStatus] = useState<KeyStatus>('idle')
  const keyFieldRef = useRef<HTMLInputElement>(null)
  const continueRef = useRef<HTMLButtonElement>(null)
  const radioRefs = useRef<(HTMLButtonElement | null)[]>([])
  const checkRun = useRef(0)

  const openai = useProviderSettings(ModelProviderEnum.OpenAI)
  const gemini = useProviderSettings(ModelProviderEnum.Gemini)
  const keyed = useProviderSettings(keyProvider)
  const signedIn = useSettingsStore(() => !needEditSetting())
  const providerName = KEY_PROVIDERS.find((p) => p.id === keyProvider)?.name ?? keyProvider

  /** A model now exists: default to the provider's first model if none is set, then leave step 1. */
  const finish = (providerId: string, providerSettings: ProviderSettings | undefined) => {
    const state = settingsStore.getState()
    const model = firstModelId(providerId, providerSettings)
    // Step 1 shows only while no provider has credentials, so a default on another provider is stale (modelOnly).
    const current = state.defaultChatModel
    const usable =
      current && (current.provider === providerId || hasProviderCredentials(state.providers?.[current.provider]))
    if (!usable && model) state.setSettings({ defaultChatModel: { provider: providerId, model } })
    if (modelOnly) void router.navigate({ href: from ?? '/', replace: true })
    else setFirstRun({ step: stepAfterModel(state.firstRun) })
  }

  /** The auth section's setter: a sign-in that just completed finishes the step at once. */
  const oauthSetter =
    (providerId: string, { providerSettings, setProviderSettings }: ReturnType<typeof useProviderSettings>) =>
    (patch: Partial<ProviderSettings>) => {
      setProviderSettings(patch)
      if (!hasProviderCredentials(providerSettings) && patch.oauth?.accessToken) {
        finish(providerId, { ...providerSettings, ...patch })
      }
    }

  // What picking ChatGPT or Google overwrote, so leaving that choice unsigned (another choice, or the step closing)
  // puts the provider back as it was.
  const seeded = useRef<Seeded>({})

  useEffect(() => {
    const pending = seeded.current
    return () => {
      for (const providerId of Object.keys(pending)) restoreSeed(pending, providerId)
    }
  }, [])

  const seed = (
    providerId: string,
    { providerSettings, setProviderSettings }: ReturnType<typeof useProviderSettings>,
    patch: Partial<ProviderSettings>
  ) => {
    seeded.current[providerId] ??= {
      snapshot: { authMode: providerSettings?.authMode, models: providerSettings?.models },
      restore: setProviderSettings,
    }
    setProviderSettings(patch)
  }

  const restoreSeeded = (providerId: string) => restoreSeed(seeded.current, providerId)

  const select = (next: Choice) => {
    if (next === choice) return
    checkRun.current++
    setChoice(next)
    setStatus('idle')
    if (choice === 'chatgpt') restoreSeeded(ModelProviderEnum.OpenAI)
    if (choice === 'google') restoreSeeded(ModelProviderEnum.Gemini)
    if (next === 'chatgpt') seed(ModelProviderEnum.OpenAI, openai, openAICodexOAuthModePatch(openai.providerSettings))
    if (next === 'google') seed(ModelProviderEnum.Gemini, gemini, geminiAntigravityOAuthModePatch())
  }

  const onRadioKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0
    if (step !== 0) {
      event.preventDefault()
      radioRefs.current[(index + step + CHOICES.length) % CHOICES.length]?.focus()
      return
    }
    if (event.key === ' ') {
      event.preventDefault()
      select(CHOICES[index].id)
    }
  }

  const checkKey = async () => {
    const key = apiKey.trim()
    if (!key) return
    const providerId = keyProvider
    const patch = apiKeyPatch(providerId, keyed.providerSettings, key)
    const candidate = withProviderPatch(settingsStore.getState(), providerId, patch)
    const candidateProvider = candidate.providers?.[providerId]
    const modelId = firstModelId(providerId, candidateProvider)
    if (!modelId) {
      setStatus('unreachable')
      return
    }
    const run = ++checkRun.current
    setStatus('checking')
    const result = await checkProviderKey(providerId, modelId, candidate)
    if (run !== checkRun.current) return
    if (result !== 'ok') {
      setStatus(result)
      return
    }
    setStatus('idle')
    keyed.setProviderSettings(patch)
    finish(providerId, candidateProvider)
  }

  const onContinue = () => {
    if (checking) return
    if (choice === 'key') void checkKey()
    else if (choice === 'chatgpt') finish(ModelProviderEnum.OpenAI, openai.providerSettings)
    else if (choice === 'google') finish(ModelProviderEnum.Gemini, gemini.providerSettings)
  }

  // While checking, Continue stays focusable (aria-disabled, not disabled) so focus never drops to the body.
  const checking = status === 'checking'
  const continueDisabled = choice === null || (choice === 'key' ? !apiKey.trim() : !signedIn)
  const focusIndex = Math.max(
    0,
    CHOICES.findIndex((c) => c.id === choice)
  )

  return (
    <FirstRunCard
      step={1}
      title={t('Sign in to a model')}
      lead={t('Dango uses providers you already have. Nothing is sent anywhere until you ask a question.')}
      footer={
        <button
          type="button"
          className="dg-btn dg-btn--primary"
          ref={continueRef}
          disabled={continueDisabled}
          aria-disabled={checking || undefined}
          aria-busy={checking || undefined}
          onClick={onContinue}
        >
          {t('Continue')}
        </button>
      }
    >
      <div role="radiogroup" aria-label={t('Sign in to a model')} className="dg-first-run__choices">
        {CHOICES.map((c, index) => (
          <button
            key={c.id}
            ref={(el) => {
              radioRefs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={choice === c.id}
            tabIndex={index === focusIndex ? 0 : -1}
            className="dg-first-run__choice"
            onClick={() => select(c.id)}
            onKeyDown={(event) => onRadioKeyDown(event, index)}
          >
            <span className="dg-type-body dg-first-run__choice-title">{t(c.title)}</span>
            <span className="dg-type-caption dg-first-run__choice-line">{t(c.line)}</span>
          </button>
        ))}
      </div>

      {choice === 'google' ? (
        <div className="dg-first-run__panel">
          <GeminiAntigravityAuthSection
            providerSettings={gemini.providerSettings}
            setProviderSettings={oauthSetter(ModelProviderEnum.Gemini, gemini)}
            hideModeSwitch
          />
        </div>
      ) : null}

      {choice === 'chatgpt' ? (
        <div className="dg-first-run__panel">
          <OpenAICodexAuthSection
            providerSettings={openai.providerSettings}
            setProviderSettings={oauthSetter(ModelProviderEnum.OpenAI, openai)}
            hideModeSwitch
          />
        </div>
      ) : null}

      {choice === 'key' ? (
        <div className="dg-first-run__panel">
          <NativeSelect
            label={t('Provider')}
            value={keyProvider}
            data={KEY_PROVIDERS.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(event) => {
              setKeyProvider(event.currentTarget.value)
              setStatus('idle')
              checkRun.current++
            }}
          />
          <PasswordInput
            ref={keyFieldRef}
            label={t('API key')}
            value={apiKey}
            autoComplete="off"
            onChange={(event) => {
              setApiKey(event.currentTarget.value)
              setStatus('idle')
              checkRun.current++
            }}
          />
          {status === 'rejected' ? (
            <div role="alert" className="dg-first-run__error">
              <span className="dg-type-body">
                {t('Your {{provider}} key was rejected.', { provider: providerName })}
              </span>
              <button type="button" className="dg-btn" onClick={() => keyFieldRef.current?.focus()}>
                {t('Update key')}
              </button>
            </div>
          ) : null}
          {status === 'unreachable' ? (
            <div role="alert" className="dg-first-run__error">
              <span className="dg-type-body">
                {t('Dango could not reach {{provider}}.', { provider: providerName })}
              </span>
              <button
                type="button"
                className="dg-btn"
                onClick={() => {
                  // The alert (and this button) goes away while checking; keep focus on Continue.
                  continueRef.current?.focus()
                  void checkKey()
                }}
              >
                {t('Try again')}
              </button>
            </div>
          ) : null}
          <button type="button" className="dg-link dg-first-run__other" onClick={() => navigateToSettings('/provider')}>
            {t('Ollama and other providers')}
          </button>
        </div>
      ) : null}
    </FirstRunCard>
  )
}
