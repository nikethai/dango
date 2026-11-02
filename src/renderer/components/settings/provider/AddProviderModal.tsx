import { Button, Stack, TextInput } from '@mantine/core'
import { ModelProviderType } from '@shared/types'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { AdaptiveSelect } from '@/components/AdaptiveSelect'
import { AdaptiveModal } from '@/components/common/AdaptiveModal'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { useSettingsStore } from '@/stores/settingsStore'
import { blurActiveElement } from './addProviderModalUtils'

interface AddProviderModalProps {
  opened: boolean
  onClose: () => void
}

export function AddProviderModal({ opened, onClose }: AddProviderModalProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isSmallScreen = useIsSmallScreen()
  const setSettings = useSettingsStore((s) => s.setSettings)
  const customProviders = useSettingsStore((s) => s.customProviders)
  const [newProviderName, setNewProviderName] = useState('')
  const [newProviderMode, setNewProviderMode] = useState<ModelProviderType>(ModelProviderType.OpenAI)
  // "Name is required" shows only after a save with an empty name
  const [triedEmptySave, setTriedEmptySave] = useState(false)

  useEffect(() => {
    if (opened) setTriedEmptySave(false)
    if (opened && isSmallScreen) {
      blurActiveElement()
    }
  }, [opened, isSmallScreen])

  const handleAddProvider = () => {
    if (!newProviderName.trim()) {
      setTriedEmptySave(true)
      return
    }
    const pid = `custom-provider-${uuidv4()}`
    setSettings({
      customProviders: [
        ...(customProviders || []),
        {
          id: pid,
          name: newProviderName,
          type: newProviderMode,
          isCustom: true,
        },
      ],
    })
    onClose()
    navigate({
      to: '/settings/provider/$providerId',
      params: {
        providerId: pid,
      },
    })
  }

  return (
    <AdaptiveModal size="sm" opened={opened} onClose={onClose} centered title={t('Add provider')}>
      <Stack gap="xs">
        <TextInput
          label={t('Name')}
          value={newProviderName}
          onChange={(e) => setNewProviderName(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
              e.preventDefault()
              handleAddProvider()
            }
          }}
          required
          data-autofocus={isSmallScreen ? undefined : true}
          error={triedEmptySave && !newProviderName.trim() ? t('Name is required') : ''}
        />
        <AdaptiveSelect
          label={t('API Mode')}
          value={newProviderMode}
          classNames={{ dropdown: 'pointer-events-auto' }}
          onChange={(value) => setNewProviderMode(value as ModelProviderType)}
          data={[
            {
              value: ModelProviderType.OpenAI,
              label: t('OpenAI API Compatible'),
            },
            {
              value: ModelProviderType.OpenAIResponses,
              label: t('OpenAI Responses API Compatible'),
            },
            {
              value: ModelProviderType.Claude,
              label: t('Claude API Compatible'),
            },
            {
              value: ModelProviderType.Gemini,
              label: t('Google Gemini API Compatible'),
            },
          ]}
        />
        <AdaptiveModal.Actions>
          <AdaptiveModal.CloseButton onClick={onClose} />
          <Button onClick={handleAddProvider}>
            {t('Add')}
          </Button>
        </AdaptiveModal.Actions>
      </Stack>
    </AdaptiveModal>
  )
}
