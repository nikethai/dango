import {
  ActionIcon,
  Button,
  FileButton,
  Flex,
  Slider,
  Stack,
  Switch,
  Text,
  Textarea,
  TextInput,
  Tooltip,
} from '@mantine/core'
import { chatSessionSettings, getDefaultPrompt } from '@shared/defaults'
import type { PromptPreset } from '@shared/types'
import { readShowThinking } from '@shared/types/settings'
import { applyOpenAIReasoningEffort, getReasoningDropdownValue } from '@shared/utils'
import { IconEdit, IconInfoCircle, IconPlus, IconTrash } from '@tabler/icons-react'
import { createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { AssistantAvatar, UserAvatar } from '@/components/common/Avatar'
import MaxContextMessageCountSlider from '@/components/common/MaxContextMessageCountSlider'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import SliderWithInput from '@/components/common/SliderWithInput'
import { handleImageInputAndSave } from '@/components/Image'
import { SystemPromptPresetPicker, SystemPromptPresetsSection } from '@/components/SystemPromptPresets'
import { GenerateAvatarButton } from '@/components/settings/GenerateAvatarButton'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsCollapsible } from '@/components/settings/SettingsCollapsible'
import { SettingsPage } from '@/components/settings/SettingsPage'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsPrefRow } from '@/components/settings/SettingsPrefRow'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { ShowThinkingRow } from '@/components/settings/ShowThinkingRow'
import { StorageKeyGenerator } from '@/storage/StoreStorage'
import { usePromptPresets } from '@/stores/promptPresetsStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { add as addToast } from '@/stores/toastActions'

const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

export const Route = createFileRoute('/settings/chat')({
  component: RouteComponent,
})

