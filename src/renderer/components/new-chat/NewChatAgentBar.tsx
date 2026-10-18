/**
 * Blank / new-chat agent multi-select: search combobox + selected chips.
 * Max MAX_ROOM_AGENTS; prompt preview only when exactly one agent is selected.
 */

import {
  ActionIcon,
  Avatar,
  Box,
  Combobox,
  Flex,
  Stack,
  Text,
  TextInput,
  useCombobox,
} from '@mantine/core'
import type { AgentDetail } from '@shared/types'
import { MAX_ROOM_AGENTS } from '@shared/types'
import { toggleAgentSelection } from '@shared/new-chat-agents'
import { IconSearch, IconX } from '@tabler/icons-react'
import clsx from 'clsx'
import { memo, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { filterAgents } from '@/components/InputBox/AgentPicker'
import { ScalableIcon } from '@/components/common/ScalableIcon'
import { useIsSmallScreen } from '@/hooks/useScreenChange'
import { router } from '@/router'
import * as toastActions from '@/stores/toastActions'

const SUGGESTED_MAX = 5
const DROPDOWN_MAX = 10

export interface NewChatAgentBarProps {
  agents: AgentDetail[]
  selectedIds: string[]
  onChange(ids: string[]): void
  className?: string
}

function NewChatAgentBar({ agents, selectedIds, onChange, className }: NewChatAgentBarProps) {
  const { t } = useTranslation()
  const isSmallScreen = useIsSmallScreen()
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  })
  const [query, setQuery] = useState('')

  const byId = useMemo(() => {
    const m = new Map<string, AgentDetail>()
    for (const a of agents) m.set(a.id, a)
    return m
  }, [agents])

  const selectedAgents = useMemo(
    () => selectedIds.map((id) => byId.get(id)).filter((a): a is AgentDetail => Boolean(a)),
    [selectedIds, byId]
  )

  const listAgents = useMemo(() => {
    const q = query.trim()
    if (q) {
      return filterAgents(agents, q).slice(0, DROPDOWN_MAX)
    }
    // Suggested: prefer unselected first, then fill with selected at end
    const unselected = agents.filter((a) => !selectedIds.includes(a.id))
    return unselected.slice(0, SUGGESTED_MAX)
  }, [agents, query, selectedIds])

  const single = selectedAgents.length === 1 ? selectedAgents[0] : null

  const applyToggle = (id: string) => {
    const { next, rejected } = toggleAgentSelection(selectedIds, id, MAX_ROOM_AGENTS)
    if (rejected === 'at_cap') {
      toastActions.add(t('Up to {{n}} agents', { n: MAX_ROOM_AGENTS }))
      return
    }
    onChange(next)
    setQuery('')
    combobox.closeDropdown()
  }

  const clearAll = () => onChange([])

  if (agents.length === 0) {
    return null
  }

  return (
    <Box className={clsx('chat-col new-chat-agent-bar', className)}>
      <Stack gap="xs" className="w-full">
        <Flex align="center" justify="space-between" gap="sm" wrap="wrap">
          <Text
            size="xs"
            c="chatbox-tertiary"
            className="uppercase tracking-wider shrink-0"
            style={{ fontFamily: 'var(--chatbox-font-mono)', fontSize: '0.7rem', letterSpacing: '0.08em' }}
          >
            {t('Your agents')}
          </Text>
          <Text size="xs" c="chatbox-tertiary" className="shrink-0 tabular-nums">
            {t('Select up to {{n}} for a team', { n: MAX_ROOM_AGENTS })}
          </Text>
        </Flex>

        <Combobox
          store={combobox}
          onOptionSubmit={(val) => {
            if (val === '__view_all__') {
              router.navigate({ to: '/settings/agents' })
              combobox.closeDropdown()
              return
            }
            applyToggle(val)
          }}
        >
          <Combobox.Target>
            <TextInput
              placeholder={t('Search agents…') || ''}
              value={query}
              size="sm"
              leftSection={<IconSearch size={14} stroke={1.75} />}
              rightSection={
                query ? (
                  <ActionIcon
                    size="sm"
                    variant="subtle"
                    color="gray"
                    className="new-chat-agent-hit"
                    onClick={() => setQuery('')}
                    aria-label={t('Clear')}
                  >
                    <IconX size={14} />
                  </ActionIcon>
                ) : null
              }
              onChange={(e) => {
                setQuery(e.currentTarget.value)
                combobox.openDropdown()
                combobox.updateSelectedOptionIndex()
              }}
              onClick={() => combobox.openDropdown()}
              onFocus={() => combobox.openDropdown()}
              onBlur={() => combobox.closeDropdown()}
              classNames={{ input: 'new-chat-agent-search' }}
              styles={{
                input: {
                  borderRadius: isSmallScreen ? 999 : 'var(--chatbox-radius-sm)',
                },
              }}
            />
          </Combobox.Target>

          <Combobox.Dropdown>
            <Combobox.Options mah={280} style={{ overflowY: 'auto' }}>
              {listAgents.length === 0 ? (
                <Combobox.Empty>{t('No agents found')}</Combobox.Empty>
              ) : (
                listAgents.map((agent) => {
                  const selected = selectedIds.includes(agent.id)
                  const disabled = !selected && selectedIds.length >= MAX_ROOM_AGENTS
                  return (
                    <Combobox.Option key={agent.id} value={agent.id} disabled={disabled}>
                      <Flex align="center" gap="sm">
                        <Avatar
                          src={agent.emojiAvatar ? undefined : agent.picUrl}
                          color="chatbox-brand"
                          size={22}
                        >
                          {agent.emojiAvatar || agent.name.slice(0, 1)}
                        </Avatar>
                        <Text size="sm" fw={500} className="flex-1 truncate">
                          {agent.name}
                        </Text>
                        {selected ? (
                          <Text size="xs" c="chatbox-brand" fw={600}>
                            ✓
                          </Text>
                        ) : null}
                      </Flex>
                    </Combobox.Option>
                  )
                })
              )}
              <Combobox.Option value="__view_all__">
                <Text size="sm" c="chatbox-tertiary">
                  {t('View all agents')}…
                </Text>
              </Combobox.Option>
            </Combobox.Options>
          </Combobox.Dropdown>
        </Combobox>

        {selectedAgents.length > 0 ? (
          <Stack gap="xs">
            <Flex align="center" gap="xs" wrap="wrap">
              {selectedAgents.map((agent) => (
                <AgentChip
                  key={agent.id}
                  name={agent.name}
                  picUrl={agent.picUrl}
                  emojiAvatar={agent.emojiAvatar}
                  selected
                  onRemove={() => applyToggle(agent.id)}
                />
              ))}
              <ActionIcon
                size={28}
                radius="md"
                c="chatbox-tertiary"
                variant="subtle"
                className="new-chat-agent-hit transition-transform duration-150 ease-out active:scale-[0.96]"
                onClick={clearAll}
                aria-label={t('Clear agents')}
              >
                <ScalableIcon icon={IconX} size={18} />
              </ActionIcon>
            </Flex>

            {single ? (
              <Text c="chatbox-secondary" className="line-clamp-5">
                {single.prompt || ''}
              </Text>
            ) : selectedAgents.length >= 2 ? (
              <Text size="xs" c="chatbox-tertiary">
                {t('Team of {{n}}', { n: selectedAgents.length })} · {t('Lead')}: {selectedAgents[0].name}
              </Text>
            ) : null}
          </Stack>
        ) : null}
      </Stack>
    </Box>
  )
}

