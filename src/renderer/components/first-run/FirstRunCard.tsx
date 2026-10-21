import { type ReactNode, useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Mascot } from '@/components/brand/Mascot'
import type { FirstRunStep } from '@/packages/first-run'

const STEPS: FirstRunStep[] = [1, 2, 3, 4, 5]

/** The centred card every first-run step renders in: mascot, five progress dots, title, lead, body, footer. */
export function FirstRunCard({
  step,
  title,
  lead,
  children,
  footer,
}: {
  step: FirstRunStep
  title: string
  lead?: string
  children: ReactNode
  footer: ReactNode
}) {
  const { t } = useTranslation()
  const titleId = useId()
  // A step change unmounts the control that moved on (Continue, Skip), dropping focus to the body. Start the new step
  // at its title, unless the step already put focus somewhere (its effects run first).
  const titleRef = useRef<HTMLHeadingElement>(null)
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each step change, by design
  useEffect(() => {
    const active = document.activeElement
    if (!active || active === document.body) titleRef.current?.focus()
  }, [step])
  return (
    <section className="dg dg-first-run__card" aria-labelledby={titleId}>
      <div className="dg-first-run__header">
        {/* Decorative: the idle mascot would otherwise read "Assistant, idle" before the heading. */}
        <span className="dg-first-run__mascot" aria-hidden="true">
          <Mascot state="idle" size={40} />
        </span>
        <div className="dg-first-run__dots" role="img" aria-label={t('Step {{n}} of 5', { n: step })}>
          {STEPS.map((s) => (
            <span key={s} className={s <= step ? 'dg-first-run__dot is-done' : 'dg-first-run__dot'} />
          ))}
        </div>
      </div>
      <h1 ref={titleRef} id={titleId} tabIndex={-1} className="dg-first-run__title">
        {title}
      </h1>
      {lead ? <p className="dg-type-body dg-first-run__lead">{lead}</p> : null}
      <div className="dg-first-run__body">{children}</div>
      <div className="dg-first-run__footer">{footer}</div>
    </section>
  )
}