export function RouteComponent() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)

  return (
    <SettingsPage>
      <SettingsPageHeader
        title={t('Chat Settings')}
        description={t('Defaults for new chats, avatars, and conversation behavior.')}
      />

      <SettingsSection title={t('Avatars')} description={t('Support jpg or png file smaller than 5MB')}>
        <SettingsCard>
          <div className="settings-card-fields">
            <div className="settings-field">
              <span className="settings-field-label">{t('User Avatar')}</span>
              <Flex align="center" gap="xs" wrap="wrap">
                <UserAvatar size={56} avatarKey={settings.userAvatarKey} />
                <FileButton
                  onChange={(file) => {
                    if (file) {
                      if (file.size > MAX_IMAGE_SIZE) {
                        addToast(t('Support jpg or png file smaller than 5MB'))
                        return
                      }
                      const key = StorageKeyGenerator.picture('user-avatar')
                      handleImageInputAndSave(file, key, () => setSettings({ userAvatarKey: key }))
                    }
                  }}
                  accept="image/png,image/jpeg"
                >
                  {(props) => (
                    <Button {...props} variant="outline" size="xs">
                      {t('Upload Image')}
                    </Button>
                  )}
                </FileButton>
                <GenerateAvatarButton kind="user" onSaved={(key) => setSettings({ userAvatarKey: key })} />
                {!!settings.userAvatarKey && (
                  <Button color="chatbox-gray" size="xs" onClick={() => setSettings({ userAvatarKey: undefined })}>
                    {t('Delete')}
                  </Button>
                )}
              </Flex>
            </div>
            <div className="settings-field">
              <span className="settings-field-label">{t('Default Assistant Avatar')}</span>
              <Flex align="center" gap="xs" wrap="wrap">
                <AssistantAvatar avatarKey={settings.defaultAssistantAvatarKey} size={56} />
                <FileButton
                  onChange={(file) => {
                    if (file) {
                      if (file.size > MAX_IMAGE_SIZE) {
                        addToast(t('Support jpg or png file smaller than 5MB'))
                        return
                      }
                      const key = StorageKeyGenerator.picture('default-assistant-avatar')
                      handleImageInputAndSave(file, key, () => setSettings({ defaultAssistantAvatarKey: key }))
                    }
                  }}
                  accept="image/png,image/jpeg"
                >
                  {(props) => (
                    <Button {...props} variant="outline" size="xs">
                      {t('Upload Image')}
                    </Button>
                  )}
                </FileButton>
                <GenerateAvatarButton
                  kind="assistant"
                  onSaved={(key) => setSettings({ defaultAssistantAvatarKey: key })}
                />
                {!!settings.defaultAssistantAvatarKey && (
                  <Button
                    color="chatbox-gray"
                    size="xs"
                    onClick={() => setSettings({ defaultAssistantAvatarKey: undefined })}
                  >
                    {t('Delete')}
                  </Button>
                )}
              </Flex>
            </div>
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('Default Settings for New Conversation')}>
        <SettingsCard>
          <div className="settings-card-fields">
            <div className="settings-field">
              <span className="settings-field-label">{t('Prompt')}</span>
              <SystemPromptPresetPicker
                value={settings.defaultPrompt || ''}
                onChange={(value) => setSettings({ defaultPrompt: value })}
              />
              <Textarea
                value={settings.defaultPrompt || ''}
                autosize
                minRows={1}
                maxRows={12}
                onChange={(e) => setSettings({ defaultPrompt: e.currentTarget.value })}
              />
              <Button
                variant="subtle"
                color="chatbox-gray"
                onClick={() => setSettings({ defaultPrompt: getDefaultPrompt() })}
                px={3}
                py={6}
                className="self-start"
              >
                {t('Reset to Default')}
              </Button>
            </div>

            <MaxContextMessageCountSlider
              wrapperProps={{ gap: 'xxs' }}
              labelProps={{ fw: undefined }}
              value={settings?.maxContextMessageCount ?? chatSessionSettings().maxContextMessageCount!}
              onChange={(v) => setSettings({ maxContextMessageCount: v })}
            />

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
                  events={{ hover: true, focus: true, touch: true }}
                >
                  <ScalableIcon icon={IconInfoCircle} size={18} className="text-chatbox-tint-tertiary" />
                </Tooltip>
              </Flex>
              <SliderWithInput
                value={settings?.temperature}
                onChange={(v) => setSettings({ temperature: v })}
                max={2}
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
                  events={{ hover: true, focus: true, touch: true }}
                >
                  <ScalableIcon icon={IconInfoCircle} size={18} className="text-chatbox-tint-tertiary" />
                </Tooltip>
              </Flex>
              <SliderWithInput value={settings?.topP} onChange={(v) => setSettings({ topP: v })} max={1} />
            </div>
            <div className="settings-field">
              <Flex align="center" gap="xs">
                <span className="settings-field-label">{t('Default Thinking Effort')}</span>
                <Tooltip
                  label={t('Used to seed new chat sessions. Only applies to supported OpenAI/OpenAI-compatible reasoning models.')}
                  withArrow
                  maw={320}
                  className="!whitespace-normal"
                  zIndex={3000}
                  events={{ hover: true, focus: true, touch: true }}
                >
                  <ScalableIcon icon={IconInfoCircle} size={18} className="text-chatbox-tint-tertiary" />
                </Tooltip>
              </Flex>
              <AdaptiveSelect
                value={getReasoningDropdownValue(settings)}
                onChange={(value) => {
                  if (!value) return
                  setSettings({
                    providerOptions: applyOpenAIReasoningEffort(settings, value as 'null' | 'low' | 'medium' | 'high'),
                  })
                }}
                data={[
                  { label: t('Disabled'), value: 'null' },
                  { label: t('Low'), value: 'low' },
                  { label: t('Medium'), value: 'medium' },
                  { label: t('High'), value: 'high' },
                ]}
              />
            </div>

            <SettingsPrefRow
              title={t('Stream output')}
              control={
                <Switch
                  checked={settings?.stream ?? true}
                  onChange={(v) => setSettings({ stream: v.target.checked })}
                />
              }
            />
          </div>
        </SettingsCard>
      </SettingsSection>

      <SettingsSection title={t('Thinking')}>
        <SettingsCard>
          <ShowThinkingRow
            value={readShowThinking(settings.showThinking)}
            onChange={(showThinking) => setSettings({ showThinking })}
          />
        </SettingsCard>
      </SettingsSection>

      <SettingsCollapsible title={t('Function')} description={t('Rendering and automation behavior.')} badge={t('Advanced')}>
        <SettingsCard divided>
          <SettingsPrefRow
            title={t('Auto-collapse code blocks')}
            control={
              <Switch
                checked={settings.autoCollapseCodeBlock}
                onChange={() => setSettings({ autoCollapseCodeBlock: !settings.autoCollapseCodeBlock })}
              />
            }
          />
          <SettingsPrefRow
            title={t('Auto-Generate Chat Titles')}
            control={
              <Switch
                checked={settings.autoGenerateTitle}
                onChange={() => setSettings({ ...settings, autoGenerateTitle: !settings.autoGenerateTitle })}
              />
            }
          />
          <SettingsPrefRow
            title={t('Spell Check')}
            control={
              <Switch
                checked={settings.spellCheck}
                onChange={() => setSettings({ ...settings, spellCheck: !settings.spellCheck })}
              />
            }
          />
          <SettingsPrefRow
            title={t('Markdown Rendering')}
            control={
              <Switch
                checked={settings.enableMarkdownRendering}
                onChange={() =>
                  setSettings({ ...settings, enableMarkdownRendering: !settings.enableMarkdownRendering })
                }
              />
            }
          />
          <SettingsPrefRow
            title={t('LaTeX Rendering (Requires Markdown)')}
            control={
              <Switch
                checked={settings.enableLaTeXRendering}
                onChange={() => setSettings({ ...settings, enableLaTeXRendering: !settings.enableLaTeXRendering })}
              />
            }
          />
          <SettingsPrefRow
            title={t('Mermaid Diagrams & Charts Rendering')}
            control={
              <Switch
                checked={settings.enableMermaidRendering}
                onChange={() => setSettings({ ...settings, enableMermaidRendering: !settings.enableMermaidRendering })}
              />
            }
          />
          <SettingsPrefRow
            title={t('Inject default metadata')}
            description={t('e.g., Model Name, Current Date')}
            control={
              <Switch
                checked={settings.injectDefaultMetadata}
                onChange={() => setSettings({ ...settings, injectDefaultMetadata: !settings.injectDefaultMetadata })}
              />
            }
          />
          <SettingsPrefRow
            title={t('Auto-preview artifacts')}
            description={t('Automatically open the side workspace while code or artifacts are being written')}
            control={
              <Switch
                checked={settings.autoPreviewArtifacts}
                onChange={() => setSettings({ ...settings, autoPreviewArtifacts: !settings.autoPreviewArtifacts })}
              />
            }
          />
          <SettingsPrefRow
            title={t('Paste long text as a file')}
            description={t(
              'Pasting long text will automatically insert it as a file, keeping chats clean and reducing token usage with prompt caching.'
            )}
            control={
              <Switch
                checked={settings.pasteLongTextAsAFile}
                onChange={() => setSettings({ ...settings, pasteLongTextAsAFile: !settings.pasteLongTextAsAFile })}
              />
            }
          />
        </SettingsCard>
      </SettingsCollapsible>

      <SystemPromptPresetsSection />
      <PromptPresetsSection />
      <ContextManagementSection />
    </SettingsPage>
  )
}

