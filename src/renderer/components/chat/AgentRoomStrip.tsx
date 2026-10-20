import { ActionIcon, Text, Tooltip } from '@mantine/core'
import type { AgentDetail } from '@shared/types'
import { IconX } from '@tabler/icons-react'
import { memo, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMyCopilots, useRemoteCopilots } from '@/hooks/useCopilots'
import { cn } from '@/lib/utils'
import {
  getTeamRoomLive,
  subscribeTeamRoomState,
  type TeamRoomLiveStatus,
} from '@/stores/session/team-room-state'

export interface AgentRoomStripProps {
  agentIds: string[]
  sessionId?: string
  onRemove?(agentId: string): void
  className?: string
  /** When true, omit outer padding (parent provides composer-meta-stack inset) */
  embedded?: boolean
}

function AgentRoomStrip({ agentIds, sessionId, onRemove, className, embedded }: AgentRoomStripProps) {
  const { t } = useTranslation()
  const { copilots: myAgents } = useMyCopilots()
  const { copilots: remoteAgents } = useRemoteCopilots()
  const [live, setLive] = useState<TeamRoomLiveStatus>(() => getTeamRoomLive())

  useEffect(() => {
    return subscribeTeamRoomState(() => setLive(getTeamRoomLive()))
  }, [])

  const members = useMemo(() => {
    const byId = new Map<string, AgentDetail>()
    for (const a of [...myAgents, ...(remoteAgents || [])]) {
      byId.set(a.id, a)
    }
    return agentIds.map((id) => byId.get(id)).filter((a): a is AgentDetail => Boolean(a))
  }, [agentIds, myAgents, remoteAgents])

  if (members.length === 0) return null

  const liveForSession = sessionId && live?.sessionId === sessionId ? live : null
  const statusText = liveForSession ? formatLiveStatus(liveForSession, t) : null

  return (
    <div className={cn(embedded ? 'composer-meta-row' : 'composer-meta-row px-4 py-1', className)}>
      <span className="composer-meta-label">{t('In this chat')}:</span>
      {members.map((agent) => (
        <span
          key={agent.id}
          className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 max-w-full min-w-0"
          style={{
            background: 'var(--chatbox-background-secondary)',
            border: '1px solid var(--chatbox-border-primary)',
          }}
        >
          <Text size="xs" component="span" className="shrink-0">
            {agent.emojiAvatar || '🤖'}
          </Text>
          <Text size="xs" fw={500} className="max-w-[120px] truncate" component="span">
            {agent.name}
          </Text>
          {onRemove ? (
            <Tooltip label={t('Remove from room')}>
              <ActionIcon
                size="xs"
                variant="subtle"
                color="gray"
                onClick={() => onRemove(agent.id)}
                aria-label={t('Remove from room')}
                className="shrink-0"
              >
                <IconX size={12} />
              </ActionIcon>
            </Tooltip>
          ) : null}
        </span>
      ))}
      <span className="composer-meta-label shrink-0">· {t('You')}</span>
      {statusText ? (
        <Text size="xs" c="chatbox-brand" fw={500} className="min-w-0">
          {statusText}
        </Text>
      ) : null}
    </div>
  )
}

function formatLiveStatus(live: NonNullable<TeamRoomLiveStatus>, t: (k: string) => string): string | null {
  // A Swarm run shows its progress in the thread's Swarm card, not here.
  if (live.mode === 'swarm') return null
  const who = live.speakerName || t('Agent')
  if (live.phase === 'turn' && live.round) {
    const total = live.totalRounds ? `/${live.totalRounds}` : ''
    return `${t('Round')} ${live.round}${total} · ${who} ${t('speaking…')}`
  }
  if (live.phase === 'plan') return `${t('Plan')} · ${who}`
  if (live.phase === 'do') return `${t('Working')} · ${who}`
  if (live.phase === 'review') return `${t('Review')} · ${who}`
  if (live.phase === 'deliver') return `${t('Deliverable')} · ${who}`
  if (live.phase === 'synthesis') return `${t('Team answer')} · ${who}`
  return `${who} ${t('speaking…')}`
}

export default memo(AgentRoomStrip)
