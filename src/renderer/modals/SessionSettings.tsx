import NiceModal, { useModal } from '@ebay/nice-modal-react'
import {
  ActionIcon,
  Box,
  Button,
  Collapse,
  FileButton,
  Flex,
  Input,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  Tooltip,
  UnstyledButton,
} from '@mantine/core'
import { chatSessionSettings, pictureSessionSettings } from '@shared/defaults'
import {
  createMessage,
  isChatSession,
  isPictureSession,
  ModelProviderEnum,
  type Session,
  type SessionSettings,
} from '@shared/types'
import { applyOpenAIReasoningEffort, getReasoningDropdownValue } from '@shared/utils'
import { isReasoningReplayAvailable } from '@shared/utils/reasoning-replay'
import { IconChevronDown, IconInfoCircle, IconTrash } from '@tabler/icons-react'
import { pick } from 'lodash'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { AssistantAvatar } from '@/components/common/Avatar'
import LazyNumberInput from '@/components/common/LazyNumberInput'
import MaxContextMessageCountSlider from '@/components/common/MaxContextMessageCountSlider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SegmentedControl from '@/components/common/SegmentedControl'
import SliderWithInput from '@/components/common/SliderWithInput'
import { handleImageInputAndSave } from '@/components/Image'
import ImageStyleSelect from '@/components/ImageStyleSelect'
import { SystemPromptPresetPicker } from '@/components/SystemPromptPresets'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { updateSession } from '@/stores/chatStore'
import { getSessionMeta, mergeSettings } from '@/stores/sessionHelpers'
import { settingsStore, useSettingsStore } from '@/stores/settingsStore'
import { getMessageText } from '../../shared/utils/message'