function PromptPresetsSection() {
  const { t } = useTranslation()
  const { promptPresets, addOrUpdatePreset, removePreset } = usePromptPresets()
  const [editingPreset, setEditingPreset] = useState<PromptPreset | null>(null)
  const [presetName, setPresetName] = useState('')
  const [presetCategory, setPresetCategory] = useState('')
  const [presetTags, setPresetTags] = useState('')
  const [presetContent, setPresetContent] = useState('')

  const groupedPresets = useMemo(() => {
    const groups = new Map<string, PromptPreset[]>()

    for (const preset of promptPresets) {
      const category = preset.category?.trim() || t('Uncategorized')
      groups.set(category, [...(groups.get(category) || []), preset])
    }

    return Array.from(groups.entries())
  }, [promptPresets, t])

  const openEditor = (preset?: PromptPreset) => {
    setEditingPreset(preset || ({ id: '', name: '', content: '' } as PromptPreset))
    setPresetName(preset?.name || '')
    setPresetCategory(preset?.category || '')
    setPresetTags((preset?.tags || []).join(', '))
    setPresetContent(preset?.content || '')
  }

  const closeEditor = () => {
    setEditingPreset(null)
    setPresetName('')
    setPresetCategory('')
    setPresetTags('')
    setPresetContent('')
  }

  const savePreset = () => {
    if (!presetName.trim() || !presetContent.trim()) {
      return
    }

    addOrUpdatePreset({
      id: editingPreset?.id || undefined,
      name: presetName.trim(),
      category: presetCategory.trim() || undefined,
      tags: presetTags
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean),
      content: presetContent,
    })
    closeEditor()
  }

  return (
    <SettingsSection
      title={t('Prompt Presets')}
      description={t(
        "Type '/' in the chat box to insert a saved preset. Supports {{CURRENT_DATE}}, {{CURRENT_TIME}}, and {{CLIPBOARD}}."
      )}
    >
      <SettingsCard>
        <div className="settings-card-fields">
          <div className="settings-actions">
            <Button
              variant="light"
              size="xs"
              leftSection={<ScalableIcon icon={IconPlus} size={16} />}
              onClick={() => openEditor()}
            >
              {t('Add Preset')}
            </Button>
          </div>

          {groupedPresets.length > 0 ? (
            <Stack gap="sm">
              {groupedPresets.map(([category, presets]) => (
                <Stack key={category} gap={4}>
                  <span className="settings-section-label">{category}</span>
                  {presets.map((preset) => (
                    <div key={preset.id} className="settings-list-row">
                      <Stack gap={2} flex={1} className="min-w-0">
                        <span className="settings-list-row-title">{preset.name}</span>
                        <span className="settings-list-row-meta line-clamp-1">{preset.content.split('\n')[0]}</span>
                        {!!preset.tags?.length && (
                          <Text size="xs" c="chatbox-secondary">
                            {preset.tags.join(', ')}
                          </Text>
                        )}
                      </Stack>
                      <Flex gap="xs">
                        <ActionIcon variant="subtle" color="chatbox-tertiary" onClick={() => openEditor(preset)}>
                          <IconEdit size={16} />
                        </ActionIcon>
                        <ActionIcon variant="subtle" color="chatbox-error" onClick={() => removePreset(preset.id)}>
                          <IconTrash size={16} />
                        </ActionIcon>
                      </Flex>
                    </div>
                  ))}
                </Stack>
              ))}
            </Stack>
          ) : (
            <Text size="sm" c="chatbox-tertiary">
              {t('No prompt presets yet')}
            </Text>
          )}
        </div>
      </SettingsCard>

      <AdaptiveModal
        opened={!!editingPreset}
        onClose={closeEditor}
        title={editingPreset?.id ? t('Edit Prompt Preset') : t('New Prompt Preset')}
        centered
      >
        <TextInput
          label={t('Preset Name')}
          value={presetName}
          onChange={(event) => setPresetName(event.currentTarget.value)}
        />
        <TextInput
          mt="sm"
          label={t('Category')}
          value={presetCategory}
          onChange={(event) => setPresetCategory(event.currentTarget.value)}
        />
        <TextInput
          mt="sm"
          label={t('Tags')}
          placeholder={t('Comma-separated tags')}
          value={presetTags}
          onChange={(event) => setPresetTags(event.currentTarget.value)}
        />
        <Textarea
          mt="sm"
          autosize
          minRows={6}
          maxRows={16}
          label={t('Content')}
          value={presetContent}
          onChange={(event) => setPresetContent(event.currentTarget.value)}
        />

        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={closeEditor} />
          <Button onClick={savePreset}>{t('Save')}</Button>
        </AdaptiveModal.Actions>
      </AdaptiveModal>
    </SettingsSection>
  )
}

