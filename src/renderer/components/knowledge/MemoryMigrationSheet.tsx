import { t } from 'i18next'
import { useEffect, useMemo, useState } from 'react'
import { Sheet } from '@/components/ui/Sheet'
import { getLogger } from '@/lib/utils'
import {
  applyMemoryMigration,
  loadMigrationRows,
  loadMigrationState,
  type MigrationChoice,
  type MigrationRow,
} from '@/packages/knowledge/migration'
import { useGuarded } from '@/packages/knowledge/review/useGuarded'

const log = getLogger('knowledge')

type Group = { key: string; title: string; agentName?: string; promptEditable: boolean; rows: number[] }

function groupRows(rows: MigrationRow[]): Group[] {
  const groups = new Map<string, Group>()
  rows.forEach((row, i) => {
    const key = row.group.scope === 'global' ? 'global' : `agent:${row.group.agentId}`
    let group = groups.get(key)
    if (!group) {
      group =
        row.group.scope === 'global'
          ? { key, title: t('Saved for every chat'), promptEditable: false, rows: [] }
          : {
              key,
              title: t('Saved for {{agent}}', { agent: row.group.agentName }),
              agentName: row.group.agentName,
              promptEditable: row.group.promptEditable,
              rows: [],
            }
      groups.set(key, group)
    }
    group.rows.push(i)
  })
  // Every-chat notes first, then each agent in the order the banks came.
  return [...groups.values()].sort((a, b) => Number(b.key === 'global') - Number(a.key === 'global'))
}

function ChoiceRow({
  row,
  group,
  onChange,
}: {
  row: MigrationRow
  group: Group
  onChange: (choice: MigrationChoice) => void
}) {
  const choices: Array<{ value: MigrationChoice; label: string; disabled?: boolean }> = [
    { value: 'everywhere', label: t('Everywhere') },
    ...(group.agentName !== undefined
      ? [
          {
            value: 'agent-prompt' as const,
            label: t("{{agent}}'s prompt", { agent: group.agentName }),
            disabled: !group.promptEditable,
          },
        ]
      : []),
    { value: 'leave-out', label: t('Leave out') },
  ]
  return (
    <li className="dg-item" style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
      <span className="dg-item__text">{row.text}</span>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={row.text}>
        {choices.map((c) => (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={row.choice === c.value}
            disabled={c.disabled}
            className={row.choice === c.value ? 'dg-chip dg-chip--blue' : 'dg-chip'}
            onClick={() => onChange(c.value)}
          >
            {c.label}
          </button>
        ))}
      </div>
    </li>
  )
}

/** Once per launch until done: asks where each old memory note goes, then moves them (Task 10). */
export function MemoryMigrationSheet() {
  const [rows, setRows] = useState<MigrationRow[] | null>(null)
  const [opened, setOpened] = useState(false)
  const { busy, run } = useGuarded()

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        if ((await loadMigrationState()) !== 'pending') return
        const planned = await loadMigrationRows()
        if (!alive || planned.length === 0) return
        setRows(planned)
        setOpened(true)
      } catch (error) {
        log.error('Could not check for saved notes to move:', error)
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  const groups = useMemo(() => (rows ? groupRows(rows) : []), [rows])
  if (!rows) return null
  const n = rows.filter((r) => r.choice !== 'leave-out').length

  const choose = (index: number, choice: MigrationChoice) =>
    setRows((prev) => prev?.map((r, i) => (i === index ? { ...r, choice } : r)) ?? prev)

  const later = () => setOpened(false)
  const move = () =>
    run(async () => {
      const counts = await applyMemoryMigration(rows)
      setOpened(false)
      if (counts.everywhere + counts.prompts === 0) return
      const toastActions = await import('@/stores/toastActions')
      toastActions.add(
        t('Moved {{count}} notes to Everywhere and {{b}} to agent prompts', {
          count: counts.everywhere,
          b: counts.prompts,
        })
      )
    })

  return (
    <Sheet
      opened={opened}
      onClose={later}
      title={t('Choose where your saved notes go')}
      actions={
        <>
          <button type="button" className="dg-btn dg-btn--ghost" onClick={later} disabled={busy}>
            {t('Later')}
          </button>
          <button type="button" className="dg-btn dg-btn--primary" onClick={move} disabled={busy}>
            {n === 0 ? t('Finish') : t('Move {{count}} notes', { count: n })}
          </button>
        </>
      }
    >
      <p className="dg-type-body" style={{ margin: 0 }}>
        {t(
          'Dango now keeps knowledge per scope, plus Everywhere for what applies to all of them. Pick a place for each note. Nothing is deleted.'
        )}
      </p>
      <div className="flex flex-col gap-3" style={{ overflowY: 'auto', maxHeight: '60vh' }}>
        {groups.map((group) => {
          const headingId = `dango-migration-${group.key}`
          return (
            <section key={group.key} role="group" aria-labelledby={headingId}>
              <h3 id={headingId} className="dg-type-headline" style={{ margin: 0 }}>
                {group.title}
              </h3>
              {group.agentName !== undefined && !group.promptEditable ? (
                <p className="dg-type-caption" style={{ margin: 0, color: 'var(--dango-muted)' }}>
                  {t("Built-in agents can't take notes in their prompt.")}
                </p>
              ) : null}
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {group.rows.map((i) => (
                  <ChoiceRow key={`${group.key}:${i}`} row={rows[i]} group={group} onChange={(c) => choose(i, c)} />
                ))}
              </ul>
            </section>
          )
        })}
      </div>
    </Sheet>
  )
}