const SessionSettingsModal = NiceModal.create(
  ({ session, disableAutoSave = false }: { session: Session; disableAutoSave?: boolean }) => {
    const modal = useModal()
    const { t } = useTranslation()
    const isSmallScreen = useIsSmallScreen()

    const [editingData, setEditingData] = useState<Session | null>(session || null)
    useEffect(() => {
      if (!session) {
        setEditingData(null)
      } else {
        setEditingData({
          ...session,
          settings: session.settings ? { ...session.settings } : undefined,
        })
      }
    }, [session])

    const [systemPrompt, setSystemPrompt] = useState('')
    const [advancedOpen, setAdvancedOpen] = useState(false)
    useEffect(() => {
      if (!session) {
        setSystemPrompt('')
      } else {
        const systemMessage = session.messages.find((m) => m.role === 'system')
        setSystemPrompt(systemMessage ? getMessageText(systemMessage) : '')
      }
    }, [session])

    // Reset progressive disclosure when a different session is opened
    useEffect(() => {
      setAdvancedOpen(false)
    }, [session?.id])

    const onReset = (event: React.MouseEvent) => {
      event.stopPropagation()
      event.preventDefault()
      setEditingData((_editingData) =>
        _editingData
          ? {
              ..._editingData,
              settings: pick(_editingData.settings, ['provider', 'modelId']),
            }
          : _editingData
      )
    }

    useEffect(() => {
      if (session) {
        trackingEvent('chat_config_window', { event_category: 'screen_view' })
      }
    }, [session])

    const onCancel = () => {
      if (session) {
        setEditingData({
          ...session,
        })
      }
      modal.resolve()
      modal.hide()
    }

    const applySessionChanges = (target: Session) => {
      target.name = (target.name ?? '').trim() || session.name
      const trimmed = systemPrompt.trim()
      const messages = Array.isArray(target.messages) ? [...target.messages] : []
      if (trimmed === '') {
        target.messages = messages.filter((m) => m.role !== 'system')
      } else {
        const idx = messages.findIndex((m) => m.role === 'system')
        if (idx >= 0) {
          const sys = { ...messages[idx], contentParts: [{ type: 'text' as const, text: trimmed }] }
          target.messages = [...messages.slice(0, idx), sys, ...messages.slice(idx + 1)]
        } else {
          target.messages = [createMessage('system', trimmed), ...messages]
        }
      }
      return target
    }
    const onSave = () => {
      if (!session || !editingData) {
        return
      }

      if (!disableAutoSave) {
        void updateSession(editingData.id, (s) => {
          const merged = {
            ...(s ?? {}),
            ...getSessionMeta(editingData),
            // Plan mode is set from the composer while this modal is open: keep the live value, not the snapshot.
            settings: { ...editingData.settings, planMode: s?.settings?.planMode },
          } as Session

          return applySessionChanges(merged)
        })
      } else {
        applySessionChanges(editingData)
      }

      // setChatConfigDialogSessionId(null)
      modal.resolve(editingData)
      modal.hide()
    }

    if (!session || !editingData) {
      return null
    }

    const isQuickChat = typeof document !== 'undefined' && document.documentElement.dataset.quickChat === '1'

    return (
      <AdaptiveModal
        opened={modal.visible}
        onClose={() => {
          modal.resolve()
          modal.hide()
        }}
        centered
        size={isQuickChat ? 'sm' : 'md'}
        title={t('Session options')}
        onFocus={(e) => e.stopPropagation()}
        trapFocus={false}
        classNames={{
          content: 'session-settings-modal',
          header: 'session-settings-modal-header',
          body: 'session-settings-modal-body',
          title: 'session-settings-modal-title',
        }}
      >
        <div
          className="session-settings-scroll"
          style={{ maxHeight: isQuickChat ? 'min(52vh, 360px)' : '60vh', overflowY: 'auto', overflowX: 'hidden' }}
        >
          <Stack gap={isQuickChat ? 'sm' : 'md'} className="session-settings-stack">
            {/* Compact identity row — avatar demoted, name primary */}
            <Flex align="center" gap={isQuickChat ? 'xs' : 'sm'} className="session-settings-identity">
              <FileButton
                accept="image/png,image/jpeg"
                onChange={(file) => {
                  if (file) {
                    const key = StorageKeyGenerator.picture(`assistant-avatar:${session?.id}`)
                    handleImageInputAndSave(file, key, () =>
                      setEditingData({ ...editingData, assistantAvatarKey: key })
                    )
                  }
                }}
              >
                {(props) => (
                  <Flex className="relative shrink-0">
                    <AssistantAvatar
                      size={isQuickChat ? 32 : 40}
                      avatarKey={editingData.assistantAvatarKey}
                      picUrl={editingData.picUrl}
                      sessionType={editingData.type}
                      {...props}
                    />
                    {editingData.assistantAvatarKey && (
                      <ActionIcon
                        color="chatbox-error"
                        size={18}
                        radius="xl"
                        bottom={-2}
                        right={-2}
                        className="absolute"
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditingData({ ...editingData, assistantAvatarKey: undefined })
                        }}
                        aria-label={t('Remove avatar')}
                      >
                        <ScalableIcon icon={IconTrash} size={12} />
                      </ActionIcon>
                    )}
                  </Flex>
                )}
              </FileButton>

              <Input.Wrapper label={t('Name')} className="flex-1 min-w-0">
                <Input
                  placeholder={t('Name')}
                  autoFocus={!isSmallScreen || isQuickChat}
                  value={editingData.name}
                  onChange={(e) => setEditingData({ ...editingData, name: e.target.value })}
                  classNames={{
                    input: '!text-chatbox-tint-primary',
                  }}
                  size={isQuickChat ? 'sm' : undefined}
                />
              </Input.Wrapper>
            </Flex>

            {editingData.settings?.provider !== ModelProviderEnum.OpenClaw && (
              <Stack gap="xs" className="session-settings-prompt">
                <Textarea
                  label={t('System prompt')}
                  placeholder={t('Copilot Prompt Demo') || ''}
                  autosize
                  minRows={isQuickChat ? 2 : 2}
                  maxRows={isQuickChat ? 5 : 8}
                  value={systemPrompt}
                  onChange={(event) => setSystemPrompt(event.target.value)}
                  classNames={{
                    input: '!text-chatbox-tint-primary',
                  }}
                  styles={{
                    input: { touchAction: 'manipulation' },
                  }}
                  size={isQuickChat ? 'sm' : undefined}
                />
                <SystemPromptPresetPicker value={systemPrompt} onChange={setSystemPrompt} />
              </Stack>
            )}

            {isChatSession(session) && (
              <Stack gap={4} className="session-settings-memory-autosave">
                <Flex align="center" justify="space-between" gap="sm">
                  <Text size="sm" fw={600}>
                    {t('Auto-save memories from this chat')}
                  </Text>
                  <Switch
                    checked={editingData.settings?.memoryAutoSave !== false}
                    onChange={(e) =>
                      setEditingData((_data) => {
                        if (!_data) return null
                        return {
                          ..._data,
                          settings: {
                            ..._data.settings,
                            // undefined = inherit global; false = session opt-out
                            memoryAutoSave: e.currentTarget.checked ? undefined : false,
                          },
                        }
                      })
                    }
                  />
                </Flex>
                <Text size="xs" c="dimmed">
                  {editingData.settings?.memoryAutoSave === false
                    ? t('Auto-extract and model retain are off for this chat. You can still save facts manually.')
                    : t(
                        'When on, durable facts may be auto-extracted and model-retained (if Memory auto-save is enabled globally).'
                      )}
                </Text>
              </Stack>
            )}

            {/* Advanced model settings — collapsed by default */}
            <Stack
              gap={0}
              className="border border-solid border-chatbox-border-primary rounded-lg overflow-hidden session-settings-advanced"
            >
              <UnstyledButton
                onClick={() => setAdvancedOpen((v) => !v)}
                className="w-full px-3 py-2.5 hover:bg-[var(--chatbox-background-tertiary)] transition-colors session-settings-advanced-toggle"
                aria-expanded={advancedOpen}
              >
                <Flex align="center" justify="space-between" gap="sm">
                  <Text size="sm" fw={600} c="chatbox-primary">
                    {t('Model settings')}
                  </Text>
                  <Flex align="center" gap={6}>
                    {advancedOpen && (
                      <Button
                        size="compact-xs"
                        color="chatbox-secondary"
                        variant="light"
                        onClick={(e) => {
                          e.stopPropagation()
                          onReset(e)
                        }}
                      >
                        {t('Reset')}
                      </Button>
                    )}
                    <IconChevronDown
                      size={16}
                      stroke={1.5}
                      className="text-chatbox-tint-tertiary transition-transform duration-150"
                      style={{ transform: advancedOpen ? 'rotate(180deg)' : undefined }}
                    />
                  </Flex>
                </Flex>
              </UnstyledButton>

              <Collapse in={advancedOpen}>
                <Box px="md" py="sm" className="border-0 border-t border-solid border-chatbox-border-primary">
                  {isChatSession(session) && (
                    <ChatConfig
                      settings={editingData.settings}
                      onSettingsChange={(d) =>
                        setEditingData((_data) => {
                          if (_data) {
                            return {
                              ..._data,
                              settings: {
                                ..._data?.settings,
                                ...d,
                              },
                            }
                          } else {
                            return null
                          }
                        })
                      }
                    />
                  )}
                  {isPictureSession(session) && <PictureConfig dataEdit={editingData} setDataEdit={setEditingData} />}
                </Box>
              </Collapse>
            </Stack>
          </Stack>
        </div>

        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={onCancel} />
          <Button onClick={onSave}>{t('Save')}</Button>
        </AdaptiveModal.Actions>
      </AdaptiveModal>
    )
  }
)