function ContextManagementSection() {
  const { t } = useTranslation()
  const { setSettings, ...settings } = useSettingsStore((state) => state)

  // Get strategy hint based on threshold value
  const strategyHint = useMemo(() => {
    const threshold = settings.compactionThreshold ?? 0.6
    if (threshold <= 0.5) {
      return t('Cost Priority: Compacts early to save tokens, may lose some context')
    }
    if (threshold >= 0.8) {
      return t('Context Priority: Preserves more context, uses more tokens')
    }
    return t('Balanced: Good balance between cost and context preservation')
  }, [settings.compactionThreshold, t])

  return (
    <SettingsCollapsible title={t('Context Management')} description={t('Compaction and overflow behavior.')} badge={t('Advanced')}>
      <SettingsCard divided>
        <SettingsPrefRow
          title={t('Auto Compaction')}
          description={t(
            'When enabled, conversations will be automatically summarized to manage context window usage.'
          )}
          control={
            <Switch
              checked={settings.autoCompaction ?? true}
              onChange={() => setSettings({ autoCompaction: !(settings.autoCompaction ?? true) })}
            />
          }
        />
        <SettingsPrefRow
          title={t('Context Overflow Behavior')}
          description={t(
            'Choose what happens when the conversation context exceeds the compaction threshold. "Ask" shows a dialog so you can decide each time.'
          )}
          align="start"
          control={
            <AdaptiveSelect
              maw={200}
              comboboxProps={{ withinPortal: true }}
              value={settings.contextOverflowBehavior ?? 'ask'}
              data={[
                { value: 'ask', label: t('Ask every time') },
                { value: 'auto-compact', label: t('Auto compact') },
                { value: 'truncate', label: t('Truncate oldest messages') },
              ]}
              onChange={(val) => {
                if (val) {
                  setSettings({ contextOverflowBehavior: val as 'ask' | 'auto-compact' | 'truncate' })
                }
              }}
            />
          }
        />
        <div className="settings-field" style={{ padding: '0.75rem 0.9rem' }}>
          <Flex align="center" gap="xs">
            <span className="settings-field-label">{t('Compaction Threshold')}</span>
            <Tooltip
              label={t(
                'The percentage of context window usage that triggers automatic compaction. Lower values save tokens but may lose context earlier.'
              )}
              withArrow
              maw={320}
              className="!whitespace-normal"
              zIndex={3000}
              events={{ hover: true, focus: true, touch: true }}
            >
              <ScalableIcon icon={IconInfoCircle} size={18} className="text-chatbox-tint-tertiary" />
            </Tooltip>
          </Flex>
          <Slider
            min={0.4}
            max={0.9}
            step={0.05}
            value={settings.compactionThreshold ?? 0.6}
            onChange={(v) => setSettings({ compactionThreshold: v })}
            label={(v) => `${Math.round(v * 100)}%`}
            disabled={!(settings.autoCompaction ?? true)}
          />
          <Flex justify="space-between" px={2}>
            <Text size="xs" c="chatbox-tertiary">
              {t('Cost')}
            </Text>
            <Text size="xs" c="chatbox-tertiary">
              {t('Context')}
            </Text>
          </Flex>
          <span className="settings-field-hint">{strategyHint}</span>
        </div>
      </SettingsCard>
    </SettingsCollapsible>
  )
}
