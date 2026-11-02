import { Box, Text } from '@mantine/core'
import type { AgentDetail } from '@shared/types'
import { memo, type RefObject, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { navigateToSettings } from '@/modals/Settings'
import { fuzzyScoreAgent } from '@/packages/agents'
import ComposerPickerPanel from './ComposerPickerPanel'

/** Short product blurb — never dump the full system prompt. */
export function agentPickerBlurb(agent: AgentDetail): string {
  if (agent.demoQuestion?.trim()) {
    return agent.demoQuestion.trim().replace(/\s+/g, ' ').slice(0, 90)
  }
  let p = (agent.prompt || '').trim().replace(/\s+/g, ' ')
  if (!p) return ''
  p = p
    .replace(/^you are [^,.\n]{1,80}[,.]?\s*/i, '')
    .replace(/^i want you to act as (an?|the)\s+[^,.\n]{1,80}[,.]?\s*/i, '')
    .replace(/^please (acknowledge|respond)[^.!?\n]{0,120}[.!?]?\s*/i, '')
  if (!p) return ''
  if (p.length <= 72) return p
  const cut = p.slice(0, 72)
  const sp = cut.lastIndexOf(' ')
  return `${sp > 36 ? cut.slice(0, sp) : cut}…`
}

/** 2 when the name starts with the query, 1 when the name holds it, 0 for a blurb or fuzzy match. */
function nameMatchTier(name: string, query: string): number {
  if (!query) return 0
  const lower = name.toLowerCase()
  if (lower.startsWith(query)) return 2
  return fuzzyScoreAgent(name, query) >= 80 ? 1 : 0
}

/** Agents matching `query`, name matches first: `@Task` picks Task Planner, not an agent whose blurb mentions a task. */
export function filterAgents(agents: AgentDetail[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  return agents
    .map((agent) => {
      const haystack = [agent.name, agentPickerBlurb(agent)].join(' ')
      return {
        agent,
        tier: nameMatchTier(agent.name, normalizedQuery),
        score: fuzzyScoreAgent(haystack, normalizedQuery),
      }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.tier - a.tier || b.score - a.score || a.agent.name.localeCompare(b.agent.name))
    .map((item) => item.agent)
}

export interface AgentPickerProps {
  agents: AgentDetail[]
  highlightedIndex: number
  onHighlightChange(index: number): void
  onSelect(agent: AgentDetail): void
  query: string
  excludeIds?: string[]
  anchorRef: RefObject<HTMLElement | null>
}

function AgentPicker({
  agents,
  highlightedIndex,
  onHighlightChange,
  onSelect,
  query,
  excludeIds = [],
  anchorRef,
}: AgentPickerProps) {
  const { t } = useTranslation()
  const available = useMemo(() => {
    const exclude = new Set(excludeIds)
    return agents.filter((a) => !exclude.has(a.id))
  }, [agents, excludeIds])

  const filtered = useMemo(() => filterAgents(available, query).slice(0, 8), [available, query])
  const catalogEmpty = available.length === 0
  const isEmpty = filtered.length === 0

  useEffect(() => {
    if (filtered.length === 0) return
    if (highlightedIndex >= filtered.length) {
      onHighlightChange(0)
    }
  }, [filtered.length, highlightedIndex, onHighlightChange])

  return (
    <ComposerPickerPanel
      anchorRef={anchorRef}
      open
      aria-label={t('Assistants')}
      header={
        <Text size="xs" fw={600} c="chatbox-secondary">
          {t('Assistants')}
        </Text>
      }
      isEmpty={isEmpty}
      empty={
        catalogEmpty
          ? {
              title: t('No assistants yet'),
              description: t('Create a persona with its own style and tools, then mention it with @.'),
              action: {
                label: t('Create assistant'),
                onClick: () => navigateToSettings('/agents'),
              },
            }
          : {
              title: t('No match'),
            }
      }
    >
      {filtered.map((agent, index) => {
        const selected = index === highlightedIndex
        const blurb = agentPickerBlurb(agent)
        return (
          <Box
            key={agent.id}
            px="sm"
            py="xs"
            className="composer-picker-row cursor-pointer"
            data-selected={selected || undefined}
            bg={selected ? 'var(--chatbox-background-brand-secondary)' : undefined}
            onMouseEnter={() => onHighlightChange(index)}
            onMouseDown={(event) => {
              event.preventDefault()
              onSelect(agent)
            }}
          >
            <div className="flex items-start gap-2.5">
              <Text size="sm" className="shrink-0 leading-none mt-0.5" aria-hidden>
                {agent.emojiAvatar || '🤖'}
              </Text>
              <div className="min-w-0">
                <Text size="sm" fw={600} className="truncate" c={selected ? 'chatbox-brand' : 'chatbox-primary'}>
                  {agent.name}
                </Text>
                {blurb ? (
                  <Text size="xs" c="chatbox-tertiary" lineClamp={1} className="mt-0.5">
                    {blurb}
                  </Text>
                ) : null}
              </div>
            </div>
          </Box>
        )
      })}
    </ComposerPickerPanel>
  )
}

export default memo(AgentPicker)
