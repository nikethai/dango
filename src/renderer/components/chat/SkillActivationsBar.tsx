import type { SkillActivation } from '@shared/types'
import { IconSparkles } from '@tabler/icons-react'
import { memo, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'

export interface SkillActivationsBarProps {
  activations: SkillActivation[]
  className?: string
}

/**
 * Honest mode labels:
 * - tagged: user forced with $
 * - pinned: session sticky
 * - matched: host auto-selected (procedure was available — model may not follow every step)
 */
const MODE_LABEL: Record<SkillActivation['mode'], string> = {
  explicit: 'added',
  session: 'pinned',
  auto: 'suggested',
}

const MODE_TITLE: Record<SkillActivation['mode'], string> = {
  explicit: 'You added this skill',
  session: 'Pinned for this chat',
  auto: 'Suggested from your message — available, not guaranteed to follow every step',
}

/**
 * Compact meta row under assistant content.
 * Explicit/session read as "Using"; auto-only as "Suggested" so false confidence is lower.
 */
function SkillActivationsBar({ activations, className }: SkillActivationsBarProps) {
  const { t } = useTranslation()
  const hasForced = activations.some((a) => a.mode === 'explicit' || a.mode === 'session')
  const label = hasForced ? t('Using skills') : t('Suggested skills')

  const ordered = useMemo(() => {
    const rank = { explicit: 0, session: 1, auto: 2 } as const
    return [...activations].sort((a, b) => rank[a.mode] - rank[b.mode] || a.name.localeCompare(b.name))
  }, [activations])

  if (!activations.length) return null

  return (
    <div
      className={cn('skill-activations', !hasForced && 'skill-activations--suggested', className)}
      role="group"
      aria-label={label}
    >
      <span className="skill-activations-label" title={label}>
        <IconSparkles size={12} stroke={1.75} className="skill-activations-icon" aria-hidden />
        <span>{label}</span>
      </span>
      <ul className="skill-activations-list">
        {ordered.map((act, index) => (
          <li
            key={`${act.skillId}-${act.mode}`}
            className={cn('skill-chip', `skill-chip--${act.mode}`)}
            style={{ animationDelay: `${index * 70}ms` }}
            title={t(MODE_TITLE[act.mode])}
          >
            <span className="skill-chip-name">{act.name.replace(/^\$+/, '')}</span>
            <span className="skill-chip-mode">{t(MODE_LABEL[act.mode])}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default memo(SkillActivationsBar)
