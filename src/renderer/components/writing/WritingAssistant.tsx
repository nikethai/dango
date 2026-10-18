import { Alert, Button, Group, Select, Stack, Text, Textarea } from '@mantine/core'
import {
  MAX_WRITING_INPUT_CHARS,
  type WritingErrorCode,
  type WritingModel,
  type WritingStyle,
} from '@shared/types/writing'
import { IconCheck, IconCopy, IconPencil, IconPlayerStop, IconRefresh } from '@tabler/icons-react'
import copyToClipboard from 'copy-to-clipboard'
import { useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useProviders } from '@/hooks/useProviders'
import { getWritingModelOptions, useWritingRewrite } from '@/packages/writing'
import { saveWritingResult } from '@/packages/writing/save'
import { lastUsedModelStore } from '@/stores/lastUsedModelStore'

const ERROR_MESSAGES: Record<WritingErrorCode, string> = {
  invalid_input: 'Enter a draft of up to 8,000 characters and choose a model.',
  unsupported_model: 'Choose an available text model. Remote agents and non-text models are not available for writing.',
  request_failed: 'The rewrite failed. Check your provider connection and try again. Your draft is unchanged.',
  incomplete: 'The model did not return a complete rewrite. Try again or choose another model.',
  timeout: 'The rewrite took too long and was stopped. Try again or choose another model.',
}

export type WritingAssistantProps = {
  initialDraft?: string
  initialModel?: WritingModel
  onConfigureProvider: () => void
}

