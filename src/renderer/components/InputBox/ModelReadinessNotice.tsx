import { Button, Flex, Text } from '@mantine/core'
import type { ProviderModelInfo } from '@shared/types'
import { IconAlertCircle, IconSettings } from '@tabler/icons-react'
import { useTranslation } from 'react-i18next'
import { navigateToSettings } from '@/modals/Settings'
import { isNonChatComposerModel } from '@/utils/modelDisplayName'
import { type ModelReadiness, modelMeetsNeeds } from '@/utils/modelReadiness'
import { ScalableIcon } from '../common/ScalableIcon'
import { ModelSelector } from '../ModelSelector'

/** Chat models that can use tools; a model whose capabilities are unknown is never left out. */
export function canUseToolsModelFilter(model: ProviderModelInfo): boolean {
  return !isNonChatComposerModel(model) && modelMeetsNeeds(model, { requiresTools: true })
}

type Props = {
  readiness: ModelReadiness
  /** The selected model's display name, for "{{model}} can't use tools." */
  modelName?: string
  /** ER4 primary: send this message with no tools (`handleSubmit(true, { toolsOff: true })`). */
  onAnswerWithoutTools?(): void
  answerWithoutToolsDisabled?: boolean
  /** ER4 secondary: the user's own pick in a model picker. Dango never switches models by itself. */
  onSelectModel?(provider: string, modelId: string): void
}

export function ModelReadinessNotice({
  readiness,
  modelName,
  onAnswerWithoutTools,
  answerWithoutToolsDisabled,
  onSelectModel,
}: Props) {
  const { t } = useTranslation()

  if (readiness.status === 'ready') return null

  // ER4: the turn needs tools and this model can't use them. Checked before sending, never during a turn.
  if (readiness.status === 'capability-required' && readiness.capability === 'tool_use') {
    return (
      <div className="dg-composer-notice" role="status">
        <p className="dg-composer-notice__text dg-type-caption">
          {t("{{model}} can't use tools.", { model: modelName || readiness.modelId })}
        </p>
        <div className="dg-composer-notice__actions">
          {onAnswerWithoutTools ? (
            <button
              type="button"
              className="dg-btn dg-btn--primary"
              disabled={answerWithoutToolsDisabled}
              onClick={onAnswerWithoutTools}
            >
              {t('Answer without tools')}
            </button>
          ) : null}
          {onSelectModel ? (
            <ModelSelector
              onSelect={(provider, modelId) => onSelectModel(provider, modelId)}
              modelFilter={canUseToolsModelFilter}
              selectedProviderId={readiness.providerId}
              selectedModelId={readiness.modelId}
              position="top-start"
            >
              <button type="button" className="dg-btn dg-btn--ghost">
                {t('Choose a model')}
              </button>
            </ModelSelector>
          ) : null}
        </div>
      </div>
    )
  }

  const content =
    readiness.status === 'capability-required'
      ? {
          message: t('This model cannot analyze attachments. Choose a vision model.'),
          action: t('Change model'),
          onClick: () => navigateToSettings(`/provider/${readiness.providerId}`),
        }
      : readiness.status === 'model-unavailable'
        ? {
            message: t('This model is no longer available. Choose another model.'),
            action: t('Change model'),
            onClick: () => navigateToSettings(`/provider/${readiness.providerId}`),
          }
        : readiness.status === 'provider-unavailable'
          ? {
              message: t('This provider is not configured. Check its settings.'),
              action: t('Open settings'),
              onClick: () => navigateToSettings(`/provider/${readiness.providerId}`),
            }
          : {
              message: t('Choose a model to start chatting.'),
              action: t('Open settings'),
              onClick: () => navigateToSettings('/provider'),
            }

  return (
    <Flex align="center" gap="xs" px="sm" pt="xs" pb={2} className="min-w-0">
      <ScalableIcon
        icon={IconAlertCircle}
        size={14}
        className="shrink-0 text-[var(--chatbox-tint-tertiary)]"
        aria-hidden
      />
      <Text size="xs" c="chatbox-tertiary" className="min-w-0 flex-1 leading-snug">
        {content.message}
      </Text>
      <Button
        size="compact-xs"
        variant="subtle"
        color="chatbox-secondary"
        leftSection={<ScalableIcon icon={IconSettings} size={12} />}
        onClick={content.onClick}
      >
        {content.action}
      </Button>
    </Flex>
  )
}
