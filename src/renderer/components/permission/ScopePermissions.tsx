import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { alwaysAsks, offersReadOnlyCommandGrant, toolLabel } from '@/packages/tool-permission'
import { pushUndo } from '@/packages/undo'
import { add as addToast } from '@/stores/toastActions'
import { getScopeGrant, type ScopeToolGrant, toolApprovalStore, useScopeGrants } from '@/stores/toolApprovalStore'

/** Tools this scope runs without asking ("Always" grants), with a way to stop each one. */
export function ScopePermissions({ scopeId }: { scopeId: string }) {
  const { t } = useTranslation()
  const headingId = useId()
  // Grants for tools that always ask (older grants for command tools) are ignored by the gate, so not listed. Older
  // grants have no stored description; their name alone decides. A shell tool's read-only command grant is listed.
  const grants = useScopeGrants(scopeId).filter((grant) =>
    grant.readOnlyCommands
      ? offersReadOnlyCommandGrant(grant.toolName, grant.toolDescription)
      : !alwaysAsks(grant.toolName, grant.toolDescription)
  )

  const stopAllowing = (grant: ScopeToolGrant) => {
    const label = toolLabel(grant.toolName)
    if (!toolApprovalStore.getState().revokeScopeGrant(scopeId, grant.toolName)) {
      // Stopped in this window, but the saved grant is unchanged; undo would not be honest here.
      addToast(
        t(
          "Couldn't save this change. “{{label}}” may be allowed again after Dango restarts. Free up some disk space and try again.",
          { label }
        )
      )
      return
    }
    pushUndo({
      message: t('Dango will ask before “{{label}}” again.', { label }),
      undo: () => {
        // The user may have chosen Always again within the undo window; keep that newer grant.
        if (getScopeGrant(scopeId, grant.toolName)) return
        toolApprovalStore.getState().addScopeGrant(scopeId, grant)
      },
      group: 'other',
    })
  }

  return (
    <section aria-labelledby={headingId} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 id={headingId} className="dg-type-headline">
        {t('Allowed without asking')}
      </h3>
      <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
        {t('Dango does these in this scope without asking. Sending and deleting always ask.')}
      </span>
      {grants.length === 0 ? (
        <span className="dg-type-body" style={{ color: 'var(--dango-muted)' }}>
          {t('Nothing yet. When you choose Always in this scope, it shows here.')}
        </span>
      ) : (
        <ul style={{ display: 'flex', flexDirection: 'column', gap: 8, margin: 0, padding: 0, listStyle: 'none' }}>
          {grants.map((grant) => (
            <li
              key={grant.toolName}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                <span className="dg-type-body" style={{ overflowWrap: 'anywhere' }}>
                  {toolLabel(grant.toolName)}
                </span>
                {grant.readOnlyCommands ? (
                  <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
                    {t('Read-only commands only')}
                  </span>
                ) : null}
                {grant.grantedAt > 0 ? (
                  <span className="dg-type-caption" style={{ color: 'var(--dango-muted)' }}>
                    {t('Since {{date}}', { date: new Date(grant.grantedAt).toLocaleDateString() })}
                  </span>
                ) : null}
              </div>
              <button type="button" className="dg-btn dg-btn--ghost" onClick={() => stopAllowing(grant)}>
                {t('Stop allowing')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