export default function WritingAssistant({
  initialDraft = '',
  initialModel,
  onConfigureProvider,
}: WritingAssistantProps) {
  const { t } = useTranslation()
  const { providers } = useProviders()
  const options = useMemo(() => getWritingModelOptions(providers), [providers])
  const [draft, setDraft] = useState(initialDraft)
  const [style, setStyle] = useState<WritingStyle>('clearer')
  const [selectedValue, setSelectedValue] = useState<string | null>(() => {
    const model = initialModel || lastUsedModelStore.getState().chat
    return model ? JSON.stringify({ provider: model.provider, modelId: model.modelId }) : null
  })
  const selectedOption = options.flatMap((group) => group.items).find((item) => item.value === selectedValue)
  const selectedModel: WritingModel | undefined = selectedOption ? JSON.parse(selectedOption.value) : undefined
  const providerName = providers.find((provider) => provider.id === selectedModel?.provider)?.name
  const { state, rewrite, reset, cancel } = useWritingRewrite()
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const saveInFlight = useRef(false)
  const resultRevision = useRef(0)
  const running = state.status === 'running'
  const result = state.status === 'complete' ? state.result : undefined
  const output = result?.text || (state.status === 'running' ? state.text : '')
  const tooLong = draft.length > MAX_WRITING_INPUT_CHARS

  const invalidateResult = () => {
    resultRevision.current += 1
    reset()
    setCopied(false)
    setCopyFailed(false)
    setSaveState('idle')
  }

  const submit = () => {
    if (!selectedModel || !draft.trim() || tooLong || running) return
    invalidateResult()
    void rewrite({ draft, style, model: selectedModel })
  }

  const copy = () => {
    if (!result) return
    try {
      const success = copyToClipboard(result.text)
      setCopied(success)
      setCopyFailed(!success)
    } catch {
      setCopied(false)
      setCopyFailed(true)
    }
  }

  const save = async () => {
    if (!result || saveInFlight.current || saveState === 'saved') return
    saveInFlight.current = true
    const revision = resultRevision.current
    setSaveState('saving')
    try {
      await saveWritingResult(result, t('Writing review'))
      if (resultRevision.current === revision) setSaveState('saved')
    } catch {
      if (resultRevision.current === revision) setSaveState('error')
    } finally {
      saveInFlight.current = false
    }
  }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        {t('Your words, clearer. Fix a draft without bringing in chat history, memory, files, or tools.')}
      </Text>

      <Textarea
        label={t('Your draft')}
        placeholder={t('Paste the message you want to improve…')}
        value={draft}
        onChange={(event) => {
          invalidateResult()
          setDraft(event.currentTarget.value)
        }}
        onKeyDown={(event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault()
            event.stopPropagation()
            submit()
          }
        }}
        autosize
        minRows={4}
        maxRows={8}
        autoFocus
        autoComplete="off"
        data-private
        data-sentry-mask
        error={tooLong ? t('Use up to 8,000 characters. Your draft has not been shortened.') : undefined}
        styles={{ input: { fontSize: 16, lineHeight: 1.6 } }}
      />
      <Group justify="space-between" gap="xs">
        <Button
          variant="subtle"
          size="compact-sm"
          mih={40}
          disabled={!draft}
          onClick={() => {
            invalidateResult()
            setDraft('')
          }}
        >
          {t('Clear draft')}
        </Button>
        <Text size="xs" c={tooLong ? 'red' : 'dimmed'} className="tabular-nums">
          {draft.length.toLocaleString()} / {MAX_WRITING_INPUT_CHARS.toLocaleString()}
        </Text>
      </Group>

      <Select
        label={t('Writing style')}
        value={style}
        allowDeselect={false}
        data={[
          { value: 'clearer', label: t('Clearer') },
          { value: 'friendlier', label: t('Friendlier') },
          { value: 'shorter', label: t('Shorter') },
          { value: 'formal', label: t('Formal') },
        ]}
        onChange={(value) => {
          if (!value) return
          invalidateResult()
          setStyle(value as WritingStyle)
        }}
        styles={{ input: { minHeight: 40 } }}
      />
      <Select
        label={t('Provider and model')}
        placeholder={t('Choose a model')}
        data={options}
        value={selectedOption?.value || null}
        searchable
        allowDeselect={false}
        nothingFoundMessage={t('No writing models available')}
        onChange={(value) => {
          invalidateResult()
          setSelectedValue(value)
        }}
        styles={{ input: { minHeight: 40 } }}
        description={
          providerName
            ? t('Your draft will be sent to {{provider}} using this configured connection.', { provider: providerName })
            : t('Choose a configured text model. No provider will be selected automatically.')
        }
      />
      {!options.length && (
        <Button variant="light" mih={40} onClick={onConfigureProvider}>
          {t('Configure a provider')}
        </Button>
      )}

      <Group justify="flex-end">
        {running ? (
          <Button variant="default" mih={40} leftSection={<IconPlayerStop size={16} />} onClick={cancel}>
            {t('Stop rewriting')}
          </Button>
        ) : (
          <Button
            mih={40}
            leftSection={result ? <IconRefresh size={16} /> : <IconPencil size={16} />}
            disabled={!selectedModel || !draft.trim() || tooLong}
            onClick={submit}
          >
            {result ? t('Try again') : t('Improve writing')}
          </Button>
        )}
      </Group>

      <div role="status" aria-live="polite">
        {running && (
          <Text size="sm" c="dimmed">
            {t('Rewriting… You can stop or edit your draft at any time.')}
          </Text>
        )}
        {state.status === 'cancelled' && (
          <Text size="sm" c="dimmed">
            {t('Rewrite stopped. Your draft is unchanged.')}
          </Text>
        )}
        {result && (
          <Text size="sm" c="dimmed">
            {t('Rewrite ready. Review it before sending.')}
          </Text>
        )}
      </div>
      {state.status === 'error' && (
        <Alert color="red" role="alert">
          {t(ERROR_MESSAGES[state.code])}
        </Alert>
      )}

      {(output || result) && (
        <Stack gap="sm">
          <Textarea
            label={running ? t('Rewrite in progress') : t('Revised message')}
            value={output}
            readOnly
            autosize
            minRows={3}
            maxRows={10}
            data-private
            data-sentry-mask
            styles={{ input: { fontSize: 16, lineHeight: 1.6 } }}
          />
          {result && (
            <>
              <details>
                <summary className="cursor-pointer py-2 text-sm">{t('Compare with original')}</summary>
                <Text size="sm" className="whitespace-pre-wrap break-words" data-private data-sentry-mask>
                  {result.request.draft}
                </Text>
              </details>
              <Group justify="space-between" gap="xs">
                <Button
                  variant="subtle"
                  mih={40}
                  loading={saveState === 'saving'}
                  disabled={saveState === 'saved'}
                  onClick={() => void save()}
                >
                  {saveState === 'saved' ? t('Saved to chat') : t('Save to chat')}
                </Button>
                <Button mih={40} leftSection={copied ? <IconCheck size={16} /> : <IconCopy size={16} />} onClick={copy}>
                  {copied ? t('Copied') : t('Copy revised message')}
                </Button>
              </Group>
              <Text size="xs" c="dimmed">
                {t('Save to chat keeps both drafts in normal history, including any configured history sync.')}
              </Text>
              {result.usage?.totalTokens !== undefined && (
                <Text size="xs" c="dimmed" className="tabular-nums">
                  {t('Tokens used: {{count}}', { count: result.usage.totalTokens })}
                </Text>
              )}
            </>
          )}
        </Stack>
      )}
      {copyFailed && (
        <Alert color="yellow" role="alert">
          {t('Copy failed. Select the revised message and copy it manually.')}
        </Alert>
      )}
      {saveState === 'error' && (
        <Alert color="red" role="alert">
          {t('Could not save this review. You can still copy the revised message.')}
        </Alert>
      )}
      <Text size="xs" c="dimmed">
        {t(
          'This review stays temporary until you choose Save to chat. Closing it clears the review; existing chat drafts are unchanged. Provider retention policies still apply.'
        )}
      </Text>
    </Stack>
  )
}
