/**
 * SessionStatusBar — quiet product footer under the composer.
 * Model on the left; memory + context on the right. No CLI chrome.
 */

import { Flex, Text, Tooltip } from '@mantine/core'
import type { Message, SessionSettings } from '@shared/types'
import type { MemoryEntry } from '@shared/types/memory'
import { formatNumber } from '@shared/utils'
import { IconBrain, IconFileZip } from '@tabler/icons-react'
import { useAtomValue } from 'jotai'
import { type FC, useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { MemoryDockPopover } from '@/components/chat/MemoryDockPopover'

import TokenCountMenu from '@/components/InputBox/TokenCountMenu'
import { ProviderUsagePopover } from '@/components/usage'
import { aggregateSessionCosts, formatCost } from '@/packages/cost-tracking'
import { getMemoryInjectStats } from '@/packages/memory/inject'
import { useProviderUsageStatus, useUsageBudgetState } from '@/packages/usage-tracking'
import { composerTokenMenuAtom } from '@/stores/atoms/uiAtoms'
import * as chatStore from '@/stores/chatStore'
import { ensureMemoryStoreInit, useMemoryStore } from '@/stores/memoryStore'
import { CHATBOX_BUILD_PLATFORM } from '@/variables'

export type SessionStatusBarProps = {
  messages: Message[]
  modelLabel?: string
  model?: {
    provider: string
    modelId: string
  }
  settings?: SessionSettings
  generating?: boolean
  providerId?: string
  sessionId?: string
  /**
   * Session settings.memoryAutoSave. When false, status shows auto-save off
   * while Memory inject may still be on.
   */
  memoryAutoSave?: boolean
  /** Quiet bar for empty threads (model only, no usage noise) */
  empty?: boolean
  /**
   * Floating Quick Chat density: model + live/ready only.
   * Hides memory / tokens / cost (available in full app).
   */
  compact?: boolean
  onInsertMemory?: (entry: MemoryEntry) => void
  getMemorySaveContent?: () => string
}

function lastAssistantModel(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === 'assistant' && m.model) {
      return m.model
    }
  }
  return undefined
}

/** Prefer human model name; avoid "xAI · xAI Grok…" style duplication. */
function formatModelTitle(model: string, providerId?: string): string {
  if (!providerId || providerId === '—') return model
  const modelLower = model.toLowerCase()
  const providerLower = providerId.toLowerCase()
  if (modelLower.includes(providerLower)) return model
  // Common case: provider "xAI" + model "Grok 4.5" → keep "Grok 4.5" only (provider is in picker)
  if (providerLower === 'xai' || providerLower === 'openai' || providerLower === 'anthropic') {
    return model
  }
  return `${providerId} · ${model}`
}