function AgentChip({
  name,
  picUrl,
  emojiAvatar,
  selected,
  onRemove,
}: {
  name: string
  picUrl?: string
  emojiAvatar?: string
  selected?: boolean
  onRemove?(): void
}) {
  const isSmallScreen = useIsSmallScreen()
  return (
    <Flex
      align="center"
      gap={isSmallScreen ? 'xxs' : 'xs'}
      py="xs"
      px={isSmallScreen ? 'xs' : 'md'}
      bg={selected ? 'var(--chatbox-background-brand-secondary)' : 'var(--chatbox-background-secondary)'}
      className={clsx(
        'shrink-0 new-chat-agent-chip transition-transform duration-150 ease-out active:scale-[0.96]',
        isSmallScreen ? 'rounded-full' : 'rounded-[var(--chatbox-radius-sm)]'
      )}
    >
      <Avatar src={emojiAvatar ? undefined : picUrl} color="chatbox-brand" size={isSmallScreen ? 20 : 24}>
        {emojiAvatar || name.slice(0, 1)}
      </Avatar>
      <Text fw="600" c={selected ? 'chatbox-brand' : 'chatbox-primary'}>
        {name}
      </Text>
      {onRemove ? (
        <ActionIcon
          size="sm"
          variant="subtle"
          color="gray"
          className="new-chat-agent-hit"
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={`Remove ${name}`}
        >
          <IconX size={12} />
        </ActionIcon>
      ) : null}
    </Flex>
  )
}

export default memo(NewChatAgentBar)
