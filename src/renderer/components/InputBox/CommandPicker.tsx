import { Box, Text } from '@mantine/core'
import type { CommandPackage } from '@shared/types'
import { memo, type RefObject, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { navigateToSettings } from '@/modals/Settings'
import { filterSystemCommands, fuzzyScoreCommand, type SystemCommand } from '@/packages/commands'
import ComposerPickerPanel from './ComposerPickerPanel'

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
  | { kind: 'system'; command: SystemCommand }
  | { kind: 'package'; command: CommandPackage }

export function buildCommandPickerItems(
  query: string,
  packageCommands: CommandPackage[],
  options?: { excludePackageIds?: string[]; includeSystem?: boolean }
): CommandPickerItem[] {
  const exclude = new Set(options?.excludePackageIds ?? [])
  const available = packageCommands.filter((c) => c.enabled && !exclude.has(c.id))
  const system =
    options?.includeSystem === false
      ? []
      : filterSystemCommands(query).map((command) => ({ kind: 'system' as const, command }))
  const packages = filterCommands(available, query)
    .slice(0, 8)
    .map((command) => ({ kind: 'package' as const, command }))
  return [...system, ...packages]
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
  anchorRef: RefObject<HTMLElement | null>
}

function CommandPicker({
  commands,
  highlightedIndex,
  onHighlightChange,
  onSelect,
  onSelectItem,
  query,
  excludeIds = [],
  includeSystem = true,
  anchorRef,
}: CommandPickerProps) {
  const { t } = useTranslation()
  const items = useMemo(
    () =>
      buildCommandPickerItems(query, commands, {
        excludePackageIds: excludeIds,
        includeSystem,
      }),
    [commands, excludeIds, includeSystem, query]
  )
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
        const name = item.command.name
        const description =
          item.kind === 'system'
            ? item.command.id === 'compact'
              ? t('Summarize older messages to free context space')
              : item.command.id === 'rewrite'
                ? t('Rewrite text: clearer, friendlier, shorter, formal or translated')
                : item.command.description
            : item.command.description
        return (
          <Box
            key={item.kind === 'system' ? `system:${item.command.id}` : item.command.id}
            px="sm"
            py="xs"
            className="composer-picker-row cursor-pointer"
            data-selected={selected || undefined}
            bg={selected ? 'var(--chatbox-background-brand-secondary)' : undefined}
            onMouseEnter={() => onHighlightChange(index)}
            onMouseDown={(e) => {
              e.preventDefault()
              handlePick(item)
            }}
          >
            <Text size="sm" fw={500}>
              /{name}
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
        )
      })}
    </ComposerPickerPanel>
  )
}

export default memo(CommandPicker)
