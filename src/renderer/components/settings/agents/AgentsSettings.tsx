import { Button, Switch } from '@mantine/core'
import { IconPencil, IconPlus, IconStar, IconStarFilled, IconTrash } from '@tabler/icons-react'
import { useNavigate } from '@tanstack/react-router'
import type React from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { v4 as uuidv4 } from 'uuid'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { SettingsCard } from '@/components/settings/SettingsCard'
import { SettingsPageHeader } from '@/components/settings/SettingsPageHeader'
import { SettingsPrefRow } from '@/components/settings/SettingsPrefRow'
import { SettingsSection } from '@/components/settings/SettingsSection'
import { useMyCopilots, useRemoteCopilots } from '@/hooks/useCopilots'
import { trackingEvent } from '@/packages/event'
import * as remote from '@/packages/remote'
import platform from '@/platform'
import { useUIStore } from '@/stores/uiStore'
import '@/static/agents-surfaces.css'
import type { AgentDetail } from '../../../../shared/types'
import { AgentForm } from './AgentForm'

/** Copilots management UI — embedded in Settings (no full Page chrome). */
export function AgentsSettings() {
  const showCopilotsInNewSession = useUIStore((s) => s.showCopilotsInNewSession)
  const setShowCopilotsInNewSession = useUIStore((s) => s.setShowCopilotsInNewSession)
  const navigate = useNavigate()

  const { t } = useTranslation()

  const store = useMyCopilots()
  const { copilots: remoteCopilots } = useRemoteCopilots()

  const selectAgent = (detail: AgentDetail) => {
    const newDetail = { ...detail, usedCount: (detail.usedCount || 0) + 1 }
    if (newDetail.shared) {
      remote.recordCopilotShare(newDetail)
    }
    store.addOrUpdate(newDetail)

    navigate({
      to: '/new',
      search: {
        copilotId: detail.id,
      },
    })
  }

  const [agentEdit, setAgentEdit] = useState<AgentDetail | null>(null)
  useEffect(() => {
    trackingEvent('copilot_window', { event_category: 'screen_view' })
  }, [])

  const list = [
    ...store.copilots.filter((item) => item.starred).sort((a, b) => b.usedCount - a.usedCount),
    ...store.copilots.filter((item) => !item.starred).sort((a, b) => b.usedCount - a.usedCount),
  ]

  return (
    <div className="agents-page">
      {agentEdit ? (
        <AgentForm
          agent={agentEdit}
          close={() => {
            setAgentEdit(null)
          }}
          save={(detail) => {
            store.addOrUpdate(detail)
            setAgentEdit(null)
          }}
        />
      ) : (
        <>
          <SettingsPageHeader
            title={t('Agents')}
            description={t(
              'Saved agents: a name, a prompt, model settings, tool access, steps and hooks. Mention one with @ in the composer.'
            )}
            actions={
              <Button
                variant="default"
                leftSection={<ScalableIcon icon={IconPlus} size={18} />}
                onClick={() => {
                  void getEmptyAgent().then(setAgentEdit)
                }}
              >
                {t('New agent')}
              </Button>
            }
          />

          <SettingsSection title={t('Preferences')}>
            <SettingsCard divided>
              <SettingsPrefRow
                title={t('Show agents in a new chat')}
                description={t('Show agent shortcuts when starting a blank chat.')}
                control={
                  <Switch
                    checked={showCopilotsInNewSession}
                    onChange={(event) => setShowCopilotsInNewSession(event.currentTarget.checked)}
                  />
                }
              />
            </SettingsCard>
          </SettingsSection>

          <SettingsSection title={t('Your agents')}>
            {list.length === 0 ? (
              <SettingsCard>
                <div className="agents-empty">{t('No agents yet. Create one, or add a featured agent below.')}</div>
              </SettingsCard>
            ) : (
              <div className="agents-grid">
                {list.map((item, ix) => (
                  <MiniItem
                    key={`${item.id}_${ix}`}
                    mode="local"
                    detail={item}
                    canDelete={!item.builtIn}
                    selectMe={() => selectAgent(item)}
                    switchStarred={() => {
                      store.addOrUpdate({
                        ...item,
                        starred: !item.starred,
                      })
                    }}
                    editMe={() => {
                      setAgentEdit(item)
                    }}
                    deleteMe={() => {
                      store.remove(item.id)
                    }}
                  />
                ))}
              </div>
            )}
          </SettingsSection>

          {!!remoteCopilots?.length && (
            <SettingsSection title={t('Featured agents')} description={t('Add one to your agents and open a chat.')}>
              <div className="agents-grid">
                {remoteCopilots.map((item, ix) => (
                  <MiniItem key={`${item.id}_${ix}`} mode="remote" detail={item} selectMe={() => selectAgent(item)} />
                ))}
              </div>
            </SettingsSection>
          )}
        </>
      )}
    </div>
  )
}

type MiniItemProps =
  | {
      mode: 'local'
      detail: AgentDetail
      canDelete?: boolean
      selectMe(): void
      switchStarred(): void
      editMe(): void
      deleteMe(): void
    }
  | {
      mode: 'remote'
      detail: AgentDetail
      selectMe(): void
    }

function MiniItem(props: MiniItemProps) {
  const { t } = useTranslation()

  const onSelect = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault()
    props.selectMe()
  }

  const stop = (event: React.MouseEvent) => {
    event.stopPropagation()
    event.preventDefault()
  }

  return (
    <button
      type="button"
      className={`agent-tile${props.mode === 'remote' ? ' agent-tile-remote' : ''}`}
      onClick={onSelect}
    >
      <span className="agent-tile-avatar">
        {props.detail.emojiAvatar ? (
          props.detail.emojiAvatar
        ) : props.detail.picUrl ? (
          <img src={props.detail.picUrl} alt="" />
        ) : (
          '✦'
        )}
      </span>
      <span className="agent-tile-name" title={props.detail.name}>
        {props.detail.name}
      </span>

      {props.mode === 'local' && (
        <span className="agent-tile-actions">
          <button
            type="button"
            className={`agent-tile-icon-btn${props.detail.starred ? ' is-starred' : ''}`}
            aria-label={props.detail.starred ? t('unstar') : t('star')}
            title={props.detail.starred ? t('unstar') : t('star')}
            onClick={(e) => {
              stop(e)
              props.switchStarred()
            }}
          >
            <ScalableIcon icon={props.detail.starred ? IconStarFilled : IconStar} size={16} />
          </button>
          <button
            type="button"
            className="agent-tile-icon-btn"
            aria-label={t('edit')}
            title={t('edit')}
            onClick={(e) => {
              stop(e)
              props.editMe()
            }}
          >
            <ScalableIcon icon={IconPencil} size={16} />
          </button>
          {props.canDelete !== false && (
            <button
              type="button"
              className="agent-tile-icon-btn"
              aria-label={t('delete')}
              title={t('delete')}
              onClick={(e) => {
                stop(e)
                if (window.confirm(t('Are you sure you want to delete this agent?'))) {
                  props.deleteMe()
                }
              }}
            >
              <ScalableIcon icon={IconTrash} size={16} />
            </button>
          )}
        </span>
      )}
    </button>
  )
}

export async function getEmptyAgent(): Promise<AgentDetail> {
  const conf = await platform.getConfig()
  return {
    id: `${conf.uuid}:${uuidv4()}`,
    name: '',
    picUrl: '',
    prompt: '',
    starred: false,
    usedCount: 0,
    shared: true,
  }
}