const SessionStatusBar: FC<SessionStatusBarProps> = ({
  messages,
  modelLabel,
  model: activeModel,
  settings,
  generating,
  providerId,
  sessionId,
  memoryAutoSave,
  empty = false,
  compact = false,
  onInsertMemory,
  getMemorySaveContent,
}) => {
  const { t } = useTranslation()
  const tokenMenu = useAtomValue(composerTokenMenuAtom)
  const memoryReady = useMemoryStore((s) => s.ready)
  const globalBank = useMemoryStore((s) => s.globalBank)
  const memorySettings = useMemoryStore((s) => s.settings)
  const sessionAutoSaveOff = memoryAutoSave === false

  const handleMemoryAutoSaveChange = useCallback(
    (enabled: boolean) => {
      if (!sessionId) return
      void chatStore.updateSession(sessionId, (session) => {
        if (!session) throw new Error('Session not found')
        return {
          ...session,
          settings: {
            ...session.settings,
            // undefined = inherit global; false = session opt-out
            memoryAutoSave: enabled ? undefined : false,
          },
        }
      })
    },
    [sessionId]
  )

  useEffect(() => {
    if (compact) return
    void ensureMemoryStoreInit()
  }, [compact])

  const memoryChip = useMemo(() => {
    if (compact || !memoryReady) return null
    const stats = getMemoryInjectStats({
      settings: memorySettings,
      globalBank,
      agentBank: null,
    })
    if (!stats.enabled) {
      return { label: t('Off'), title: t('Open Memory settings'), factCount: 0, on: false }
    }
    const baseTitle =
      stats.factCount > 0
        ? t('{{count}} enabled facts will inject into model prompts (~{{tokens}} tokens)', {
            count: stats.factCount,
            tokens: stats.injectTokens,
          })
        : t('Memory enabled but empty — add facts in Settings')
    const autoSaveNote = sessionAutoSaveOff ? t('Auto-save is off for this chat. Save as knowledge still works.') : ''
    return {
      // Short label for the chip value (icon carries meaning)
      label: sessionAutoSaveOff
        ? stats.factCount > 0
          ? t('{{count}} · auto-save off', { count: stats.factCount })
          : t('Auto-save off')
        : stats.factCount > 0
          ? String(stats.factCount)
          : '—',
      title: autoSaveNote ? `${baseTitle} ${autoSaveNote}` : baseTitle,
      factCount: stats.factCount,
      on: true,
      autoSaveOff: sessionAutoSaveOff,
    }
  }, [compact, memoryReady, globalBank, memorySettings, sessionAutoSaveOff, t])

  const metrics = useMemo(() => (compact ? null : aggregateSessionCosts(messages)), [compact, messages])
  const activeModelLabel = modelLabel || lastAssistantModel(messages) || '—'

  const totalTokens = metrics ? metrics.totalInputTokens + metrics.totalOutputTokens : 0
  const hasUsage = Boolean(metrics && metrics.messagesWithUsage > 0)

  const modelTitle = useMemo(() => formatModelTitle(activeModelLabel, providerId), [activeModelLabel, providerId])
  const { status: providerUsage } = useProviderUsageStatus(compact ? undefined : providerId, '30d')
  const budgetState = useUsageBudgetState(compact ? undefined : providerId)

  /**
   * Plan chip only when the user should care: exhausted, warning, or high usage.
   * Idle "SuperGrok" labels stay out of the bar.
   */
  const planSegment = useMemo(() => {
    if (compact || !providerUsage) return null
    const exhausted = providerUsage.quota.state === 'exhausted'
    const budgetWarn = budgetState.level === 'warn' || budgetState.level === 'critical'
    const quotaKnown =
      providerUsage.quota.state === 'known' && providerUsage.quota.limit != null && providerUsage.quota.limit > 0
    const used = providerUsage.quota.used ?? 0
    const pct = quotaKnown ? Math.min(100, Math.round((used / (providerUsage.quota.limit as number)) * 100)) : null

    const highUsage = pct != null && pct >= 70
    if (!exhausted && !budgetWarn && !highUsage) return null

    let label = t('Plan')
    if (exhausted) {
      label = t('Plan exhausted')
    } else if (pct != null) {
      const planName = providerUsage.plan?.label
        ?.replace(/^ChatGPT\s+/i, '')
        .replace(/^Antigravity\s+/i, '')
        .replace(/^SuperGrok\s*/i, 'SuperGrok')
      label = planName ? `${planName} ${pct}%` : `${pct}%`
    } else if (budgetWarn) {
      label = budgetState.level === 'critical' ? t('Budget critical') : t('Budget warning')
    }

    const tone =
      exhausted || budgetState.level === 'critical' ? 'is-critical' : budgetWarn || highUsage ? 'is-warn' : ''
    return { label, tone, status: providerUsage }
  }, [compact, providerUsage, budgetState, t])

  const menuForSession = !compact && tokenMenu && sessionId && tokenMenu.sessionId === sessionId ? tokenMenu : null

  const tokenCount = hasUsage && metrics ? totalTokens : menuForSession ? menuForSession.totalTokens : null

  /** Prefer context-window fill when known; else raw token count. */
  const contextLabel = useMemo(() => {
    if (menuForSession?.isCompacting) return t('…')
    const window = menuForSession?.contextWindow
    const used = menuForSession?.contextTokens
    if (window && window > 0 && used != null && used > 0) {
      const pct = Math.min(99, Math.round((used / window) * 100))
      return `${pct}%`
    }
    if (tokenCount != null && tokenCount > 0) return formatNumber(tokenCount)
    return null
  }, [menuForSession, tokenCount, t])

  const memoryTrigger = memoryChip ? (
    <button
      type="button"
      className={`session-statusline-action${memoryChip.on ? '' : ' is-muted'}${memoryChip.autoSaveOff ? ' is-warn' : ''}`}
      aria-label={t('Memory')}
      title={memoryChip.title}
    >
      <IconBrain size={14} stroke={1.7} aria-hidden />
      <span className="session-statusline-action-val">{memoryChip.label}</span>
    </button>
  ) : null

  const contextTrigger = (
    <button
      type="button"
      className={`session-statusline-action${menuForSession?.isCompacting ? ' is-busy' : ''}`}
      aria-label={t('Context')}
      title={t('Context & compact')}
    >
      <IconFileZip size={13} stroke={1.7} aria-hidden />
      <span className="session-statusline-action-val">{contextLabel ?? t('Context')}</span>
    </button>
  )

  const cacheSegment = useMemo(() => {
    if (compact || !metrics || !hasUsage) return null
    if (metrics.totalCachedInputTokens > 0) {
      const hitRatePercent = Math.round(metrics.cacheHitRate * 100)
      return {
        label: hitRatePercent > 0 ? `cache ${hitRatePercent}%` : 'cache',
        title: `${t('Cached tokens')}: ${formatNumber(metrics.totalCachedInputTokens)} · ${t('Cache hit rate')}: ${hitRatePercent}%`,
      }
    }
    return null
  }, [compact, metrics, hasUsage, t])

  const tokSegment = (
    <button type="button" className="session-statusline-tok" aria-label={t('Estimated Token Usage')}>
      <span className="session-statusline-key">tok</span>
      <span className="session-statusline-val">
        {hasUsage && metrics
          ? formatNumber(totalTokens)
          : menuForSession
            ? formatNumber(menuForSession.totalTokens)
            : '—'}
        {hasUsage && metrics && (
          <span className="session-statusline-muted">
            {' '}
            ↑{formatNumber(metrics.totalInputTokens)} ↓{formatNumber(metrics.totalOutputTokens)}
          </span>
        )}
      </span>
    </button>
  )

  return (
    <div
      className={`session-statusline${empty ? ' is-empty' : ''}${compact ? ' is-compact' : ''}`}
      role="status"
      aria-live="polite"
    >
      <Flex
        className="session-statusline-inner"
        align="center"
        justify={compact ? 'flex-start' : 'space-between'}
        gap="sm"
        wrap={compact ? 'nowrap' : 'wrap'}
      >
        <Flex align="center" gap={7} miw={0} className="min-w-0 flex-1">
          <span className={`session-statusline-dot ${generating ? 'is-live' : ''}`} aria-hidden />
          <Text className="session-statusline-model min-w-0" lineClamp={1} title={modelTitle}>
            {modelTitle}
          </Text>
          <Text
            className={`session-statusline-live shrink-0${generating ? '' : ' is-idle'}`}
            size="xs"
            aria-hidden={!generating}
          >
            {t('Thinking…')}
          </Text>
        </Flex>

        {!compact && !empty && (
          <Flex align="center" gap={2} className="session-statusline-meta shrink-0">
            {planSegment && (
              <ProviderUsagePopover status={planSegment.status}>
                <button
                  type="button"
                  className={`session-statusline-action session-statusline-plan ${planSegment.tone}`}
                  title={t('Provider plan & usage')}
                >
                  <span className="session-statusline-action-val">{planSegment.label}</span>
                </button>
              </ProviderUsagePopover>
            )}

            {memoryChip && memoryTrigger && (
              <MemoryDockPopover
                label={memoryChip.label}
                on={memoryChip.on}
                title={memoryChip.title}
                trigger={memoryTrigger}
                onInsertMemory={onInsertMemory}
                getMemorySaveContent={getMemorySaveContent}
                memoryAutoSave={memoryAutoSave}
                onMemoryAutoSaveChange={sessionId ? handleMemoryAutoSaveChange : undefined}
              />
            )}

            {menuForSession ? (
              <TokenCountMenu
                currentInputTokens={menuForSession.currentInputTokens}
                contextTokens={menuForSession.contextTokens}
                totalTokens={menuForSession.totalTokens}
                isCalculating={menuForSession.isCalculating}
                pendingTasks={menuForSession.pendingTasks}
                totalContextMessages={menuForSession.totalContextMessages}
                contextWindow={menuForSession.contextWindow}
                currentMessageCount={menuForSession.currentMessageCount}
                maxContextMessageCount={menuForSession.maxContextMessageCount}
                onCompressClick={menuForSession.onCompressClick}
                autoCompactionEnabled={menuForSession.autoCompactionEnabled}
                isCompacting={menuForSession.isCompacting}
                contextWindowKnown={menuForSession.contextWindowKnown}
                onAutoCompactionChange={menuForSession.onAutoCompactionChange}
              >
                {contextTrigger}
              </TokenCountMenu>
            ) : (
              <Tooltip
                label={
                  hasUsage && metrics
                    ? `${t('Input')}: ${formatNumber(metrics.totalInputTokens)} · ${t('Output')}: ${formatNumber(metrics.totalOutputTokens)}`
                    : t('No token usage yet')
                }
                withArrow
                openDelay={400}
              >
                <Text className="session-statusline-seg">{tokSegment}</Text>
              </Tooltip>
            )}

            {cacheSegment && (
              <Tooltip label={cacheSegment.title} withArrow openDelay={400}>
                <Text className="session-statusline-seg">
                  <span className="session-statusline-key">cache</span>
                  <span className="session-statusline-val">{cacheSegment.label.replace(/^cache\s*/i, '') || '—'}</span>
                </Text>
              </Tooltip>
            )}

            {CHATBOX_BUILD_PLATFORM !== 'android' && metrics && hasUsage && metrics.actualCost > 0 && (
              <Tooltip label={t('Session cost estimate')} withArrow openDelay={400}>
                <Text className="session-statusline-seg">
                  <span className="session-statusline-val">{formatCost(metrics.actualCost)}</span>
                </Text>
              </Tooltip>
            )}
          </Flex>
        )}

        {/* Empty threads: only memory dock if available */}
        {!compact && empty && memoryChip && memoryTrigger && (
          <MemoryDockPopover
            label={memoryChip.label}
            on={memoryChip.on}
            title={memoryChip.title}
            trigger={memoryTrigger}
            onInsertMemory={onInsertMemory}
            getMemorySaveContent={getMemorySaveContent}
            memoryAutoSave={memoryAutoSave}
            onMemoryAutoSaveChange={sessionId ? handleMemoryAutoSaveChange : undefined}
          />
        )}
      </Flex>
    </div>
  )
}

export default SessionStatusBar
