import { Button, Flex, PasswordInput, Select, Switch, Text, TextInput } from '@mantine/core'
import { createFileRoute } from '@tanstack/react-router'
import { ofetch } from 'ofetch'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsPrefRow } from '@/components/settings/SettingsPrefRow'
import { SettingsSection } from '@/components/settings/SettingsSection'
import platform from '@/platform'
import { useSettingsStore } from '@/stores/settingsStore'

export const Route = createFileRoute('/settings/web-search')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const setSettings = useSettingsStore((state) => state.setSettings)
  const extension = useSettingsStore((state) => state.extension)

  const [checkingTavily, setCheckingTavily] = useState(false)
  const [tavilyAvaliable, setTavilyAvaliable] = useState<boolean>()
  const [checkingSerper, setCheckingSerper] = useState(false)
  const [serperAvaliable, setSerperAvaliable] = useState<boolean>()
  const [checkingGoogle, setCheckingGoogle] = useState(false)
  const [googleAvaliable, setGoogleAvaliable] = useState<boolean>()
  const [checkingExa, setCheckingExa] = useState(false)
  const [exaAvailable, setExaAvailable] = useState<boolean>()

  const checkSerper = async () => {
    if (extension.webSearch.serperApiKey?.trim()) {
      setCheckingSerper(true)
      setSerperAvaliable(undefined)
      try {
        await ofetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-API-KEY': extension.webSearch.serperApiKey.trim(),
          },
          body: {
            q: 'Dango',
            num: 1,
          },
        })
        setSerperAvaliable(true)
      } catch (_e) {
        setSerperAvaliable(false)
      } finally {
        setCheckingSerper(false)
      }
    }
  }

  const checkGoogle = async () => {
    if (extension.webSearch.googleApiKey?.trim() && extension.webSearch.googleCseId?.trim()) {
      setCheckingGoogle(true)
      setGoogleAvaliable(undefined)
      try {
        await ofetch('https://customsearch.googleapis.com/customsearch/v1', {
          method: 'GET',
          query: {
            q: 'Dango',
            key: extension.webSearch.googleApiKey.trim(),
            cx: extension.webSearch.googleCseId.trim(),
            num: 1,
          },
        })
        setGoogleAvaliable(true)
      } catch (_e) {
        setGoogleAvaliable(false)
      } finally {
        setCheckingGoogle(false)
      }
    }
  }

  const checkTavily = async () => {
    if (extension.webSearch.tavilyApiKey?.trim()) {
      setCheckingTavily(true)
      setTavilyAvaliable(undefined)
      try {
        await ofetch('https://api.tavily.com/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${extension.webSearch.tavilyApiKey.trim()}`,
          },
          body: {
            query: 'Dango',
            search_depth: 'basic',
            include_domains: [],
            exclude_domains: [],
          },
        })
        setTavilyAvaliable(true)
      } catch (_e) {
        setTavilyAvaliable(false)
      } finally {
        setCheckingTavily(false)
      }
    }
  }

  const checkExa = async () => {
    if (extension.webSearch.exaApiKey?.trim()) {
      setCheckingExa(true)
      setExaAvailable(undefined)
      try {
        await ofetch('https://api.exa.ai/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': extension.webSearch.exaApiKey.trim(),
          },
          body: {
            query: 'Dango',
            type: 'neural',
            useAutoprompt: true,
            numResults: 1,
            contents: {
              text: {
                maxCharacters: 200,
              },
            },
          },
        })
        setExaAvailable(true)
      } catch (_e) {
        setExaAvailable(false)
      } finally {
        setCheckingExa(false)
      }
    }
  }

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t('Web search providers')}
        description={t('Choose how the assistant looks up live information on the web.')}
      />

      <SettingsSection title={t('Provider')}>
        <SettingsCard divided>
          <SettingsPrefRow
            title={t('Search Provider')}
            description={
              extension.webSearch.provider === 'bing'
                ? t(
                    'Bing Search is provided for free use, but it may have limitations and is subject to change by Microsoft.'
                  )
                : extension.webSearch.provider === 'duckduckgo'
                  ? t('DuckDuckGo Search is provided for free use and may be rate-limited in some regions.')
                  : undefined
            }
            align="start"
            control={
              <AdaptiveSelect
                comboboxProps={{ withinPortal: true, withArrow: true }}
                data={[
                  { value: 'bing', label: 'Bing search (free)' },
                  { value: 'duckduckgo', label: 'DuckDuckGo Search (Free)' },
                  { value: 'serper', label: 'Serper (Google Search API)' },
                  { value: 'google', label: 'Google Custom Search API' },
                  { value: 'tavily', label: 'Tavily' },
                  { value: 'exa', label: 'Exa' },
                ]}
                value={extension.webSearch.provider === 'build-in' ? 'bing' : extension.webSearch.provider}
                onChange={(e) =>
                  e &&
                  setSettings({
                    extension: {
                      ...extension,
                      webSearch: {
                        ...extension.webSearch,
                        provider: e as 'build-in' | 'bing' | 'duckduckgo' | 'serper' | 'google' | 'tavily' | 'exa',
                      },
                    },
                  })
                }
                maw={220}
              />
            }
          />
          <SettingsPrefRow
            title={t('Use Google Grounding when Gemini models are selected')}
            control={
              <Switch
                checked={extension.webSearch.useGoogleGroundingForGemini !== false}
                onChange={(event) =>
                  setSettings({
                    extension: {
                      ...extension,
                      webSearch: {
                        ...extension.webSearch,
                        useGoogleGroundingForGemini: event.currentTarget.checked,
                      },
                    },
                  })
                }
              />
            }
          />
          <SettingsPrefRow
            title={t('Scrape top results for deeper context')}
            control={
              <Switch
                checked={extension.webSearch.scrapeTopResults || false}
                onChange={(event) =>
                  setSettings({
                    extension: {
                      ...extension,
                      webSearch: {
                        ...extension.webSearch,
                        scrapeTopResults: event.currentTarget.checked,
                      },
                    },
                  })
                }
              />
            }
          />
        </SettingsCard>
      </SettingsSection>

      {extension.webSearch.provider === 'exa' && (
        <SettingsSection
          title={t('Exa API Key')}
          description={t('Exa uses neural search with autoprompting for semantically relevant results.')}
        >
          <SettingsCard>
            <div className="settings-card-fields">
              <Flex align="center" gap="xs">
                <PasswordInput
                  flex={1}
                  maw={320}
                  value={extension.webSearch.exaApiKey}
                  onChange={(e) => {
                    setExaAvailable(undefined)
                    setSettings({
                      extension: {
                        ...extension,
                        webSearch: {
                          ...extension.webSearch,
                          exaApiKey: e.currentTarget.value,
                        },
                      },
                    })
                  }}
                  error={exaAvailable === false}
                />
                <Button
                  color="blue"
                  variant="light"
                  onClick={checkExa}
                  loading={checkingExa}
                  disabled={!extension.webSearch.exaApiKey?.trim()}
                >
                  {t('Check')}
                </Button>
              </Flex>
              {typeof exaAvailable === 'boolean' ? (
                exaAvailable ? (
                  <Text size="xs" c="chatbox-success">
                    {t('Connection successful!')}
                  </Text>
                ) : (
                  <Text size="xs" c="chatbox-error">
                    {t('API key invalid!')}
                  </Text>
                )
              ) : null}
              <Button
                variant="transparent"
                size="compact-xs"
                px={0}
                className="self-start"
                onClick={() => platform.openLink('https://dashboard.exa.ai/api-keys')}
              >
                {t('Get API Key')}
              </Button>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      {extension.webSearch.provider === 'serper' && (
        <SettingsSection title={t('Serper API Key')}>
          <SettingsCard>
            <div className="settings-card-fields">
              <Flex align="center" gap="xs">
                <PasswordInput
                  flex={1}
                  maw={320}
                  value={extension.webSearch.serperApiKey}
                  onChange={(e) => {
                    setSerperAvaliable(undefined)
                    setSettings({
                      extension: {
                        ...extension,
                        webSearch: {
                          ...extension.webSearch,
                          serperApiKey: e.currentTarget.value,
                        },
                      },
                    })
                  }}
                  error={serperAvaliable === false}
                />
                <Button
                  color="blue"
                  variant="light"
                  onClick={checkSerper}
                  loading={checkingSerper}
                  disabled={!extension.webSearch.serperApiKey?.trim()}
                >
                  {t('Check')}
                </Button>
              </Flex>
              {typeof serperAvaliable === 'boolean' ? (
                serperAvaliable ? (
                  <Text size="xs" c="chatbox-success">
                    {t('Connection successful!')}
                  </Text>
                ) : (
                  <Text size="xs" c="chatbox-error">
                    {t('API key invalid!')}
                  </Text>
                )
              ) : null}
              <Button
                variant="transparent"
                size="compact-xs"
                px={0}
                className="self-start"
                onClick={() => platform.openLink('https://serper.dev')}
              >
                {t('Get API Key')}
              </Button>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      {extension.webSearch.provider === 'google' && (
        <SettingsSection title={t('Google Custom Search')}>
          <SettingsCard>
            <div className="settings-card-fields">
              <div className="settings-field">
                <span className="settings-field-label">{t('Google API Key')}</span>
                <PasswordInput
                  maw={320}
                  value={extension.webSearch.googleApiKey}
                  onChange={(e) => {
                    setGoogleAvaliable(undefined)
                    setSettings({
                      extension: {
                        ...extension,
                        webSearch: {
                          ...extension.webSearch,
                          googleApiKey: e.currentTarget.value,
                        },
                      },
                    })
                  }}
                  error={googleAvaliable === false}
                />
              </div>
              <div className="settings-field">
                <span className="settings-field-label">{t('Search Engine ID (cx)')}</span>
                <Flex align="center" gap="xs">
                  <TextInput
                    flex={1}
                    maw={320}
                    value={extension.webSearch.googleCseId}
                    onChange={(e) => {
                      setGoogleAvaliable(undefined)
                      setSettings({
                        extension: {
                          ...extension,
                          webSearch: {
                            ...extension.webSearch,
                            googleCseId: e.currentTarget.value,
                          },
                        },
                      })
                    }}
                    error={googleAvaliable === false}
                  />
                  <Button
                    color="blue"
                    variant="light"
                    onClick={checkGoogle}
                    loading={checkingGoogle}
                    disabled={!extension.webSearch.googleApiKey?.trim() || !extension.webSearch.googleCseId?.trim()}
                  >
                    {t('Check')}
                  </Button>
                </Flex>
              </div>
              {typeof googleAvaliable === 'boolean' ? (
                googleAvaliable ? (
                  <Text size="xs" c="chatbox-success">
                    {t('Connection successful!')}
                  </Text>
                ) : (
                  <Text size="xs" c="chatbox-error">
                    {t('Credentials invalid!')}
                  </Text>
                )
              ) : null}
              <div className="settings-actions">
                <Button
                  variant="transparent"
                  size="compact-xs"
                  px={0}
                  onClick={() =>
                    platform.openLink('https://console.cloud.google.com/apis/library/customsearch.googleapis.com')
                  }
                >
                  {t('Enable API')}
                </Button>
                <Button
                  variant="transparent"
                  size="compact-xs"
                  px={0}
                  onClick={() => platform.openLink('https://programmablesearchengine.google.com/about/')}
                >
                  {t('Create Search Engine')}
                </Button>
              </div>
            </div>
          </SettingsCard>
        </SettingsSection>
      )}

      {extension.webSearch.provider === 'tavily' && (
        <SettingsSection title={t('Tavily')}>
          <SettingsCard>
            <div className="settings-card-fields">
              <div className="settings-field">
                <span className="settings-field-label">{t('Tavily API Key')}</span>
                <Flex align="center" gap="xs">
                  <PasswordInput
                    flex={1}
                    maw={320}
                    value={extension.webSearch.tavilyApiKey}
                    onChange={(e) => {
                      setTavilyAvaliable(undefined)
                      setSettings({
                        extension: {
                          ...extension,
                          webSearch: {
                            ...extension.webSearch,
                            tavilyApiKey: e.currentTarget.value,
                          },
                        },
                      })
                    }}
                    error={tavilyAvaliable === false}
                  />
                  <Button
                    color="blue"
                    variant="light"
                    onClick={checkTavily}
                    loading={checkingTavily}
                    disabled={!extension.webSearch.tavilyApiKey?.trim()}
                  >
                    {t('Check')}
                  </Button>
                </Flex>
                {typeof tavilyAvaliable === 'boolean' ? (
                  tavilyAvaliable ? (
                    <Text size="xs" c="chatbox-success">
                      {t('Connection successful!')}
                    </Text>
                  ) : (
                    <Text size="xs" c="chatbox-error">
                      {t('API key invalid!')}
                    </Text>
                  )
                ) : null}
                <Button
                  variant="transparent"
                  size="compact-xs"
                  px={0}
                  className="self-start"
                  onClick={() => platform.openLink('https://app.tavily.com?utm_source=chatbox')}
                >
                  {t('Get API Key')}
                </Button>
              </div>

              <SettingsPrefRow
                title={t('Search Depth')}
                description={t(
                  'The depth of the search. advanced search is tailored to retrieve the most relevant sources and content snippets for your query, while basic search provides generic content snippets from each source. Using "advanced" costs 2 credits per query.'
                )}
                align="start"
                control={
                  <Select
                    comboboxProps={{ withinPortal: true, withArrow: true }}
                    data={[
                      { value: 'basic', label: 'Basic' },
                      { value: 'advanced', label: 'Advanced' },
                    ]}
                    value={extension.webSearch.tavilySearchDepth || 'basic'}
                    onChange={(e) =>
                      e &&
                      setSettings({
                        extension: {
                          ...extension,
                          webSearch: {
                            ...extension.webSearch,
                            tavilySearchDepth: e,
                          },
                        },
                      })
                    }
                    maw={160}
                  />
                }
              />
              <SettingsPrefRow
                title={t('Max Results')}
                control={
                  <Select
                    comboboxProps={{ withinPortal: true, withArrow: true }}
                    data={['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].map((v) => ({ value: v, label: v }))}
                    value={String(extension.webSearch.tavilyMaxResults || 5)}
                    onChange={(e) =>
                      e &&
                      setSettings({
                        extension: {
                          ...extension,
                          webSearch: {
                            ...extension.webSearch,
                            tavilyMaxResults: parseInt(e),
                          },
                        },
                      })
                    }
                    maw={100}
                  />
                }
              />
              <SettingsPrefRow
                title={t('Time Range')}
                control={
                  <Select
                    comboboxProps={{ withinPortal: true, withArrow: true }}
                    data={[
                      { value: 'none', label: 'None' },
                      { value: 'day', label: 'Day' },
                      { value: 'week', label: 'Week' },
                      { value: 'month', label: 'Month' },
                      { value: 'year', label: 'Year' },
                    ]}
                    value={extension.webSearch.tavilyTimeRange || 'none'}
                    onChange={(e) =>
                      e &&
                      setSettings({
                        extension: {
                          ...extension,
                          webSearch: {
                            ...extension.webSearch,
                            tavilyTimeRange: e,
                          },
                        },
                      })
                    }
                    maw={140}
                  />
                }
              />
              <SettingsPrefRow
                title={t('Include Raw Content')}
                control={
                  <Select
                    comboboxProps={{ withinPortal: true, withArrow: true }}
                    data={[
                      { value: 'none', label: 'None' },
                      { value: 'text', label: 'Text' },
                      { value: 'markdown', label: 'Markdown' },
                    ]}
                    value={extension.webSearch.tavilyIncludeRawContent || 'none'}
                    onChange={(e) =>
                      e &&
                      setSettings({
                        extension: {
                          ...extension,
                          webSearch: {
                            ...extension.webSearch,
                            tavilyIncludeRawContent: e,
                          },
                        },
                      })
                    }
                    maw={140}
                  />
                }
              />
            </div>
          </SettingsCard>
        </SettingsSection>
      )}
    </SettingsPage>
  )
}
