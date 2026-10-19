import { Box, Combobox, Flex, InputBase, Kbd, Table, useCombobox } from '@mantine/core'
import {
  type Settings,
  type ShortcutName,
  type ShortcutSetting,
  shortcutSendValues,
  shortcutToggleWindowValues,
} from '@shared/types'
import { IconAlertHexagon } from '@tabler/icons-react'
import { type KeyboardEvent, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { getOS } from '@/packages/navigator'
import * as toastActions from '@/stores/toastActions'
import { ScalableIcon } from './common/ScalableIcon'

const os = getOS()

function formatKey(key: string) {
  const COMMON_KEY_MAPS: Record<string, string> = {
    ctrl: 'Ctrl',
    command: 'Ctrl',
    commandorcontrol: 'Ctrl',
    mod: 'Ctrl',
    option: 'Alt',
    alt: 'Alt',
    shift: 'Shift',
    enter: '⏎',
    tab: 'Tab',
    up: '↑',
    down: '↓',
    left: '←',
    right: '→',
    backquote: '`',
    '`': '`',
  }
  const MAC_KEY_MAPS: Record<string, string> = {
    ...COMMON_KEY_MAPS,
    meta: '⌘',
    mod: '⌘',
    command: '⌘',
    commandorcontrol: '⌘',
    option: '⌥',
    alt: '⌥',
    tab: '⇥',
  }
  const WINDOWS_KEY_MAPS: Record<string, string> = {
    ...COMMON_KEY_MAPS,
    meta: 'Win',
  }
  const LINUX_KEY_MAPS: Record<string, string> = {
    ...COMMON_KEY_MAPS,
    meta: 'Super',
    mod: 'Super',
    command: 'Super',
  }
  if (!key) return ''
  const lowercaseKey = key.toLowerCase()
  const keyLabel = key.length === 1 ? key.toUpperCase() : key
  switch (os) {
    case 'Mac':
      return MAC_KEY_MAPS[lowercaseKey] || keyLabel
    case 'Windows':
      return WINDOWS_KEY_MAPS[lowercaseKey] || keyLabel
    case 'Linux':
      return LINUX_KEY_MAPS[lowercaseKey] || keyLabel
    default:
      return COMMON_KEY_MAPS[lowercaseKey] || keyLabel
  }
}

/** Public helper for UI hints (e.g. quick chat footer). */
export function formatShortcutLabel(key: string) {
  return formatKey(key)
}

export function Keys(props: {
  keys: string[]
  size?: 'small'
  opacity?: number
  onEdit?: () => void
  className?: string
}) {
  const opacityClass = props.opacity !== undefined ? `opacity-${props.opacity * 100}` : ''
  return (
    <span className={`inline-block px-1 ${opacityClass} ${props.className || ''}`}>
      {props.keys.map((key) => (
        <Kbd key={key} className="mr-3xs">
          {formatKey(key)}
        </Kbd>
      ))}
    </span>
  )
}

type ShortcutDataItem = {
  label: string
  name?: ShortcutName
  keys: ShortcutSetting[ShortcutName]
  options?: string[]
  recordable?: boolean
}

export function ShortcutConfig(props: {
  shortcuts: Settings['shortcuts']
  setShortcuts: (shortcuts: Settings['shortcuts']) => void
}) {
  const { shortcuts, setShortcuts } = props
  const { t } = useTranslation()
  const items: ShortcutDataItem[] = [
    {
      label: t('Show/Hide the Application Window'),
      name: 'quickToggle',
      keys: shortcuts.quickToggle,
      options: shortcutToggleWindowValues,
    },
    {
      label: t('Open Quick Chat with Clipboard'),
      name: 'quickAttachOrOpen',
      keys: shortcuts.quickAttachOrOpen,
      recordable: true,
    },
    {
      label: t('Open Quick Chat'),
      name: 'quickOpen',
      keys: shortcuts.quickOpen,
      recordable: true,
    },
    {
      label: t('Screenshot to Chat'),
      name: 'screenshotToChat',
      keys: shortcuts.screenshotToChat || 'Alt+Shift+S',
      recordable: true,
    },
    {
      label: t('Hold to Talk'),
      name: 'voiceHold',
      keys: shortcuts.voiceHold || 'Alt+Shift+M',
      recordable: true,
    },
    {
      label: t('Focus on the Input Box'),
      name: 'inputBoxFocus',
      keys: shortcuts.inputBoxFocus,
    },
    {
      label: t('Focus on the Input Box and Enter Web Browsing Mode'),
      name: 'inputBoxWebBrowsingMode',
      keys: shortcuts.inputBoxWebBrowsingMode,
    },
    {
      label: t('Send'),
      name: 'inputBoxSendMessage',
      keys: shortcuts.inputBoxSendMessage,
      options: shortcutSendValues,
    },
    {
      label: t('Send Without Generating Response'),
      name: 'inputBoxSendMessageWithoutResponse',
      keys: shortcuts.inputBoxSendMessageWithoutResponse,
      options: shortcutSendValues,
    },
    {
      label: t('Create a New Conversation'),
      name: 'newChat',
      keys: shortcuts.newChat,
    },
    {
      label: t('Create a New Image-Creator Conversation'),
      name: 'newPictureChat',
      keys: shortcuts.newPictureChat,
    },
    {
      label: t('Navigate to the Next Conversation'),
      name: 'sessionListNavNext',
      keys: shortcuts.sessionListNavNext,
    },
    {
      label: t('Navigate to the Previous Conversation'),
      name: 'sessionListNavPrev',
      keys: shortcuts.sessionListNavPrev,
    },
    {
      label: t('Navigate to the Specific Conversation'),
      keys: 'mod+1-9',
    },
    {
      label: t('Start a New Thread'),
      name: 'messageListRefreshContext',
      keys: shortcuts.messageListRefreshContext,
    },
    {
      label: t('Show/Hide the Search Dialog'),
      name: 'dialogOpenSearch',
      keys: shortcuts.dialogOpenSearch,
    },
    {
      label: t('Navigate to the Previous Option (in search dialog)'),
      keys: shortcuts.optionNavUp,
    },
    {
      label: t('Navigate to the Next Option (in search dialog)'),
      keys: shortcuts.optionNavDown,
    },
    {
      label: t('Select the Current Option (in search dialog)'),
      keys: shortcuts.optionSelect,
    },
  ]
  const isConflict = (name: ShortcutName, shortcut: string) =>
    Boolean(shortcut) && items.some((item) => item.name && item.name !== name && item.keys === shortcut)

  const updateShortcut = (name: ShortcutName, shortcut: string) => {
    if (shortcut && isConflict(name, shortcut)) {
      toastActions.add(t('This shortcut is already assigned to another action.'))
      return
    }
    setShortcuts({ ...shortcuts, [name]: shortcut })
  }

  return (
    <Box className="border border-solid py-xs px-md rounded-xs border-chatbox-border-primary">
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t('Action')}</Table.Th>
            <Table.Th>{t('Hotkeys')}</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {items.map(({ name, label, keys, options, recordable }) => (
            <Table.Tr key={`${name || label}`}>
              <Table.Td>{label}</Table.Td>
              <Table.Td>
                {options ? (
                  <ShortcutSelect
                    options={options}
                    value={keys}
                    onSelect={(val) => {
                      if (name) updateShortcut(name, val)
                    }}
                    isConflict={name ? isConflict(name, keys) : false}
                  />
                ) : recordable && name ? (
                  <ShortcutRecorder
                    shortcut={keys}
                    onChange={(shortcut) => updateShortcut(name, shortcut)}
                    onClear={() => updateShortcut(name, '')}
                    isConflict={name ? isConflict(name, keys) : false}
                  />
                ) : (
                  <ShortcutText shortcut={keys} isConflict={name ? isConflict(name, keys) : false} className="ml-sm" />
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Box>
  )
}

function ShortcutText(props: { shortcut: string; isConflict?: boolean; className?: string }) {
  const { shortcut, isConflict, className } = props
  const { t } = useTranslation()
  if (shortcut === '') return <span className={`px-2 py-0.5 text-xs ${className || ''}`}>{t('None')}</span>
  return (
    <Flex align="center" component="span" className={`py-0.5 text-xs ${className || ''}`} c="chatbox-error">
      <Keys keys={shortcut.split('+')} />
      {isConflict && <ScalableIcon icon={IconAlertHexagon} size={16} />}
    </Flex>
  )
}

function ShortcutRecorder({
  shortcut,
  onChange,
  onClear,
  isConflict,
}: {
  shortcut: string
  onChange: (shortcut: string) => void
  onClear: () => void
  isConflict?: boolean
}) {
  const { t } = useTranslation()
  const [recording, setRecording] = useState(false)

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    event.preventDefault()
    if (event.key === 'Escape') {
      if (!recording) {
        onClear()
      }
      setRecording(false)
      return
    }
    if (['Control', 'Alt', 'Shift', 'Meta'].includes(event.key)) return

    const parts: string[] = []
    if (event.metaKey) parts.push('CommandOrControl')
    else if (event.ctrlKey) parts.push('Ctrl')
    if (event.altKey) parts.push('Alt')
    if (event.shiftKey) parts.push('Shift')

    let key = event.key
    if (key === ' ') key = 'Space'
    else if (key === '`') key = '`'
    else if (key.length === 1) key = key.toUpperCase()
    parts.push(key)
    onChange(parts.join('+'))
    setRecording(false)
  }
  return (
    <div className="inline-flex items-center gap-1">
      <button
        type="button"
        className="min-w-[160px] text-left px-2 py-1 rounded border border-chatbox-border-primary"
        onClick={() => setRecording(true)}
        onKeyDown={recording ? handleKeyDown : undefined}
        onBlur={() => setRecording(false)}
        aria-label={t('Record shortcut')}
      >
        {recording ? t('Press keys…') : <ShortcutText shortcut={shortcut} isConflict={isConflict} />}
      </button>
      {!recording && shortcut && (
        <button type="button" className="text-xs opacity-70 hover:opacity-100" onClick={onClear}>
          {t('Clear')}
        </button>
      )}
    </div>
  )
}

function ShortcutSelect({
  options,
  value,
  onSelect,
  isConflict,
}: {
  options: string[]
  value: string
  onSelect?(val: string): void
  isConflict?: boolean
}) {
  const combobox = useCombobox({
    onDropdownClose: () => combobox.resetSelectedOption(),
  })

  return (
    <Combobox
      store={combobox}
      onOptionSubmit={(val) => {
        onSelect?.(val)
        combobox.closeDropdown()
      }}
    >
      <Combobox.Target targetType="button">
        <InputBase
          maw={160}
          component="button"
          type="button"
          pointer
          rightSection={<Combobox.Chevron />}
          rightSectionPointerEvents="none"
          onClick={() => combobox.toggleDropdown()}
        >
          <ShortcutText shortcut={value} isConflict={isConflict} />
        </InputBase>
      </Combobox.Target>
      <Combobox.Dropdown>
        <Combobox.Options>
          {options.map((option) => (
            <Combobox.Option key={option} value={option}>
              <ShortcutText shortcut={option} />
            </Combobox.Option>
          ))}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  )
}
