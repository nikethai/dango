import { type JSX, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Mascot } from '@/components/brand/Mascot'
import { requestSwarmStop, swarmStopRoute, useSwarmLive } from '@/stores/session/team-room-state'
import { swarmLiveLabel } from './foldSwarmRuns'
import './swarm.css'

/**
 * The one card a running Swarm shows in the thread (CH3). With `runId`, it shows only while that run is the live one,
 * so an earlier run that stopped without an answer never looks live.
 */
export function SwarmLiveCard(props: { sessionId: string; runId?: string }): JSX.Element | null {
  const { sessionId, runId } = props
  const { t } = useTranslation()
  const live = useSwarmLive(sessionId)
  const [pressedRun, setPressedRun] = useState<string | null>(null)

  if (!live || (runId !== undefined && live.runId !== runId)) return null

  const liveRun = live.runId ?? ''
  const disabled = live.stopping || pressedRun === `${liveRun}:${live.phase === 'deliver' ? 'deliver' : 'board'}`

  const onStop = () => {
    // Same routing as the composer Stop: the first press stops the board and lets the captain answer; during the
    // captain's answer it is an ordinary stop; a press while that answer is still empty is ignored.
    const route = swarmStopRoute(sessionId)
    if (route === 'ignore') return
    setPressedRun(`${liveRun}:${live.phase === 'deliver' ? 'deliver' : 'board'}`)
    const stopping =
      route === 'swarm'
        ? requestSwarmStop(sessionId)
        : import('@/stores/session/stop-generation').then(({ stopChatIfRunning }) => stopChatIfRunning(sessionId))
    void Promise.resolve(stopping).catch((error) => console.error('Failed to stop the Swarm', error))
  }

  return (
    <div className="dg-swarm-live" data-run-id={live.runId}>
      <Mascot state="working" size={20} />
      <span className="dg-type-callout dg-swarm-live__label">{swarmLiveLabel(live)}</span>
      <button type="button" className="dg-btn" disabled={disabled} onClick={onStop}>
        {t('Stop')}
      </button>
    </div>
  )
}