export default SessionSettingsModal

interface ThinkingBudgetConfigProps {
  currentBudgetTokens: number
  isEnabled: boolean
  onConfigChange: (config: { budgetTokens: number; enabled: boolean }) => void
  tooltipText: string
  minValue?: number
  maxValue?: number
}

function ThinkingBudgetConfig({
  currentBudgetTokens,
  isEnabled,
  onConfigChange,
  tooltipText,
  minValue = 1024,
  maxValue = 10000,
}: ThinkingBudgetConfigProps) {
  const { t } = useTranslation()
  const isQuickChat = typeof document !== 'undefined' && document.documentElement.dataset.quickChat === '1'

  // Define preset values in one place
  const PRESET_VALUES = useMemo(() => [2048, 5120, 10240], [])

  // Full session: "Low (2K)"; Quick Chat modal is ~360px — short labels so chips don't clip.
  const thinkingBudgetOptions = useMemo(
    () =>
      isQuickChat
        ? [
            { label: t('Off'), value: 'disabled' },
            { label: '2K', value: PRESET_VALUES[0].toString() },
            { label: '5K', value: PRESET_VALUES[1].toString() },
            { label: '10K', value: PRESET_VALUES[2].toString() },
            { label: t('Custom'), value: 'custom' },
          ]
        : [
            { label: t('Disabled'), value: 'disabled' },
            { label: `${t('Low')} (2K)`, value: PRESET_VALUES[0].toString() },
            { label: `${t('Medium')} (5K)`, value: PRESET_VALUES[1].toString() },
            { label: `${t('High')} (10K)`, value: PRESET_VALUES[2].toString() },
            { label: t('Custom'), value: 'custom' },
          ],
    [t, PRESET_VALUES, isQuickChat]
  )

  // Add state to track custom mode selection
  const [isCustomMode, setIsCustomMode] = useState(false)
  const [userSelectedCustom, setUserSelectedCustom] = useState(false)

  // Initialize custom mode based on current budget tokens
  useEffect(() => {
    if (isEnabled) {
      const matchesPreset = PRESET_VALUES.includes(currentBudgetTokens)
      // Only auto-set custom mode if user hasn't manually selected custom and value doesn't match presets
      if (!matchesPreset && !isCustomMode && !userSelectedCustom) {
        setIsCustomMode(true)
      }
      // Don't override user's manual custom selection even if value matches preset
    } else {
      // Only reset if currently in custom mode
      if (isCustomMode || userSelectedCustom) {
        setIsCustomMode(false)
        setUserSelectedCustom(false)
      }
    }
  }, [isEnabled, currentBudgetTokens, PRESET_VALUES, isCustomMode, userSelectedCustom])

  // Determine current segment value
  const getCurrentSegmentValue = useCallback(() => {
    if (!isEnabled) return 'disabled'

    if (isCustomMode || userSelectedCustom) return 'custom'

    const matchingPreset = PRESET_VALUES.find((preset) => preset === currentBudgetTokens)
    return matchingPreset ? matchingPreset.toString() : 'custom'
  }, [isEnabled, isCustomMode, userSelectedCustom, PRESET_VALUES, currentBudgetTokens])

  const handleThinkingConfigChange = useCallback(
    (value: string) => {
      if (value === 'disabled') {
        setIsCustomMode(false)
        setUserSelectedCustom(false)
        onConfigChange({ budgetTokens: 0, enabled: false })
      } else if (value === 'custom') {
        setIsCustomMode(true)
        setUserSelectedCustom(true) // Mark that user manually selected custom
        // For disabled to custom switch, use a reasonable default
        const customValue = currentBudgetTokens > 0 ? currentBudgetTokens : minValue || PRESET_VALUES[0]
        onConfigChange({ budgetTokens: customValue, enabled: true })
      } else {
        setIsCustomMode(false)
        setUserSelectedCustom(false)
        onConfigChange({ budgetTokens: parseInt(value), enabled: true })
      }
    },
    [currentBudgetTokens, minValue, PRESET_VALUES, onConfigChange]
  )

  const handleCustomBudgetChange = useCallback(
    (v: number | undefined) => {
      onConfigChange({ budgetTokens: v || minValue, enabled: true })
    },
    [minValue, onConfigChange]
  )

  const currentSegmentValue = getCurrentSegmentValue()

  return (
    <Stack gap={isQuickChat ? 'sm' : 'md'} style={{ minWidth: 0 }} className="session-thinking-budget">
      <Flex align="center" gap="xs">
        <Text size="sm" fw="600">
          {t('Thinking Budget')}
        </Text>
        <Tooltip
          label={
            isQuickChat
              ? `${tooltipText} · ${t('Off')} / 2K (${t('Low')}) / 5K (${t('Medium')}) / 10K (${t('High')}) / ${t('Custom')}`
              : tooltipText
          }
          withArrow={true}
          maw={320}
          className="!whitespace-normal"
          zIndex={3000}
          events={{ hover: true, focus: true, touch: true }}
        >
          <ScalableIcon icon={IconInfoCircle} size={isQuickChat ? 16 : 20} className="text-chatbox-tint-tertiary" />
        </Tooltip>
      </Flex>

      <div className="session-thinking-budget-control" style={{ minWidth: 0 }}>
        <SegmentedControl
          key={isQuickChat ? 'thinking-budget-control-quick' : 'thinking-budget-control'}
          value={currentSegmentValue}
          onChange={handleThinkingConfigChange}
          data={thinkingBudgetOptions}
          className="session-thinking-budget-segments"
        />
      </div>

      {currentSegmentValue === 'custom' && (
        <SliderWithInput
          min={minValue}
          max={maxValue}
          step={1}
          value={currentBudgetTokens}
          onChange={handleCustomBudgetChange}
        />
      )}
    </Stack>
  )
}

