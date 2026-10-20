import { getProviderDefinition } from '@shared/providers/registry'
import { IconChevronRight } from '@tabler/icons-react'
import { type JSX, type MouseEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { resolveAgentMeta } from '@/packages/agents'
import { type SwarmAgentRow, type SwarmRun, swarmSummaryLabel } from './foldSwarmRuns'
import './swarm.css'

function agentName(row: SwarmAgentRow): string {
  if (row.name && row.name !== row.agentId) return row.name
  const meta = resolveAgentMeta(row.agentId)
  return meta && !meta.isFallback ? meta.name : row.name
}

function providerName(provider: string): string {
  return getProviderDefinition(provider)?.name ?? provider
}

/** "Worked with N agents · R rounds · T tokens ›" under a Swarm answer, closed until clicked (CH4). */
export function SwarmWorkedWith(props: { run: SwarmRun }): JSX.Element {
  const { run } = props
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)

  const onToggle = (event: MouseEvent) => {
    event.preventDefault()
    setOpen((v) => !v)
  }

  return (
    <div className="dg-swarm-worked">
      {run.stoppedEarly ? <div className="dg-type-caption dg-swarm-worked__stopped">{t('Stopped early')}</div> : null}
      <details open={open}>
        <summary className="dg-tool dg-swarm-worked__summary" onClick={onToggle}>
          <span>{swarmSummaryLabel(run)}</span>
          <IconChevronRight className="dg-swarm-worked__chevron" size={14} stroke={1.75} aria-hidden />
        </summary>
        {open ? (
          <ul className="dg-swarm-worked__rows">
            {run.agents.map((row) => (
              <li key={row.agentId} className="dg-swarm-worked__row">
                <div className="dg-type-callout">
                  <span className="dg-swarm-worked__name">{agentName(row)}</span>
                  {row.captain ? <span className="dg-swarm-worked__muted"> · {t('captain')}</span> : null}
                </div>
                {row.provider || row.model ? (
                  <div className="dg-type-caption dg-swarm-worked__model">
                    {[row.provider ? providerName(row.provider) : null, row.model].filter(Boolean).join(' · ')}
                  </div>
                ) : null}
                {row.contribution.length > 0 ? (
                  <div className="dg-type-caption dg-swarm-worked__muted">{row.contribution.join('; ')}</div>
                ) : null}
              </li>
            ))}
          </ul>
        ) : null}
      </details>
    </div>
  )
}
