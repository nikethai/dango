import type { ReactNode } from 'react'

/** Quiet explanatory block used by scope tab placeholders and empty states. */
export function ScopeEmpty({ text, heading, children }: { text: string; heading?: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-start gap-3 py-6" style={{ maxWidth: 520 }}>
      {heading ? <h2 style={{ fontSize: '1.125rem', fontWeight: 600, margin: 0 }}>{heading}</h2> : null}
      <p style={{ margin: 0, color: 'var(--dango-muted)' }}>{text}</p>
      {children ? <div className="flex gap-2">{children}</div> : null}
    </div>
  )
}
