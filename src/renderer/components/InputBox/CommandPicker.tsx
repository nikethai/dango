import { Box, Text } from '@mantine/core'
import type { CommandPackage, SkillPackage } from '@shared/types'
import { Fragment, memo, type RefObject, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { navigateToSettings } from '@/modals/Settings'
import { filterSystemCommands, fuzzyScoreCommand, type SystemCommand } from '@/packages/commands'
import ComposerPickerPanel from './ComposerPickerPanel'
import { filterSkills } from './SkillPicker'

export function filterCommands(commands: CommandPackage[], query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  return commands
    .filter((c) => c.enabled)
    .map((command) => {
      const haystack = [command.name, command.description, ...(command.tags || [])].join(' ')
      return {
        command,
        score: fuzzyScoreCommand(haystack, normalizedQuery),
      }
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || a.command.name.localeCompare(b.command.name))
    .map((item) => item.command)
}

export type CommandPickerItem =
  | { kind: 'skill'; skill: SkillPackage }
  | { kind: 'system'; command: SystemCommand }
  | { kind: 'package'; command: CommandPackage }

const MAX_SKILLS = 5
const MAX_PACKAGE_COMMANDS = 8

function namesSystemCommandExactly(command: SystemCommand, query: string): boolean {
  const q = query.trim().toLowerCase()
  return q.length > 0 && (command.name === q || (command.aliases?.includes(q) ?? false))
}

/**
 * The / menu: up to 5 skills, then built-in commands, then up to 8 saved commands.
 * A built-in named exactly (`/rewrite`, `/compact` or an alias) goes first, so Enter still runs it.
 */
export function buildCommandPickerItems(
  query: string,
  packageCommands: CommandPackage[],
  options?: {
    excludePackageIds?: string[]
    includeSystem?: boolean
    skills?: SkillPackage[]
    excludeSkillIds?: string[]
  }
): CommandPickerItem[] {
  const exclude = new Set(options?.excludePackageIds ?? [])
  const available = packageCommands.filter((c) => c.enabled && !exclude.has(c.id))
  const excludeSkills = new Set(options?.excludeSkillIds ?? [])
  const skills = filterSkills(
    (options?.skills ?? []).filter((skill) => !excludeSkills.has(skill.id)),
    query
  )
    .slice(0, MAX_SKILLS)
    .map((skill) => ({ kind: 'skill' as const, skill }))
  const system =
    options?.includeSystem === false
      ? []
      : filterSystemCommands(query).map((command) => ({ kind: 'system' as const, command }))
  const packages = filterCommands(available, query)
    .slice(0, MAX_PACKAGE_COMMANDS)
    .map((command) => ({ kind: 'package' as const, command }))
  const exact = system.filter((item) => namesSystemCommandExactly(item.command, query))
  const otherSystem = system.filter((item) => !exact.includes(item))
  return [...exact, ...skills, ...otherSystem, ...packages]
}

export interface CommandPickerProps {
  commands: CommandPackage[]
  highlightedIndex: number
  onHighlightChange(index: number): void
  /** Package command selected (chip path). Prefer onSelectItem when system commands are shown. */
  onSelect(command: CommandPackage): void
  /** Unified select for system + package items */
  onSelectItem?(item: CommandPickerItem): void
  query: string
  excludeIds?: string[]
  /** Include built-ins like /compact (default true) */
  includeSystem?: boolean
  /** Skills listed above the commands; picking one goes through onSelectItem. */
  skills?: SkillPackage[]
  excludeSkillIds?: string[]
  anchorRef: RefObject<HTMLElement | null>
}

const EMPTY_SKILLS: SkillPackage[] = []
const EMPTY_IDS: string[] = []

function CommandPicker({
  commands,
  highlightedIndex,
  onHighlightChange,
  onSelect,
  onSelectItem,
  query,
  excludeIds = [],
  includeSystem = true,
  skills = EMPTY_SKILLS,
  excludeSkillIds = EMPTY_IDS,
  anchorRef,
}: CommandPickerProps) {
  const { t } = useTranslation()
  const items = useMemo(
    () =>
      buildCommandPickerItems(query, commands, {
        excludePackageIds: excludeIds,
        includeSystem,
        skills,
        excludeSkillIds,
      }),
    [commands, excludeIds, includeSystem, query, skills, excludeSkillIds]
  )
  const hasSkills = items.some((item) => item.kind === 'skill')
  const catalogEmpty = commands.filter((c) => c.enabled).length === 0 && items.length === 0
  const isEmpty = items.length === 0

  useEffect(() => {
    if (items.length === 0) return
    if (highlightedIndex >= items.length) {
      onHighlightChange(0)
    }
  }, [items.length, highlightedIndex, onHighlightChange])

  const handlePick = (item: CommandPickerItem) => {
    if (onSelectItem) {
      onSelectItem(item)
      return
    }
    if (item.kind === 'package') onSelect(item.command)
  }

  return (
    <ComposerPickerPanel
      anchorRef={anchorRef}
      open
      aria-label={t('Commands')}
      header={
        <Text size="xs" c="chatbox-tertiary">
          {t('Commands')} · /
        </Text>
      }
      isEmpty={isEmpty}
      empty={
        catalogEmpty
          ? {
              title: t('No commands yet'),
              description: t('Create commands, then run them with / in the composer. Built-in: /compact'),
              action: {
                label: t('Manage commands'),
                onClick: () => navigateToSettings('/commands'),
              },
            }
          : {
              title: t('No matching commands'),
            }
      }
    >
      {items.map((item, index) => {
        const selected = index === highlightedIndex
        const group = item.kind === 'skill' ? 'skills' : 'commands'
        const previous = index > 0 ? items[index - 1] : undefined
        const previousGroup = previous ? (previous.kind === 'skill' ? 'skills' : 'commands') : undefined
        // Group labels only when skills share the list; commands alone keep the panel header.
        const groupLabel =
          hasSkills && group !== previousGroup ? (group === 'skills' ? t('Skills') : t('Commands')) : null
        const key =
          item.kind === 'skill'
            ? `skill:${item.skill.id}`
            : item.kind === 'system'
              ? `system:${item.command.id}`
              : item.command.id
        const name = item.kind === 'skill' ? item.skill.name : `/${item.command.name}`
        const description =
          item.kind === 'skill'
            ? item.skill.description
            : item.kind === 'system'
              ? item.command.id === 'compact'
                ? t('Summarize older messages to free context space')
                : item.command.id === 'rewrite'
                  ? t('Rewrite text: clearer, friendlier, shorter, formal or translated')
                  : item.command.description
              : item.command.description
        return (
          <Fragment key={key}>
            {groupLabel ? (
              <div className="dg-picker-group dg-type-caption" role="presentation">
                {groupLabel}
              </div>
            ) : null}
            <Box
              px="sm"
              py="xs"
              className="composer-picker-row cursor-pointer"
              data-selected={selected || undefined}
              data-kind={item.kind}
              bg={selected ? 'var(--chatbox-background-brand-secondary)' : undefined}
              onMouseEnter={() => onHighlightChange(index)}
              onMouseDown={(e) => {
                e.preventDefault()
                handlePick(item)
              }}
            >
              <Text size="sm" fw={500}>
                {name}
                {item.kind === 'system' ? (
                  <Text span size="xs" c="chatbox-tertiary" ml={6}>
                    {t('Built-in')}
                  </Text>
                ) : null}
              </Text>
              <Text size="xs" c="chatbox-tertiary" lineClamp={1}>
                {description}
              </Text>
            </Box>
          </Fragment>
        )
      })}
    </ComposerPickerPanel>
  )
}

export default memo(CommandPicker)
