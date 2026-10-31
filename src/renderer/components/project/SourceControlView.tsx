import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import platform from '@/platform'

type ChangeRow = { changeId: string; status: string; label: string }

/** Workspace errors arrive as `CODE: detail`; people see a sentence, never the code. */
function sourceControlErrorText(message: string, t: (key: string) => string): string {
  const code = /^([A-Z][A-Z_]*):/.exec(message)?.[1]
  if (code === 'FEATURE_DISABLED' || code === 'SCM_DISABLED') return t("Source Control isn't available yet.")
  return t("Couldn't load Source Control. Try again later.")
}

export function SourceControlView({ capabilityId }: { capabilityId: string }) {
  const { t } = useTranslation()
  const [branch, setBranch] = useState<string>('')
  const [changes, setChanges] = useState<ChangeRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!platform.getSourceControlStatus) {
      setError(t('Source Control is unavailable on this platform.'))
      return
    }
    let cancelled = false
    void platform
      .getSourceControlStatus(capabilityId)
      .then((raw) => {
        if (cancelled) return
        const status = raw as { branch?: string; changes?: ChangeRow[]; state?: string }
        setBranch(status.branch || '')
        setChanges(status.changes || [])
      })
      .catch((err: Error) => {
        if (!cancelled) setError(sourceControlErrorText(err?.message ?? '', t))
      })
    return () => {
      cancelled = true
    }
  }, [capabilityId, t])

  return (
    <section aria-label={t('Source Control')} className="source-control-view">
      {error ? <p>{error}</p> : null}
      {branch ? (
        <p>
          {t('Branch')}: {branch}
        </p>
      ) : null}
      <ul>
        {changes.map((change) => (
          <li key={change.changeId}>
            {change.status} {change.label}
          </li>
        ))}
      </ul>
    </section>
  )
}
