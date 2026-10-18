import {
  ActionIcon,
  Button,
  Checkbox,
  Flex,
  MultiSelect,
  Radio,
  Select,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { IconInfoCircle, IconPlus, IconTrash } from '@tabler/icons-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import LazyNumberInput from '@/components/common/LazyNumberInput'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SliderWithInput from '@/components/common/SliderWithInput'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsCollapsible } from '@/components/settings/SettingsCollapsible'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsPrefRow } from '@/components/settings/SettingsPrefRow'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { trackingEvent } from '@/packages/event'
import '@/static/agents-surfaces.css'
import {
  type AgentDetail,
  COPILOT_MAX_STEPS_DEFAULT,
  COPILOT_MAX_STEPS_MAX,
  COPILOT_MAX_STEPS_MIN,
  type CopilotHook,
} from '../../../../shared/types'

/** Built-in tool names available for tool access configuration. */
const BUILT_IN_TOOLS = [
  { value: 'web_search', label: 'Web Search' },
  { value: 'parse_link', label: 'Parse Link' },
  { value: 'generate_image', label: 'Generate Image' },
  { value: 'file_read', label: 'File Read' },
  { value: 'file_write', label: 'File Write' },
  { value: 'query_knowledge_base', label: 'Knowledge Base Query' },
  { value: 'upload_file', label: 'Upload File' },
  { value: 'task_create', label: 'Task Create' },
  { value: 'task_update', label: 'Task Update' },
  { value: 'task_list', label: 'Task List' },
  { value: 'task_get', label: 'Task Get' },
  { value: 'task_delete', label: 'Task Delete' },
]

/** Available hook types for copilot configuration. */
const HOOK_TYPES = [
  { value: 'inject-context', label: 'Inject Context' },
  { value: 'inject-datetime', label: 'Inject DateTime' },
  { value: 'inject-system-info', label: 'Inject System Info' },
  { value: 'web-fetch', label: 'Web Fetch' },
  { value: 'validate-format', label: 'Validate Format' },
]

const FORMAT_OPTIONS = [
  { value: 'markdown', label: 'Markdown' },
  { value: 'json', label: 'JSON' },
  { value: 'code', label: 'Code' },
]

interface AgentFormProps {
  agent: AgentDetail
  close(): void
  save(agent: AgentDetail): void
  // premiumActivated: boolean
  // openPremiumPage(): void
}

export function AgentForm(props: AgentFormProps) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const [agentEdit, setAgentEdit] = useState<AgentDetail>(props.agent)
  useEffect(() => {
    setAgentEdit(props.agent)
  }, [props.agent])
  const [errors, setErrors] = useState<{ name?: string; prompt?: string }>({})

  const save = () => {
    const name = agentEdit.name.trim()
    const prompt = agentEdit.prompt.trim()
    const picUrl = agentEdit.picUrl?.trim()
    const emojiAvatar = agentEdit.emojiAvatar?.trim()
    const nextErrors: { name?: string; prompt?: string } = {}
    if (!name) nextErrors.name = t('cannot be empty')
    if (!prompt) nextErrors.prompt = t('cannot be empty')
    if (nextErrors.name || nextErrors.prompt) {
      setErrors(nextErrors)
      return
    }
    props.save({
      ...agentEdit,
      name,
      prompt,
      picUrl,
      emojiAvatar,
    })
    trackingEvent('create_copilot', { event_category: 'user' })
  }

  const updateModelSettings = (patch: Partial<AgentDetail['modelSettings'] & object>) => {
    setAgentEdit((prev) => ({
      ...prev,
      modelSettings: {
        ...prev.modelSettings,
        ...patch,
      },
    }))
  }

  const isNew = !props.agent.name

  return (
    <div className="agents-form">
      <div className="agents-form-toolbar">
        <SettingsPageHeader
          className="!mb-0 flex-1"
          title={isNew ? t('Create New Agent') : t('Edit agent')}
          description={t('Name, prompt, and optional overrides for this agent.')}
        />
      </div>

      <SettingsSection title={t('Basics')}>
        <SettingsCard>
          <div className="settings-card-fields agents-form-fields">
            <TextInput
              autoFocus={!isSmallScreen}
              label={t('Agent Name')}
              placeholder={t('My Assistant') || ''}
              value={agentEdit.name}
              error={errors.name}
              onChange={(e) => {
                setErrors((prev) => ({ ...prev, name: undefined }))
                setAgentEdit({ ...agentEdit, name: e.currentTarget.value })
              }}
            />
            <Textarea
              label={t('Agent Prompt')}
              placeholder={t('Copilot Prompt Demo') || ''}
              minRows={4}
              maxRows={12}
              autosize
              value={agentEdit.prompt}
              error={errors.prompt}
              onChange={(e) => {
                setErrors((prev) => ({ ...prev, prompt: undefined }))
                setAgentEdit({ ...agentEdit, prompt: e.currentTarget.value })
              }}
            />
            <div className="agents-form-avatar-row">
              <TextInput
                className="agents-emoji-field"
                label={t('Emoji Avatar')}
                placeholder="🔬"
                value={agentEdit.emojiAvatar ?? ''}
                maxLength={4}
                onChange={(e) => setAgentEdit({ ...agentEdit, emojiAvatar: e.currentTarget.value })}
              />
              <TextInput
                className="flex-1 min-w-0"
                style={{ flex: 1 }}
                label={t('Agent Avatar URL')}
                placeholder="https://…"
                value={agentEdit.picUrl ?? ''}
                description={agentEdit.emojiAvatar ? t('Emoji avatar takes priority over URL') : undefined}
                onChange={(e) => setAgentEdit({ ...agentEdit, picUrl: e.currentTarget.value })}
              />
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsCollapsible
        title={t('Model Settings Override')}
        description={t('Leave blank to use session defaults')}
        badge={t('Advanced')}
        defaultOpen={Boolean(
          agentEdit.modelSettings?.temperature != null ||
            agentEdit.modelSettings?.topP != null ||
            agentEdit.modelSettings?.maxTokens != null
        )}
      >
        <SettingsCard>
          <div className="settings-card-fields">
            <div className="settings-field">
              <Flex align="center" gap="xs">
                <span className="settings-field-label">{t('Temperature')}</span>
                <Tooltip
                  label={t(
                    'Modify the creativity of AI responses; the higher the value, the more random and intriguing the answers become, while a lower value ensures greater stability and reliability.'
                  )}
                  withArrow
                  maw={320}
                  className="!whitespace-normal"
                  zIndex={3000}
                >
                  <ScalableIcon icon={IconInfoCircle} size={16} className="text-chatbox-tint-tertiary" />
                </Tooltip>
              </Flex>
              <SliderWithInput
                value={agentEdit.modelSettings?.temperature}
                onChange={(v) => updateModelSettings({ temperature: v })}
                max={2}
                step={0.1}
              />
            </div>
            <div className="settings-field">
              <Flex align="center" gap="xs">
                <span className="settings-field-label">Top P</span>
                <Tooltip
                  label={t(
                    'The topP parameter controls the diversity of AI responses: lower values make the output more focused and predictable, while higher values allow for more varied and creative replies.'
                  )}
                  withArrow
                  maw={320}
                  className="!whitespace-normal"
                  zIndex={3000}
                >
                  <ScalableIcon icon={IconInfoCircle} size={16} className="text-chatbox-tint-tertiary" />
                </Tooltip>
              </Flex>
              <SliderWithInput
                value={agentEdit.modelSettings?.topP}
                onChange={(v) => updateModelSettings({ topP: v })}
                max={1}
                step={0.05}
              />
            </div>
            <SettingsPrefRow
              title={t('Max Output Tokens')}
              description={t(
                'Set the maximum number of tokens for model output. Please set it within the acceptable range of the model, otherwise errors may occur.'
              )}
              control={
                <LazyNumberInput
                  width={96}
                  value={agentEdit.modelSettings?.maxTokens}
                  onChange={(v) => updateModelSettings({ maxTokens: typeof v === 'number' ? v : undefined })}
                  min={0}
                  step={1024}
                  allowDecimal={false}
                  placeholder={t('Not set') || ''}
                />
              }
            />
          </div>
        </SettingsCard>
      </SettingsCollapsible>

      <SettingsCollapsible
        title={t('Agent Settings')}
        description={t('Configure agent mode behavior')}
        badge={t('Advanced')}
        defaultOpen={agentEdit.maxSteps != null && agentEdit.maxSteps !== COPILOT_MAX_STEPS_DEFAULT}
      >
        <SettingsCard>
          <div className="settings-card-fields">
            <div className="settings-field">
              <Flex align="center" gap="xs">
                <span className="settings-field-label">{t('Max Steps')}</span>
                <Tooltip
                  label={t(
                    'Maximum number of autonomous tool-use steps the agent can take per message. Higher values allow more complex tasks but use more tokens.'
                  )}
                  withArrow
                  maw={320}
                  className="!whitespace-normal"
                  zIndex={3000}
                >
                  <ScalableIcon icon={IconInfoCircle} size={16} className="text-chatbox-tint-tertiary" />
                </Tooltip>
              </Flex>
              <SliderWithInput
                value={agentEdit.maxSteps ?? COPILOT_MAX_STEPS_DEFAULT}
                onChange={(v) =>
                  setAgentEdit((prev) => ({
                    ...prev,
                    maxSteps: v ?? COPILOT_MAX_STEPS_DEFAULT,
                  }))
                }
                min={COPILOT_MAX_STEPS_MIN}
                max={COPILOT_MAX_STEPS_MAX}
                step={1}
              />
            </div>
          </div>
        </SettingsCard>
      </SettingsCollapsible>

      <SettingsCollapsible
        title={t('Tool Access')}
        description={t('Control which tools this agent can use')}
        badge={t('Advanced')}
        defaultOpen={Boolean(agentEdit.toolAccess?.tools?.length)}
      >
        <SettingsCard>
          <div className="settings-card-fields">
            <Radio.Group
              label={t('Access Mode')}
              value={agentEdit.toolAccess?.mode ?? 'allowlist'}
              onChange={(value) =>
                setAgentEdit((prev) => ({
                  ...prev,
                  toolAccess: {
                    mode: value as 'allowlist' | 'denylist',
                    tools: prev.toolAccess?.tools ?? [],
                    includeMcp: prev.toolAccess?.includeMcp ?? true,
                  },
                }))
              }
            >
              <Stack gap={6} mt={6}>
                <Radio value="allowlist" label={t('Allowlist - only use selected tools')} />
                <Radio value="denylist" label={t('Denylist - use all except selected tools')} />
              </Stack>
            </Radio.Group>
            <Checkbox
              checked={agentEdit.toolAccess?.includeMcp ?? true}
              onChange={(event) =>
                setAgentEdit((prev) => ({
                  ...prev,
                  toolAccess: {
                    mode: prev.toolAccess?.mode ?? 'allowlist',
                    tools: prev.toolAccess?.tools ?? [],
                    includeMcp: event.currentTarget.checked,
                  },
                }))
              }
              label={t('Include MCP tools')}
            />
            <MultiSelect
              label={t('Select Tools')}
              data={BUILT_IN_TOOLS}
              value={agentEdit.toolAccess?.tools ?? []}
              onChange={(value) =>
                setAgentEdit((prev) => ({
                  ...prev,
                  toolAccess: {
                    mode: prev.toolAccess?.mode ?? 'allowlist',
                    tools: value,
                    includeMcp: prev.toolAccess?.includeMcp ?? true,
                  },
                }))
              }
              placeholder={t('Select tools...')}
              searchable
              clearable
            />
            <Text size="xs" c="chatbox-tertiary">
              {t('For MCP tools, enter tool names manually (e.g., mcp__server__tool_name)')}
            </Text>
          </div>
        </SettingsCard>
      </SettingsCollapsible>

      <SettingsCollapsible
        title={t('Hooks')}
        description={t('Configure pre-turn and post-turn hook actions')}
        badge={t('Advanced')}
        defaultOpen={Boolean(
          (agentEdit.hooks?.preTurn?.length ?? 0) > 0 || (agentEdit.hooks?.postTurn?.length ?? 0) > 0
        )}
      >
        <SettingsCard>
          <div className="settings-card-fields">
            <div className="settings-field">
              <span className="settings-field-label">{t('Pre-Turn Hooks')}</span>
              <span className="settings-field-hint">
                {t('Run before each generation to inject context or fetch data')}
              </span>
              <HookList
                hooks={agentEdit.hooks?.preTurn ?? []}
                onChange={(hooks) =>
                  setAgentEdit((prev) => ({
                    ...prev,
                    hooks: { ...prev.hooks, preTurn: hooks },
                  }))
                }
              />
            </div>
            <div className="settings-field">
              <span className="settings-field-label">{t('Post-Turn Hooks')}</span>
              <span className="settings-field-hint">
                {t('Run after each generation to validate or process output')}
              </span>
              <HookList
                hooks={agentEdit.hooks?.postTurn ?? []}
                onChange={(hooks) =>
                  setAgentEdit((prev) => ({
                    ...prev,
                    hooks: { ...prev.hooks, postTurn: hooks },
                  }))
                }
              />
            </div>
          </div>
        </SettingsCard>
      </SettingsCollapsible>

      <div className="agents-form-footer">
        <Switch
          checked={agentEdit.shared}
          onChange={(e) => setAgentEdit({ ...agentEdit, shared: e.currentTarget.checked })}
          label={t('Share (unavailable)')}
        />
        <div className="agents-form-actions">
          <Button variant="default" onClick={() => props.close()}>
            {t('cancel')}
          </Button>
          <Button onClick={save}>{t('save')}</Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Hook list editor component
 */
interface HookListProps {
  hooks: CopilotHook[]
  onChange(hooks: CopilotHook[]): void
}

function HookList({ hooks, onChange }: HookListProps) {
  const { t } = useTranslation()

  const addHook = () => {
    const newHook: CopilotHook = { type: 'inject-context', content: '' }
    onChange([...hooks, newHook])
  }

  const updateHook = (index: number, updates: Partial<CopilotHook>) => {
    const updated = hooks.map((h, i) => (i === index ? { ...h, ...updates } : h)) as CopilotHook[]
    onChange(updated)
  }

  const removeHook = (index: number) => {
    onChange(hooks.filter((_, i) => i !== index))
  }

  return (
    <Stack gap="xs">
      {hooks.map((hook, index) => (
        <HookEditor
          key={index}
          hook={hook}
          onChange={(updates) => updateHook(index, updates)}
          onRemove={() => removeHook(index)}
        />
      ))}
      <Button variant="default" size="xs" leftSection={<ScalableIcon icon={IconPlus} size={14} />} onClick={addHook}>
        {t('Add Hook')}
      </Button>
    </Stack>
  )
}

/**
 * Single hook editor component
 */
interface HookEditorProps {
  hook: CopilotHook
  onChange(updates: Partial<CopilotHook>): void
  onRemove(): void
}

function HookEditor({ hook, onChange, onRemove }: HookEditorProps) {
  const { t } = useTranslation()

  const handleTypeChange = (type: string) => {
    switch (type) {
      case 'inject-context':
        onChange({ type: 'inject-context' as const, content: '' })
        break
      case 'inject-datetime':
        onChange({ type: 'inject-datetime' as const })
        break
      case 'inject-system-info':
        onChange({ type: 'inject-system-info' as const })
        break
      case 'web-fetch':
        onChange({ type: 'web-fetch' as const, url: '', extractAs: 'text' as const })
        break
      case 'validate-format':
        onChange({ type: 'validate-format' as const, format: 'markdown' as const })
        break
      default:
        break
    }
  }

  return (
    <div className="agents-hook-card">
      <Flex gap="xs" align="flex-start">
        <Select
          size="xs"
          style={{ flex: 1 }}
          data={HOOK_TYPES}
          value={hook.type}
          onChange={(value) => value && handleTypeChange(value)}
        />
        <ActionIcon variant="subtle" color="gray" onClick={onRemove} aria-label={t('delete')}>
          <ScalableIcon icon={IconTrash} size={16} />
        </ActionIcon>
      </Flex>

      {hook.type === 'inject-context' && (
        <Textarea
          mt="xs"
          size="sm"
          placeholder={t('Context content to inject...')}
          value={(hook as { content: string }).content}
          onChange={(e) => onChange({ content: e.currentTarget.value })}
          minRows={2}
          maxRows={4}
          autosize
        />
      )}

      {hook.type === 'web-fetch' && (
        <Stack gap="xs" mt="xs">
          <TextInput
            size="sm"
            placeholder={t('URL to fetch...')}
            value={(hook as { url: string }).url}
            onChange={(e) => onChange({ url: e.currentTarget.value })}
          />
          <Select
            size="xs"
            label={t('Extract as')}
            data={[
              { value: 'text', label: 'Text' },
              { value: 'json', label: 'JSON' },
            ]}
            value={(hook as { extractAs: string }).extractAs}
            onChange={(value) => value && onChange({ extractAs: value as 'text' | 'json' })}
          />
        </Stack>
      )}

      {hook.type === 'validate-format' && (
        <Select
          size="xs"
          label={t('Format')}
          data={FORMAT_OPTIONS}
          value={(hook as { format: string }).format}
          onChange={(value) => value && onChange({ format: value as 'markdown' | 'json' | 'code' })}
          mt="xs"
        />
      )}

      {hook.type === 'inject-datetime' && (
        <Text size="xs" c="chatbox-tertiary" mt={6}>
          {t('Injects current datetime (ISO 8601 format)')}
        </Text>
      )}

      {hook.type === 'inject-system-info' && (
        <Text size="xs" c="chatbox-tertiary" mt={6}>
          {t('Injects OS and platform information')}
        </Text>
      )}
    </div>
  )
}