function ClaudeProviderConfig({
  settings,
  onSettingsChange,
}: {
  settings: SessionSettings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const providerOptions = settings?.providerOptions?.claude

  const handleConfigChange = (config: { budgetTokens: number; enabled: boolean }) => {
    onSettingsChange({
      providerOptions: {
        claude: {
          thinking: {
            type: config.enabled ? 'enabled' : 'disabled',
            budgetTokens: config.budgetTokens,
          },
        },
      },
    })
  }

  return (
    <ThinkingBudgetConfig
      currentBudgetTokens={providerOptions?.thinking?.budgetTokens || 1024}
      isEnabled={providerOptions?.thinking?.type === 'enabled'}
      onConfigChange={handleConfigChange}
      tooltipText={t('Thinking Budget only works for 3.7 or later models')}
      minValue={1024}
      maxValue={10000}
    />
  )
}

function OpenAIProviderConfig({
  settings,
  onSettingsChange,
}: {
  settings: SessionSettings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const isQuickChat = typeof document !== 'undefined' && document.documentElement.dataset.quickChat === '1'
  const providerOptions = settings?.providerOptions?.openai

  // Memoize options to prevent recreation on every render
  const reasoningEffortOptions = useMemo(
    () =>
      isQuickChat
        ? [
            { label: t('Off'), value: 'null' },
            { label: t('Low'), value: 'low' },
            { label: t('Med'), value: 'medium' },
            { label: t('High'), value: 'high' },
          ]
        : [
            { label: t('Disabled'), value: 'null' },
            { label: t('Low'), value: 'low' },
            { label: t('Medium'), value: 'medium' },
            { label: t('High'), value: 'high' },
          ],
    [t, isQuickChat]
  )

  const handleReasoningEffortChange = useCallback(
    (value: string) => {
      onSettingsChange({
        providerOptions: applyOpenAIReasoningEffort(settings, value as 'null' | 'low' | 'medium' | 'high'),
      })
    },
    [onSettingsChange, settings]
  )

  const currentValue = useMemo(() => getReasoningDropdownValue(settings), [settings])

  return (
    <Stack gap={isQuickChat ? 'sm' : 'md'} className="session-thinking-budget">
      <Flex align="center" gap="xs">
        <Text size="sm" fw="600">
          {t('Thinking Effort')}
        </Text>
        <Tooltip
          label={t('Thinking Effort only works for OpenAI o-series models')}
          withArrow={true}
          maw={320}
          className="!whitespace-normal"
          zIndex={3000}
          events={{ hover: true, focus: true, touch: true }}
        >
          <ScalableIcon icon={IconInfoCircle} size={isQuickChat ? 16 : 20} className="text-chatbox-tint-tertiary" />
        </Tooltip>
      </Flex>

      <div className="session-thinking-budget-control" style={{ minWidth: 0 }}>
        <SegmentedControl
          key={isQuickChat ? 'reasoning-effort-control-quick' : 'reasoning-effort-control'}
          value={currentValue}
          onChange={handleReasoningEffortChange}
          data={reasoningEffortOptions}
          className="session-thinking-budget-segments"
        />
      </div>
    </Stack>
  )
}

function GoogleProviderConfig({
  settings,
  onSettingsChange,
}: {
  settings: SessionSettings
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const providerOptions = settings?.providerOptions?.google

  const handleConfigChange = (config: { budgetTokens: number; enabled: boolean }) => {
    onSettingsChange({
      providerOptions: {
        google: { thinkingConfig: { thinkingBudget: config.budgetTokens, includeThoughts: config.enabled } },
      },
    })
  }

  return (
    <ThinkingBudgetConfig
      currentBudgetTokens={providerOptions?.thinkingConfig?.thinkingBudget || 0}
      isEnabled={(providerOptions?.thinkingConfig?.thinkingBudget || 0) > 0}
      onConfigChange={handleConfigChange}
      tooltipText={t('Thinking Budget only works for 2.0 or later models')}
      minValue={0}
      maxValue={10000}
    />
  )
}

export function ChatConfig({
  settings,
  onSettingsChange,
}: {
  settings: Session['settings']
  onSettingsChange: (data: Session['settings']) => void
}) {
  const { t } = useTranslation()
  const globalSettingsStream = useSettingsStore((s) => s.stream)
  const globalSettings = useSettingsStore((s) => s)
  const showPreserveReasoningToggle = useMemo(
    () => isReasoningReplayAvailable(settings, globalSettings),
    [settings, globalSettings]
  )

  return (
    <Stack gap="md">
      <MaxContextMessageCountSlider
        value={settings?.maxContextMessageCount ?? chatSessionSettings().maxContextMessageCount!}
        onChange={(v) => onSettingsChange({ maxContextMessageCount: v })}
      />

      <Stack gap="xs">
        <Flex align="center" gap="xs">
          <Text size="sm" fw="600">
            {t('Temperature')}
          </Text>
          <Tooltip
            label={t(
              'Modify the creativity of AI responses; the higher the value, the more random and intriguing the answers become, while a lower value ensures greater stability and reliability.'
            )}
            withArrow={true}
            maw={320}
            className="!whitespace-normal"
            zIndex={3000}
            events={{ hover: true, focus: true, touch: true }}
          >
            <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
          </Tooltip>
        </Flex>

        <SliderWithInput value={settings?.temperature} onChange={(v) => onSettingsChange({ temperature: v })} max={2} />
      </Stack>

      <Stack gap="xs">
        <Flex align="center" gap="xs">
          <Text size="sm" fw="600">
            Top P
          </Text>
          <Tooltip
            label={t(
              'The topP parameter controls the diversity of AI responses: lower values make the output more focused and predictable, while higher values allow for more varied and creative replies.'
            )}
            withArrow={true}
            maw={320}
            className="!whitespace-normal"
            zIndex={3000}
            events={{ hover: true, focus: true, touch: true }}
          >
            <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
          </Tooltip>
        </Flex>

        <SliderWithInput value={settings?.topP} onChange={(v) => onSettingsChange({ topP: v })} max={1} />
      </Stack>

      <Flex justify="space-between" align="center">
        <Flex align="center" gap="xs">
          <Text size="sm" fw="600">
            {t('Max Output Tokens')}
          </Text>
          <Tooltip
            label={t(
              'Set the maximum number of tokens for model output. Please set it within the acceptable range of the model, otherwise errors may occur.'
            )}
            withArrow={true}
            maw={320}
            className="!whitespace-normal"
            zIndex={3000}
            events={{ hover: true, focus: true, touch: true }}
          >
            <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
          </Tooltip>
        </Flex>

        <LazyNumberInput
          width={96}
          value={settings?.maxTokens}
          onChange={(v) => onSettingsChange({ maxTokens: typeof v === 'number' ? v : undefined })}
          min={0}
          step={1024}
          allowDecimal={false}
          placeholder={t('Not set') || ''}
        />
      </Flex>

      <Stack gap="xs" py="xs">
        <Flex align="center" justify="space-between" gap="xs">
          <Text size="sm" fw="600">
            {t('Stream output')}
          </Text>
          <Switch
            checked={settings?.stream ?? globalSettingsStream ?? true}
            onChange={(v) => onSettingsChange({ stream: v.target.checked })}
          />
        </Flex>
      </Stack>

      {showPreserveReasoningToggle && (
        <Stack gap="xs" py="xs">
          <Flex align="center" gap="xs">
            <Text size="sm" fw="600">
              {t('Preserve reasoning in context')}
            </Text>
            <Tooltip
              label={t('Replay prior assistant reasoning back to supported reasoning models on later turns.')}
              withArrow={true}
              maw={320}
              className="!whitespace-normal"
              zIndex={3000}
              events={{ hover: true, focus: true, touch: true }}
            >
              <ScalableIcon icon={IconInfoCircle} size={20} className="text-chatbox-tint-tertiary" />
            </Tooltip>
          </Flex>

          <Flex align="center" justify="space-between" gap="xs">
            <Text size="sm" c="dimmed">
              {t('Only available for supported reasoning transports.')}
            </Text>
            <Switch
              checked={settings?.preserveReasoningInContext ?? true}
              onChange={(event) => onSettingsChange({ preserveReasoningInContext: event.target.checked })}
            />
          </Flex>
        </Stack>
      )}

      <Stack>
        {settings?.provider === ModelProviderEnum.Claude && (
          <ClaudeProviderConfig settings={settings} onSettingsChange={onSettingsChange} />
        )}
        {settings?.provider === ModelProviderEnum.OpenAI && (
          <OpenAIProviderConfig settings={settings} onSettingsChange={onSettingsChange} />
        )}
        {settings?.provider === ModelProviderEnum.Gemini && (
          <GoogleProviderConfig settings={settings} onSettingsChange={onSettingsChange} />
        )}
      </Stack>
    </Stack>
  )
}

function PictureConfig(props: { dataEdit: Session; setDataEdit: (data: Session) => void }) {
  const { t } = useTranslation()
  const { dataEdit, setDataEdit } = props
  const globalSettings = settingsStore.getState().getSettings()
  const sessionSettings = mergeSettings(globalSettings, dataEdit.settings || {}, dataEdit.type || 'chat')
  const updateSettingsEdit = (updated: Partial<SessionSettings>) => {
    setDataEdit({
      ...dataEdit,
      settings: {
        ...(dataEdit.settings || {}),
        ...updated,
      },
    })
  }
  return (
    <Stack gap="md" className="my-4">
      <ImageStyleSelect
        value={sessionSettings.dalleStyle || pictureSessionSettings().dalleStyle!}
        onChange={(v) => updateSettingsEdit({ dalleStyle: v })}
        className={sessionSettings.dalleStyle === undefined ? 'opacity-50' : ''}
      />
      <Stack>
        <Text size="sm" fw="600">
          {t('Number of Images per Reply')}
        </Text>
        <Slider
          value={sessionSettings.imageGenerateNum || pictureSessionSettings().imageGenerateNum!}
          onChange={(v) => updateSettingsEdit({ imageGenerateNum: v })}
          min={1}
          max={10}
          step={1}
          marks={Array.from({ length: 10 }).map((_, i) => ({
            value: i + 1,
          }))}
        />
      </Stack>
    </Stack>
  )
}
